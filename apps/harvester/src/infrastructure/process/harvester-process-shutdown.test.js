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
