import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { acquireHarvesterProcessLock } from "../process-lock/acquire-harvester-process-lock.js"
import { createRuntimeShutdownHandler } from "./harvester-process-shutdown.js"
import { createHarvesterStop } from "../../bootstrap/create-harvester-stop.js"

function createShutdownChildSource({ lockModuleUrl, shutdownModuleUrl } = {}) {
  return `
    import { acquireHarvesterProcessLock } from ${JSON.stringify(lockModuleUrl)}
    import { createRuntimeShutdownHandler } from ${JSON.stringify(shutdownModuleUrl)}

    const lock = await acquireHarvesterProcessLock({
      directory: process.env.HARVESTER_TEST_LOCK_DIRECTORY,
      token: "child-process-lock",
    })
    if (lock.ok !== true) {
      throw lock.errors?.[0] ?? new Error("Child process could not acquire its process lock.")
    }

    const journalService = {
      close: async () => ({ ok: true }),
    }
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => ({ ok: true, status: "STOPPED" }),
      },
      logger: {
        error: (error) => {
          process.stderr.write(JSON.stringify(error) + "\\n")
        },
      },
      eventPublisher: {
        publish: () => ({ ok: true }),
      },
      eventBus: {
        flush: async () => ({ ok: true }),
      },
      journalService,
      processLock: lock,
      closeObservability: async ({ journalService: journal, processLock, allowProcessLockRelease }) => {
        if (allowProcessLockRelease !== true) {
          return [new Error("Process lock release was not authorized.")]
        }
        const closed = await journal.close()
        if (closed.ok !== true) {
          return [new Error("Journal shutdown was not confirmed.")]
        }
        const released = await processLock.release()
        return released.ok === true ? [] : released.errors
      },
      closeLogger: async () => {},
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")
    process.stdout.write("SHUTDOWN_COMPLETE\\n")
  `
}

function startShutdownChild({ directory, source } = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HARVESTER_TEST_LOCK_DIRECTORY: directory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const closed = new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    child.once("error", reject)
    child.once("close", (...exit) => resolve({
      code: exit[0],
      signal: exit[1],
    }))
  })
  return {
    child,
    closed,
    getOutput: () => ({
      stdout,
      stderr,
    }),
  }
}

test("retains Journal, notifications and process lock when runtime stop has no explicit STOPPED outcome", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const handler = createRuntimeShutdownHandler({
    runtime: {
      stop: async () => undefined,
    },
    logger: {
      error: () => calls.push("log-error"),
    },
    eventPublisher: {
      publish: () => calls.push("publish-stopped"),
    },
    eventBus: {
      flush: async () => {
        calls.push("event-bus-flush")
        return { ok: true }
      },
    },
    telegramNotifications: {
      close: async () => calls.push("telegram-close"),
    },
    journalService: {
      close: async () => calls.push("journal-close"),
    },
    processLock: {
      release: async () => {
        calls.push("process-lock-release")
        return { ok: true }
      },
    },
    closeObservability: async () => {
      calls.push("observability-close")
      return []
    },
    closeLogger: async () => calls.push("logger-close"),
    logTelegramNotificationSummary: () => calls.push("telegram-summary"),
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 1)
    assert.deepEqual(calls, ["log-error"])
  } finally {
    process.exitCode = previousExitCode
  }
})

test("exits the child process only after Journal shutdown and real process-lock release", {
  timeout: 10_000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-shutdown-"))
  const lockPath = path.join(directory, ".harvester-trading.lock")
  const source = createShutdownChildSource({
    shutdownModuleUrl: new URL("./harvester-process-shutdown.js", import.meta.url).href,
    lockModuleUrl: new URL("../process-lock/acquire-harvester-process-lock.js", import.meta.url).href,
  })
  const { child, closed, getOutput } = startShutdownChild({
    directory,
    source,
  })

  try {
    const exit = await closed
    const output = getOutput()
    assert.equal(exit.code, 0, `The child must exit successfully after shutdown; stderr: ${output.stderr}`)
    assert.equal(exit.signal, null, "The child must exit naturally rather than being killed by a signal.")
    assert.equal(output.stdout.trim(), "SHUTDOWN_COMPLETE", "The shutdown handler must resolve before the child exits.")
    await assert.rejects(
      readFile(lockPath, "utf8"),
      { code: "ENOENT" },
      "The real process-lock file must be removed before the child process exits.",
    )
    const replacementLock = await acquireHarvesterProcessLock({
      directory,
      token: "parent-process-lock",
    })
    assert.equal(replacementLock.ok, true, "A new process must be able to acquire the released lock.")
    const release = await replacementLock.release()
    assert.equal(release.ok, true, "The parent must clean up the replacement lock.")
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("retains the real process lock when durable PROCESS_STOPPED acknowledgement fails", {
  timeout: 10_000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-stop-durability-"))
  const lockPath = path.join(directory, ".harvester-trading.lock")
  const source = `
    import { acquireHarvesterProcessLock } from ${JSON.stringify(new URL("../process-lock/acquire-harvester-process-lock.js", import.meta.url).href)}
    import { createRuntimeShutdownHandler } from ${JSON.stringify(new URL("./harvester-process-shutdown.js", import.meta.url).href)}
    import { createHarvesterStop } from ${JSON.stringify(new URL("../../bootstrap/create-harvester-stop.js", import.meta.url).href)}

    const lock = await acquireHarvesterProcessLock({
      directory: process.env.HARVESTER_TEST_LOCK_DIRECTORY,
      token: "durability-failure-child",
    })
    if (lock.ok !== true) {
      throw lock.errors?.[0] ?? new Error("Child process could not acquire its process lock.")
    }

    const stop = createHarvesterStop({
      userDataState: { shutdownRequested: false, ready: true, status: "READY" },
      logger: { system: () => {}, error: () => {} },
      runtimeSessionId: "durability-failure-session",
      operatorControlLifecycle: { stop: async () => {} },
      stopRuntime: async ({ beforeSharedServicesStop }) => {
        await beforeSharedServicesStop()
        return { ok: true, status: "STOPPED" }
      },
      operationalStateStore: {},
      recordProcessStopped: async () => ({
        ok: true,
        data: { durable: false },
        errors: [new Error("durable acknowledgement missing")],
      }),
    })

    const handler = createRuntimeShutdownHandler({
      runtime: { stop },
      logger: { error: () => {} },
      eventPublisher: { publish: () => ({ ok: true }) },
      eventBus: { flush: async () => ({ ok: true }) },
      journalService: { close: async () => ({ ok: true }) },
      processLock: lock,
      closeObservability: async () => {
        process.stdout.write("UNSAFE_CLEANUP_CALLED\\n")
        return []
      },
      closeLogger: async () => {},
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")
    process.stdout.write("SHUTDOWN_ATTEMPT_RETURNED\\n")
  `
  const { child, closed, getOutput } = startShutdownChild({
    directory,
    source,
  })

  try {
    const exit = await closed
    const output = getOutput()
    assert.equal(exit.code, 1, `A failed durable process-stop acknowledgement must fail the child; stderr: ${output.stderr}`)
    assert.equal(exit.signal, null, "The child must exit naturally after the failed shutdown attempt.")
    assert.equal(output.stdout.trim(), "SHUTDOWN_ATTEMPT_RETURNED", "The outer shutdown handler must return without claiming cleanup.")
    assert.ok(
      !output.stdout.includes("UNSAFE_CLEANUP_CALLED"),
      "Journal/observability/process-lock cleanup must not run when durable PROCESS_STOPPED is unconfirmed.",
    )
    const retainedLock = await readFile(lockPath, "utf8")
    assert.ok(retainedLock.length > 0, "The real process-lock file must remain present after unproven shutdown.")
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
