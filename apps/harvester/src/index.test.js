import test from "node:test"
import assert from "node:assert/strict"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { main } from "./index.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: "disabled" },
  close: async () => ({ ok: true, closed: true, disabled: true }),
})

const runMain = (options = {}) => main({
  createJournalService: disabledJournalService,
  ...options,
})

test("uses the injected logger when startup succeeds without a broker", async () => {
  const calls = []
  const logger = {
    info: (message) => calls.push({ level: "info", message }),
    error: (data) => calls.push({ level: "error", data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await runMain({
      start: async () => ({ connected: false }),
      logger,
    })

    assert.deepEqual(calls, [{
      level: "info",
      message: "Harvester configuration validated; broker connection and market data are disabled.",
    }])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("logs startup failures as one structured logger argument", async () => {
  const calls = []
  const error = new Error("configuration failed")
  const logger = {
    info: (data) => calls.push({ level: "info", data }),
    error: (data) => calls.push({ level: "error", data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await runMain({
      start: async () => { throw error },
      logger,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].level, "error")
    assert.equal(calls[0].data.message, "Harvester startup failed.")
    assert.equal(calls[0].data.error, error)
    assert.equal(calls[0].data.errorDetails.name, "Error")
    assert.equal(calls[0].data.errorDetails.message, "configuration failed")
    assert.match(calls[0].data.errorDetails.stack, /configuration failed/)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})


test("reports the actual Conservative TESTNET trading mode at startup", async () => {
  const messages = []
  await runMain({
    start: async () => ({
      connected: true,
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: ["ZROUSDT"],
    }),
    logger: { info: (message) => messages.push(message), error() {} },
  })
  assert.deepEqual(messages, [
    "Harvester connected and subscribed to 1 enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness.",
  ])
})

test("reports broker-connected read-only mode without claiming trading is blocked by unresolved rules", async () => {
  const messages = []
  await runMain({
    start: async () => ({
      connected: true,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: ["ZROUSDT"],
    }),
    logger: { info: (message) => messages.push(message), error() {} },
  })
  assert.deepEqual(messages, [
    "Harvester connected and subscribed to 1 enabled market(s) in read-only mode; order execution is disabled.",
  ])
})


test("preserves nested AggregateError details in startup diagnostics", async () => {
  const calls = []
  const rootError = new Error("broker request failed")
  const error = new AggregateError([rootError], "startup and cleanup failed")
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await runMain({
      start: async () => { throw error },
      logger: {
        info() {},
        debug() {},
        error: (data) => calls.push(data),
      },
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].errorDetails.name, "AggregateError")
    assert.equal(calls[0].errorDetails.message, "startup and cleanup failed")
    assert.equal(calls[0].errorDetails.errors[0].message, "broker request failed")
    assert.match(calls[0].errorDetails.errors[0].stack, /broker request failed/)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("composes exactly one EventBus and injects the best-effort publisher into bootstrap", async () => {
  let eventBusCreations = 0
  let startupInput
  const publishedEvents = []
  const eventBus = {
    publish: (event) => {
      publishedEvents.push(event)
      return { ok: true, event }
    },
  }

  await runMain({
    createEventBus: ({ logger }) => {
      eventBusCreations += 1
      assert.ok(logger)
      return eventBus
    },
    start: async (input) => {
      startupInput = input
      return { connected: false }
    },
    logger: { info() {}, error() {}, debug() {} },
  })

  assert.equal(eventBusCreations, 1)
  assert.equal(typeof startupInput.eventPublisher.publish, "function")
  const event = { name: "harvester.test", source: "test", data: {} }
  assert.equal(startupInput.eventPublisher.publish(event).ok, true)
  assert.deepEqual(publishedEvents, [
    {
      name: "harvester.started",
      source: "harvester",
      data: { broker: "none", strategyMode: "read-only", enabledMarkets: [], tradingEnabled: false },
    },
    event,
  ])
})

test("does not wait for optional Journal initialization before starting Harvester", async () => {
  let resolveReady
  let runtimeStarted = false
  const journalService = {
    ready: new Promise((resolve) => { resolveReady = resolve }),
    status: { state: "starting" },
    close: async () => ({ ok: true, closed: true }),
  }

  const result = await runMain({
    createJournalService: () => journalService,
    start: async () => {
      runtimeStarted = true
      return { connected: false }
    },
    logger: { info() {}, error() {}, debug() {} },
  })

  assert.equal(runtimeStarted, true)
  assert.equal(result.journalService, journalService)
  assert.equal(result.journalService.status.state, "starting")
  resolveReady({ ok: false, errors: [new Error("journal unavailable")] })
})

test("publishes process started and stopped events for read-only startup without a broker", async () => {
  const eventBus = new EventBus()
  const events = []
  const handlers = {}
  const subscription = eventBus.subscribeAll({
    handler: async (event) => { events.push(event) },
  })
  assert.equal(subscription.ok, true)

  const result = await main({
    createEventBus: () => eventBus,
    createJournalService: () => ({ status: { state: "disabled" } }),
    env: {},
    start: async () => ({
      connected: false,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: [],
      tradingConfig: { pairs: { BTCUSDT: { enabled: true } } },
      stop: async () => {},
    }),
    registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
    logger: { info() {}, error() {}, debug() {} },
  })

  assert.ok(result)
  await eventBus.flush()
  assert.equal(events.length, 1)
  assert.equal(events[0].name, HARVESTER_EVENT_NAMES.STARTED)
  assert.deepEqual(events[0].data, {
    broker: "none",
    strategyMode: "read-only",
    enabledMarkets: ["BTCUSDT"],
    tradingEnabled: false,
  })

  await handlers.SIGTERM()
  await eventBus.flush()
  assert.equal(events.length, 2)
  assert.equal(events[1].name, HARVESTER_EVENT_NAMES.STOPPED)
  assert.deepEqual(events[1].data, { reason: "SIGTERM", outcome: "success" })

  subscription.subscription.unsubscribe()
  await eventBus.close()
})

test("publishes failed process shutdown outcome when runtime.stop rejects", async () => {
  const eventBus = new EventBus()
  const events = []
  const handlers = {}
  const subscription = eventBus.subscribeAll({
    handler: async (event) => { events.push(event) },
  })
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      createEventBus: () => eventBus,
      createJournalService: () => ({ status: { state: "disabled" } }),
      env: {},
      start: async () => ({
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => { throw new Error("runtime stop failed") },
      }),
      registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
      logger: { info() {}, error() {}, debug() {} },
    })

    await handlers.SIGINT()
    await eventBus.flush()
    assert.equal(process.exitCode, 1)
    assert.equal(events.at(-1).name, HARVESTER_EVENT_NAMES.STOPPED)
    assert.equal(events.at(-1).data.reason, "SIGINT")
    assert.equal(events.at(-1).data.outcome, "failed")
    assert.equal(events.at(-1).data.error.message, "runtime stop failed")
  } finally {
    process.exitCode = previousExitCode
    subscription.subscription.unsubscribe()
    await eventBus.close()
  }
})

test("publishes a sanitized process startup-failed event", async () => {
  const eventBus = new EventBus()
  const events = []
  const subscription = eventBus.subscribeAll({
    handler: async (event) => { events.push(event) },
  })
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      createEventBus: () => eventBus,
      createJournalService: () => ({ status: { state: "disabled" } }),
      env: {},
      start: async () => { throw new Error("startup failed apiKey=private-value") },
      logger: { info() {}, debug() {}, error() {} },
    })
    await eventBus.flush()

    assert.equal(process.exitCode, 1)
    assert.equal(events.length, 1)
    assert.equal(events[0].name, HARVESTER_EVENT_NAMES.STARTUP_FAILED)
    assert.equal(events[0].data.stage, "process-startup")
    assert.equal(events[0].data.error.message, "startup failed apiKey=[REDACTED]")
  } finally {
    process.exitCode = previousExitCode
    subscription.subscription.unsubscribe()
    await eventBus.close()
  }
})


test("publishes stopped before closing Journal, then closes EventBus", async () => {
  const operations = []
  const eventBus = {
    publish: (event) => {
      operations.push("publish:" + event.name)
      return { ok: true, event }
    },
    close: async () => {
      operations.push("eventBus.close")
      return { ok: true, closed: true }
    },
  }
  const journalService = {
    close: async () => {
      operations.push("journal.close")
      return { ok: true, closed: true, durable: true }
    },
  }
  const handlers = {}

  await main({
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    start: async () => ({
      connected: false,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: [],
      stop: async () => { operations.push("runtime.stop") },
    }),
    registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
    logger: { info() {}, error() {}, debug() {} },
  })

  await handlers.SIGTERM()
  assert.deepEqual(operations, [
    "publish:harvester.started",
    "runtime.stop",
    "publish:harvester.stopped",
    "journal.close",
    "eventBus.close",
  ])
})


test("continues EventBus cleanup when Journal close fails", async () => {
  const operations = []
  const previousExitCode = process.exitCode
  const eventBus = {
    publish: (event) => { operations.push("publish:" + event.name); return { ok: true, event } },
    close: async (options) => {
      operations.push("eventBus.close:" + options.timeoutMs)
      return { ok: true, closed: true }
    },
  }
  const journalService = {
    close: async () => {
      operations.push("journal.close")
      throw new Error("journal fsync failed")
    },
  }
  const handlers = {}
  process.exitCode = 0
  try {
    await main({
      createEventBus: () => eventBus,
      createJournalService: () => journalService,
      start: async () => ({
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => operations.push("runtime.stop"),
      }),
      registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
      logger: { info() {}, debug() {}, error() {} },
    })
    await handlers.SIGTERM()
    assert.deepEqual(operations.slice(-2), ["journal.close", "eventBus.close:5000"])
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("reports EventBus timeout and preserves Journal close result", async () => {
  const operations = []
  const previousExitCode = process.exitCode
  const eventBus = {
    publish: (event) => { operations.push("publish:" + event.name); return { ok: true, event } },
    close: async (options) => {
      operations.push("eventBus.close:" + options.timeoutMs)
      return { ok: false, timedOut: true, errors: [new Error("EventBus close timed out")] }
    },
  }
  const journalService = {
    close: async () => {
      operations.push("journal.close")
      return { ok: true, closed: true, durable: true }
    },
  }
  const handlers = {}
  process.exitCode = 0
  try {
    await main({
      createEventBus: () => eventBus,
      createJournalService: () => journalService,
      start: async () => ({
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => operations.push("runtime.stop"),
      }),
      registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
      logger: { info() {}, debug() {}, error() {} },
    })
    await handlers.SIGTERM()
    assert.ok(operations.includes("journal.close"))
    assert.ok(operations.includes("eventBus.close:5000"))
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("coalesces repeated shutdown signals into one cleanup operation", async () => {
  const operations = []
  const handlers = {}
  let resolveStop
  const stopGate = new Promise((resolve) => { resolveStop = resolve })
  const eventBus = {
    publish: (event) => { operations.push("publish:" + event.name); return { ok: true, event } },
    close: async () => { operations.push("eventBus.close"); return { ok: true } },
  }
  const journalService = {
    close: async () => { operations.push("journal.close"); return { ok: true } },
  }
  await main({
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    start: async () => ({
      connected: false,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: [],
      stop: async () => { operations.push("runtime.stop"); await stopGate },
    }),
    registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
    logger: { info() {}, debug() {}, error() {} },
  })
  const first = handlers.SIGINT()
  const second = handlers.SIGTERM()
  assert.equal(first, second)
  resolveStop()
  await Promise.all([first, second])
  assert.equal(operations.filter((value) => value === "runtime.stop").length, 1)
  assert.equal(operations.filter((value) => value === "journal.close").length, 1)
  assert.equal(operations.filter((value) => value === "eventBus.close").length, 1)
})

test("closes observability after publishing startup failure", async () => {
  const operations = []
  const previousExitCode = process.exitCode
  const eventBus = {
    publish: (event) => { operations.push("publish:" + event.name); return { ok: true, event } },
    close: async () => { operations.push("eventBus.close"); return { ok: true } },
  }
  const journalService = {
    close: async () => { operations.push("journal.close"); return { ok: true } },
  }
  process.exitCode = 0
  try {
    await main({
      createEventBus: () => eventBus,
      createJournalService: () => journalService,
      start: async () => { throw new Error("bootstrap failed") },
      logger: { info() {}, debug() {}, error() {} },
    })
    assert.deepEqual(operations, [
      "publish:harvester.startup_failed",
      "journal.close",
      "eventBus.close",
    ])
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})
