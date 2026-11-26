import assert from "node:assert/strict"
import test from "node:test"
import { createRuntimeShutdownHandler } from "./harvester-process-shutdown.js"

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
  const { spawn } = await import("node:child_process")
  const { mkdtemp, readFile, rm } = await import("node:fs/promises")
  const os = await import("node:os")
  const path = await import("node:path")
  const { acquireHarvesterProcessLock } = await import("../process-lock/acquire-harvester-process-lock.js")
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-shutdown-"))
  const lockPath = path.join(directory, ".harvester-trading.lock")
  const shutdownModuleUrl = new URL("./harvester-process-shutdown.js", import.meta.url).href
  const lockModuleUrl = new URL("../process-lock/acquire-harvester-process-lock.js", import.meta.url).href
  const childSource = `
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
  const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
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

  try {
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code, signal) => resolve({ code, signal }))
    })
    assert.equal(exit.code, 0, `The child must exit successfully after shutdown; stderr: ${stderr}`)
    assert.equal(exit.signal, null, "The child must exit naturally rather than being killed by a signal.")
    assert.equal(stdout, "SHUTDOWN_COMPLETE\n", "The shutdown handler must resolve before the child exits.")
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
    await rm(directory, { recursive: true, force: true })
  }
})
