import test from "node:test"
import assert from "node:assert/strict"
import { cleanupStartupResources } from "./cleanup-startup-resources.js"

test("cleans up startup resources in dependency-safe order", async () => {
  const calls = []
  const errors = await cleanupStartupResources({
    bot: { async stop() { calls.push("bot.stop") } },
    broker: { async disconnect() { calls.push("broker.disconnect") } },
    eventBus: {
      async flush() { calls.push("eventBus.flush"); return { ok: true } },
      async close() { calls.push("eventBus.close"); return { ok: true } },
    },
    telegramNotifications: {
      async close() { calls.push("telegramNotifications.close") },
    },
    journal: {
      async close() { calls.push("journal.close"); return { ok: true } },
    },
  })

  assert.deepEqual(errors, [])
  assert.deepEqual(calls, [
    "bot.stop",
    "broker.disconnect",
    "eventBus.flush",
    "telegramNotifications.close",
    "journal.close",
    "eventBus.close",
  ])
})

test("attempts every cleanup after thrown and failed-result errors", async () => {
  const calls = []
  const logs = []
  const errors = await cleanupStartupResources({
    bot: { async stop() { calls.push("bot.stop"); throw new Error("stop failed") } },
    broker: {
      async disconnect() {
        calls.push("broker.disconnect")
        return { ok: false }
      },
    },
    eventBus: {
      async flush() { calls.push("eventBus.flush"); throw new Error("flush failed") },
      async close() { calls.push("eventBus.close"); return { ok: true } },
    },
    telegramNotifications: {
      async close() { calls.push("telegramNotifications.close"); throw new Error("notifier close failed") },
    },
    journal: {
      async close() {
        calls.push("journal.close")
        return { ok: false, errors: [new Error("journal close failed")] }
      },
    },
    logger: { error(entry) { logs.push(entry); throw new Error("logger failed") } },
  })

  assert.deepEqual(calls, [
    "bot.stop",
    "broker.disconnect",
    "eventBus.flush",
    "telegramNotifications.close",
    "journal.close",
    "eventBus.close",
  ])
  assert.deepEqual(errors.map(({ stage }) => stage), [
    "bot.stop()",
    "broker.disconnect()",
    "eventBus.flush()",
    "telegramNotifications.close()",
    "journal.close()",
  ])
  assert.equal(logs.length, errors.length)
})

test("returns an empty error list when no startup resources were created", async () => {
  assert.deepEqual(await cleanupStartupResources(), [])
})
