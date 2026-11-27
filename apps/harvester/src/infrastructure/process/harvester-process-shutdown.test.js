import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { acquireHarvesterProcessLock } from "../process-lock/acquire-harvester-process-lock.js"
import { createRuntimeShutdownHandler } from "./harvester-process-shutdown.js"

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
    const processLock = {
      release: async () => {
        process.stdout.write("LOCK_RELEASED\\n")
        return lock.release()
      },
    }
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
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
      processLock,
      closeObservability: async ({ journalService: journal }) => {
        const closed = await journal.close()
        if (closed.ok !== true) {
          return [new Error("Journal shutdown was not confirmed.")]
        }
        return []
      },
      closeLogger: async () => {
        process.stdout.write("LOGGER_CLOSED\\n")
      },
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")
    process.stdout.write("SHUTDOWN_COMPLETE\\n")
  `
}

function createDurableJournalShutdownChildSource({ lockModuleUrl, shutdownModuleUrl } = {}) {
  return `
    import { EventBus } from "@coinzilla/event-bus"
    import { Journal } from "@coinzilla/journal"
    import { acquireHarvesterProcessLock } from ${JSON.stringify(lockModuleUrl)}
    import { createRuntimeShutdownHandler } from ${JSON.stringify(shutdownModuleUrl)}

    const logger = {
      system: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }
    const eventBus = new EventBus({ logger })
    const journal = new Journal({
      eventBus,
      directory: process.env.HARVESTER_TEST_JOURNAL_DIRECTORY,
      logger,
    })
    const journalStarted = await journal.start()
    if (journalStarted.ok !== true) {
      throw journalStarted.errors?.[0] ?? new Error("The real Journal could not start.")
    }
    const accepted = eventBus.publish({
      name: "shutdown.accepted",
      source: "integration-test",
      payload: { writeId: "accepted-before-process-exit" },
    })
    if (accepted.ok !== true) {
      throw accepted.errors?.[0] ?? new Error("The pre-shutdown Journal event was not accepted.")
    }

    const lock = await acquireHarvesterProcessLock({
      directory: process.env.HARVESTER_TEST_LOCK_DIRECTORY,
      token: "child-process-lock",
    })
    if (lock.ok !== true) {
      throw lock.errors?.[0] ?? new Error("Child process could not acquire its process lock.")
    }

    let runtimeStopCalls = 0
    let journalCloseCalls = 0
    let lockReleaseCalls = 0
    const journalService = {
      status: { enabled: true },
      close: async () => {
        journalCloseCalls += 1
        return journal.close()
      },
    }
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => {
          runtimeStopCalls += 1
          return {
            ok: true,
            status: "STOPPED",
            data: { durableProcessStopAcknowledged: true },
          }
        },
      },
      logger,
      eventPublisher: {
        publish: () => ({ ok: true }),
      },
      eventBus,
      journalService,
      processLock: {
        release: async () => {
          lockReleaseCalls += 1
          const result = await lock.release()
          if (result.ok === true) {
            process.stdout.write("LOCK_RELEASED\\n")
          }
          return result
        },
      },
      closeObservability: async ({ journalService: service }) => {
        const result = await service.close()
        if (result.ok !== true || result.durable !== true) {
          return result.errors ?? [new Error("The real Journal close was not durably confirmed.")]
        }
        return []
      },
      closeLogger: async () => {
        process.stdout.write("LOGGER_CLOSED\\n")
      },
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")
    await handler("SIGINT")
    process.stdout.write("JOURNAL_FILE=" + journal.filePath + "\\n")
    process.stdout.write("COUNTS=" + [runtimeStopCalls, journalCloseCalls, lockReleaseCalls].join(",") + "\\n")
    process.stdout.write("SHUTDOWN_COMPLETE\\n")
  `
}

function startShutdownChild({ directory, source, journalDirectory } = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HARVESTER_TEST_LOCK_DIRECTORY: directory,
      ...(journalDirectory ? { HARVESTER_TEST_JOURNAL_DIRECTORY: journalDirectory } : {}),
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
    assert.deepEqual(
      output.stdout.trim().split(/\r?\n/),
      ["LOGGER_CLOSED", "LOCK_RELEASED", "SHUTDOWN_COMPLETE"],
      "The process logger must close before the process lock is released, and the lock must release before process exit.",
    )
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

function createDurabilityFailureChildSource({
  lockModuleUrl,
  shutdownModuleUrl,
  stopModuleUrl,
} = {}) {
  return `
    import { acquireHarvesterProcessLock } from ${JSON.stringify(lockModuleUrl)}
    import { createRuntimeShutdownHandler } from ${JSON.stringify(shutdownModuleUrl)}
    import { createHarvesterStop } from ${JSON.stringify(stopModuleUrl)}

    const lock = await acquireHarvesterProcessLock({
      directory: process.env.HARVESTER_TEST_LOCK_DIRECTORY,
      token: "durability-failure-child",
    })
    if (lock.ok !== true) {
      throw lock.errors?.[0] ?? new Error("Child process could not acquire its process lock.")
    }

    const stop = createHarvesterStop({
      userDataState: { shutdownRequested: false, ready: true, status: "READY" },
      logger: {
      system: () => {},
      error: () => {},
    },
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
}

test("durably closes accepted Journal writes before child exit and makes repeated shutdown idempotent", {
  timeout: 10_000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-durable-journal-shutdown-"))
  const journalDirectory = path.join(directory, "journal")
  const lockPath = path.join(directory, ".harvester-trading.lock")
  const source = createDurableJournalShutdownChildSource({
    shutdownModuleUrl: new URL("./harvester-process-shutdown.js", import.meta.url).href,
    lockModuleUrl: new URL("../process-lock/acquire-harvester-process-lock.js", import.meta.url).href,
  })
  const { child, closed, getOutput } = startShutdownChild({
    directory,
    journalDirectory,
    source,
  })

  try {
    const exit = await closed
    const output = getOutput()
    assert.equal(exit.code, 0, `The child must exit successfully after durable Journal shutdown; stderr: ${output.stderr}`)
    assert.equal(exit.signal, null, "The child must exit naturally rather than being killed by a signal.")
    const outputLines = output.stdout.trim().split(/\\r?\\n/)
    assert.deepEqual(
      outputLines.slice(0, 2),
      ["LOGGER_CLOSED", "LOCK_RELEASED"],
      "The process logger must close and the Journal must durably close before the real process lock is released.",
    )
    const journalFileLine = outputLines.find((line) => line.startsWith("JOURNAL_FILE="))
    assert.ok(journalFileLine, "The child must report the real Journal session file for post-exit verification.")
    const journalFilePath = journalFileLine.slice("JOURNAL_FILE=".length)
    const journalContents = await readFile(journalFilePath, "utf8")
    assert.match(journalContents, /shutdown\\.accepted/, "The accepted pre-shutdown EventBus event must be present in the closed Journal file.")
    assert.match(journalContents, /accepted-before-process-exit/, "The durable Journal record must preserve the accepted write identity.")
    assert.ok(
      outputLines.includes("COUNTS=1,1,1"),
      "Repeated shutdown requests must execute runtime stop, Journal close, and process-lock release exactly once.",
    )
    assert.equal(outputLines.at(-1), "SHUTDOWN_COMPLETE", "The child must report completion only after the lock-release boundary.")
    await assert.rejects(
      readFile(lockPath, "utf8"),
      { code: "ENOENT" },
      "The real process-lock file must be absent before child exit.",
    )
    const replacementLock = await acquireHarvesterProcessLock({
      directory,
      token: "parent-process-lock",
    })
    assert.equal(replacementLock.ok, true, "A subsequent process must be able to acquire the released process lock.")
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
  const source = createDurabilityFailureChildSource({
    lockModuleUrl: new URL("../process-lock/acquire-harvester-process-lock.js", import.meta.url).href,
    shutdownModuleUrl: new URL("./harvester-process-shutdown.js", import.meta.url).href,
    stopModuleUrl: new URL("../../bootstrap/create-harvester-stop.js", import.meta.url).href,
  })
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
    assert.ok(!output.stdout.includes("UNSAFE_CLEANUP_CALLED"), "Cleanup must not run when durable PROCESS_STOPPED is unconfirmed.")
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

test("requires a Journal-backed STOPPED event when PROCESS_STOPPED was not durably recorded", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => ({
          ok: true,
          status: "STOPPED",
         data: { durableProcessStopAcknowledged: false },
        }),
      },
      eventPublisher: {
        publish: () => {
          calls.push("publish-stopped")
          return { ok: true }
        },
      },
      eventBus: {
        flush: async () => {
          calls.push("event-bus-flush")
          return { ok: true }
        },
      },
      journalService: {
        status: { enabled: true },
        close: async () => ({
          ok: true,
          closed: true,
          durable: true,
        }),
      },
      processLock: {
        release: async () => {
          calls.push("process-lock-release")
          return {
            ok: true,
            released: true,
          }
        },
      },
      closeObservability: async () => {
        calls.push("observability-close")
        return []
      },
      closeLogger: async () => calls.push("logger-close"),
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")

    assert.equal(process.exitCode, 0)
    assert.ok(calls.includes("publish-stopped"))
    assert.ok(calls.includes("event-bus-flush"))
    assert.ok(calls.includes("observability-close"))
    assert.ok(calls.includes("process-lock-release"))
  } finally {
    process.exitCode = previousExitCode
  }
})

test("fails closed when Journal-backed STOPPED evidence cannot be flushed", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: false },
        }),
      },
      logger: { error: () => calls.push("log-error") },
      eventPublisher: {
        publish: () => {
          calls.push("publish-stopped")
          return { ok: true }
        },
      },
      eventBus: {},
      journalService: {
        status: { enabled: true },
        close: async () => ({
          ok: true,
          closed: true,
          durable: true,
        }),
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
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")

    assert.equal(process.exitCode, 1)
    assert.ok(!calls.includes("event-bus-flush"))
    assert.ok(!calls.includes("observability-close"))
    assert.ok(!calls.includes("process-lock-release"))
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when the Journal-backed STOPPED acknowledgement is unavailable", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => ({
          ok: true,
          status: "STOPPED",
         data: { durableProcessStopAcknowledged: false },
        }),
      },
      logger: { error: () => calls.push("log-error") },
      eventPublisher: {
        publish: () => {
          calls.push("publish-stopped")
          return {
            ok: false,
            errors: [new Error("STOPPED event rejected")],
          }
        },
      },
      eventBus: {
        flush: async () => {
          calls.push("event-bus-flush")
          return { ok: true }
        },
      },
      journalService: {
        status: { enabled: true },
        close: async () => ({
          ok: true,
          closed: true,
          durable: true,
        }),
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
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")

    assert.equal(process.exitCode, 1)
    assert.ok(calls.includes("publish-stopped"))
    assert.ok(!calls.includes("event-bus-flush"))
    assert.ok(!calls.includes("observability-close"))
    assert.ok(!calls.includes("process-lock-release"))
  } finally {
    process.exitCode = previousExitCode
  }
})

test("fails closed when neither durable PROCESS_STOPPED nor an enabled Journal is available", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const handler = createRuntimeShutdownHandler({
      runtime: {
        stop: async () => ({
          ok: true,
          status: "STOPPED",
         data: { durableProcessStopAcknowledged: false },
        }),
      },
      logger: { error: () => calls.push("log-error") },
      eventPublisher: {
        publish: () => {
          calls.push("publish-stopped")
          return { ok: true }
        },
      },
      eventBus: {
        flush: async () => {
          calls.push("event-bus-flush")
          return { ok: true }
        },
      },
      journalService: {
        status: { enabled: false },
        close: async () => ({
          ok: true,
          closed: true,
          disabled: true,
        }),
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
      logTelegramNotificationSummary: () => {},
    })

    await handler("SIGTERM")

    assert.equal(process.exitCode, 1)
    assert.ok(!calls.includes("publish-stopped"))
    assert.ok(!calls.includes("event-bus-flush"))
    assert.ok(!calls.includes("observability-close"))
    assert.ok(!calls.includes("process-lock-release"))
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains all shared resources and the process lock when the final EventBus flush fails", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const handler = createRuntimeShutdownHandler({
    runtime: {
      stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
    },
    logger: {
      system: () => {},
      error: ({ shutdownPhase }) => calls.push(shutdownPhase),
    },
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    eventBus: {
      flush: async () => ({
        ok: false,
        errors: [],
      }),
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
    logTelegramNotificationSummary: () => {},
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 1, "An unconfirmed final EventBus flush must fail shutdown.")
    assert.ok(calls.includes("EVENT_BUS_FLUSH"), "Shutdown diagnostics must identify the failed flush phase.")
    assert.equal(calls.includes("observability-close"), false, "Journal and EventBus cleanup must wait until accepted deliveries drain.")
    assert.equal(calls.includes("logger-close"), false, "The logger must remain available while delivery work is pending.")
    assert.equal(calls.includes("process-lock-release"), false, "The process lock must remain held after an incomplete flush.")
  } finally {
    process.exitCode = previousExitCode
  }
})

function createPendingEventBusFlush() {
  let releaseFlush
  let flushCalls = 0
  const flushPromise = new Promise((resolve) => {
    releaseFlush = () => resolve({ ok: true })
  })
  return {
    flush: () => {
      flushCalls += 1
      return flushPromise
    },
    release: () => releaseFlush(),
    getCalls: () => flushCalls,
  }
}

test("bounds a hung EventBus flush and retains the process lock without overlapping retries", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const pendingFlush = createPendingEventBusFlush()
  const handler = createRuntimeShutdownHandler({
    cleanupTimeoutMs: 10,
    runtimeStopTimeoutMs: 100,
    runtime: {
      stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
    },
    logger: {
      system: () => {},
      error: () => {},
    },
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    eventBus: {
      flush: pendingFlush.flush,
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
    logTelegramNotificationSummary: () => {},
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 1, "A hung EventBus flush must fail closed at its configured deadline.")
    assert.equal(pendingFlush.getCalls(), 1, "A timed-out EventBus flush must remain single-flight.")
    assert.deepEqual(calls, [], "No downstream cleanup or process-lock release may run while delivery draining is pending.")

    const retry = handler("SIGTERM")
    pendingFlush.release()
    await retry
    assert.equal(pendingFlush.getCalls(), 1, "A retry must await the original pending flush instead of starting a concurrent one.")
    assert.deepEqual(
      calls,
      ["observability-close", "logger-close", "process-lock-release"],
      "Cleanup and lock release may proceed only after the original flush completes.",
    )
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when observability cleanup exceeds its deadline", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const handler = createRuntimeShutdownHandler({
    cleanupTimeoutMs: 10,
    observabilityCleanupTimeoutMs: 10,
    runtimeStopTimeoutMs: 100,
    runtime: {
      stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
    },
    logger: {
      system: () => {},
      error: () => {},
    },
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    eventBus: {
      flush: async () => ({ ok: true }),
    },
    processLock: {
      release: async () => {
        calls.push("process-lock-release")
        return { ok: true }
      },
    },
    closeObservability: () => new Promise(() => {}),
    closeLogger: async () => calls.push("logger-close"),
    logTelegramNotificationSummary: () => {},
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 1)
    assert.deepEqual(calls, [], "Logger close and process-lock release must not run while observability cleanup is pending.")
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when process logger close fails", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const handler = createRuntimeShutdownHandler({
    cleanupTimeoutMs: 100,
    observabilityCleanupTimeoutMs: 100,
    runtimeStopTimeoutMs: 100,
    runtime: {
      stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
    },
    logger: {
      system: () => {},
      error: () => {},
    },
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    eventBus: {
      flush: async () => ({ ok: true }),
    },
    processLock: {
      release: async () => {
        calls.push("process-lock-release")
        return { ok: true }
      },
    },
    closeObservability: async () => [],
    closeLogger: async () => {
      calls.push("logger-close")
      throw new Error("logger close failed")
    },
    logTelegramNotificationSummary: () => {},
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 1)
    assert.deepEqual(calls, ["logger-close"], "A failed logger close must prevent process-lock release.")
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when release acknowledgement is ambiguous", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const handler = createRuntimeShutdownHandler({
    cleanupTimeoutMs: 100,
    observabilityCleanupTimeoutMs: 100,
    runtimeStopTimeoutMs: 100,
    runtime: {
      stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
    },
    logger: {
      system: () => {},
      error: () => {},
    },
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    eventBus: {
      flush: async () => ({ ok: true }),
    },
    processLock: {
      release: async () => {
        calls.push("process-lock-release")
        return {
          ok: true,
        }
      },
    },
    closeObservability: async () => [],
    closeLogger: async () => calls.push("logger-close"),
    logTelegramNotificationSummary: () => {},
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 1, "An ambiguous lock-release acknowledgement must fail shutdown.")
    assert.deepEqual(
      calls,
      ["logger-close", "process-lock-release"],
      "The lock release must be attempted only after all earlier cleanup succeeds, and an ambiguous result must not be accepted.",
    )
  } finally {
    process.exitCode = previousExitCode
  }
})
test("accepts an explicit idempotent already-released process-lock result", async () => {
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const handler = createRuntimeShutdownHandler({
    runtime: {
      stop: async () => ({
        ok: true,
        status: "STOPPED",
        data: { durableProcessStopAcknowledged: true },
      }),
    },
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    eventBus: {
      flush: async () => ({ ok: true }),
    },
    processLock: {
      release: async () => ({
        ok: true,
        released: false,
        alreadyReleased: true,
      }),
    },
    closeObservability: async () => [],
    closeLogger: async () => ({ ok: true }),
    logTelegramNotificationSummary: () => {},
  })

  try {
    await handler("SIGTERM")
    assert.equal(process.exitCode, 0, "An explicit already-released acknowledgement must be accepted as a completed lock-release outcome.")
  } finally {
    process.exitCode = previousExitCode
  }
})
