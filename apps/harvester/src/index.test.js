import test from "node:test"
import { isAbsolute as pathIsAbsolute } from "node:path"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { main } from "./index.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: "disabled" },
  close: async () => ({ ok: true, closed: true, disabled: true }),
})

const acquireProcessLock = async () => ({
  ok: true,
  release: async () => ({ ok: true, released: true }),
})

const runMain = (options = {}) => main({
  createJournalService: disabledJournalService,
  ...options,
})

test("uses the injected logger when startup succeeds without a broker", async () => {
  const calls = []
  const logger = {
    info: (message) => calls.push({ level: "info", message }),
    system: (message) => calls.push({ level: "system", message }),
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
      level: "system",
      message: "Configuration validated; broker and market data are disabled.",
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
    assert.equal(calls[0].data.message, "startup failed.")
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
    logger: { info() {}, system: (message) => messages.push(message), error() {} },
  })
  assert.deepEqual(messages, [
    "Connected; subscribed to 1 enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness.",
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
    "Connected; subscribed to 1 enabled market(s) in read-only mode; order execution is disabled.",
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
    createJournalService: () => ({ status: { state: "disabled" }, close: async () => ({ ok: true, closed: true }) }),
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


test("disables the optional Journal from HARVESTER_JOURNAL_ENABLED", async () => {
  const previousEnabled = process.env.HARVESTER_JOURNAL_ENABLED
  const previousDirectory = process.env.HARVESTER_JOURNAL_DIRECTORY
  const previousExitCode = process.exitCode
  const parent = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-disabled-"))
  const directory = path.join(parent, "disabled")
  const handlers = {}
  process.env.HARVESTER_JOURNAL_ENABLED = "false"
  process.env.HARVESTER_JOURNAL_DIRECTORY = directory
  process.exitCode = 0
  try {
    const result = await main({
      start: async () => ({ connected: false, stop: async () => {} }),
      registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
      logger: { info() {}, debug() {}, error() {} },
    })
    assert.equal(result.journalService.status.enabled, false)
    await handlers.SIGTERM()
    await assert.rejects(readdir(directory), { code: "ENOENT" })
  } finally {
    if (previousEnabled === undefined) delete process.env.HARVESTER_JOURNAL_ENABLED
    else process.env.HARVESTER_JOURNAL_ENABLED = previousEnabled
    if (previousDirectory === undefined) delete process.env.HARVESTER_JOURNAL_DIRECTORY
    else process.env.HARVESTER_JOURNAL_DIRECTORY = previousDirectory
    process.exitCode = previousExitCode
    await rm(parent, { recursive: true, force: true })
  }
})

test("writes and durably closes a JSONL session in HARVESTER_JOURNAL_DIRECTORY", async () => {
  const previousEnabled = process.env.HARVESTER_JOURNAL_ENABLED
  const previousDirectory = process.env.HARVESTER_JOURNAL_DIRECTORY
  const previousExitCode = process.exitCode
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-session-"))
  const handlers = {}
  process.env.HARVESTER_JOURNAL_ENABLED = "true"
  process.env.HARVESTER_JOURNAL_DIRECTORY = directory
  process.exitCode = 0
  try {
    const eventBus = new EventBus()
    const result = await main({
      createEventBus: () => eventBus,
      start: async () => ({
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => {},
      }),
      registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
      logger: { info() {}, debug() {}, error() {} },
    })
    const ready = await result.journalService.ready
    assert.equal(ready.ok, true)
    assert.equal(result.journalService.status.state, "ready")

    await handlers.SIGTERM()
    assert.equal(result.journalService.status.state, "closed")
    assert.equal(result.journalService.status.closed, true)

    const files = await readdir(directory)
    assert.equal(files.length, 1)
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{3})?\.jsonl$/)
    const content = await readFile(path.join(directory, files[0]), "utf8")
    const records = content.trim().split("\n").map((line) => JSON.parse(line))
    assert.ok(records.some((record) => record.name === "harvester.stopped"))
    assert.ok(records.every((record) => record.__coinzillaJournal?.schemaVersion === 1))
    assert.doesNotMatch(content, /apiKey|apiSecret|accessToken|password/)
  } finally {
    if (previousEnabled === undefined) delete process.env.HARVESTER_JOURNAL_ENABLED
    else process.env.HARVESTER_JOURNAL_ENABLED = previousEnabled
    if (previousDirectory === undefined) delete process.env.HARVESTER_JOURNAL_DIRECTORY
    else process.env.HARVESTER_JOURNAL_DIRECTORY = previousDirectory
    process.exitCode = previousExitCode
    await rm(directory, { recursive: true, force: true })
  }
})

test("refuses TESTNET trading when Journal startup fails", async () => {
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock,
      createJournalService: () => ({
        ready: Promise.resolve({ ok: false, errors: [new Error("disk unavailable")] }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: true, closed: true }),
      }),
      start: async () => { started = true; return { connected: false } },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(started, false)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("allows a trading-enabled first start only with a validated empty Journal history", async () => {
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock,
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true, available: true, records: [], count: 0 }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: true, closed: true }),
      }),
      start: async () => { started = true; return { connected: false, tradingEnabled: true } },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(started, true)
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("does not require historical Journal reads for trading startup", async () => {
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock,
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: true, closed: true }),
      }),
      start: async () => { started = true; return { connected: false, tradingEnabled: true } },
      registerSignalHandler() {},
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(started, true)
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("does not pass historical Journal records into bootstrap", async () => {
  let startupInput
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock,
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({
          ok: true,
          available: true,
          records: [{ id: "old-fill", payload: { name: "execution.fill_applied" } }],
        }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: true, closed: true }),
      }),
      start: async (input) => {
        startupInput = input
        return { connected: false, tradingEnabled: false }
      },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(Object.hasOwn(startupInput, "journalRecoveryRecords"), false)
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("allows read-only startup when prior trading history requires recovery", async () => {
  let started = false
  await main({
    env: { HARVESTER_ENABLE_TRADING: "false", HARVESTER_JOURNAL_ENABLED: "true" },
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      recovery: Promise.resolve({
        ok: true,
        available: true,
        records: [{ id: "old-fill", payload: { name: "execution.fill_applied", source: "harvester" } }],
      }),
      flush: async () => ({ ok: true, durable: true }),
      close: async () => ({ ok: true, closed: true }),
    }),
    start: async () => { started = true; return { connected: false, tradingEnabled: false } },
    logger: { info() {}, error() {}, debug() {} },
  })
  assert.equal(started, true)
})

test("ignores historical Journal read failures when starting the current trading session", async () => {
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock,
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: false, errors: [new Error("legacy history is malformed")] }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: true, closed: true }),
      }),
      start: async () => { started = true; return { connected: false, tradingEnabled: true } },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(started, true)
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("blocks a second trading process before Journal startup when the process lock is held", async () => {
  let journalFactoryCalls = 0
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock: async () => ({
        ok: false,
        errors: [Object.assign(new Error("another trading process owns the lock"), { code: "HARVESTER_PROCESS_LOCK_EXISTS" })],
      }),
      createJournalService: () => { journalFactoryCalls += 1; return disabledJournalService() },
      start: async () => { started = true; return { connected: false } },
      registerSignalHandler() {},
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(journalFactoryCalls, 0)
    assert.equal(started, false)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("releases the trading process lock only after runtime and Journal shutdown", async () => {
  let signalHandler
  const sequence = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => { sequence.push("lock-release"); return { ok: true, released: true } },
      }),
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true, available: true, records: [] }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => { sequence.push("journal-close"); return { ok: true, closed: true } },
      }),
      start: async () => ({
        connected: true,
        tradingEnabled: true,
        subscriptions: [],
        stop: async () => { sequence.push("runtime-stop"); return { ok: true } },
      }),
      registerSignalHandler: (signal, handler) => {
        if (signal === "SIGTERM") signalHandler = handler
      },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(typeof signalHandler, "function")
    await signalHandler()
    assert.deepEqual(sequence, ["runtime-stop", "journal-close", "lock-release"])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("acquires the process lock before starting Journal and releases it after clean shutdown", async () => {
  const sequence = []
  let signalHandler
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock: async ({ journalDirectory, globalDirectory, broker }) => {
        sequence.push("lock")
        assert.equal(typeof journalDirectory, "string")
        assert.ok(pathIsAbsolute(journalDirectory))
        assert.ok(globalDirectory.includes(".coinzilla"))
        assert.ok(globalDirectory.endsWith("process-locks"))
        assert.equal(broker, "binance")
        return {
          ok: true,
          release: async () => { sequence.push("release"); return { ok: true, released: true } },
        }
      },
      createJournalService: () => {
        sequence.push("journal")
        return {
          ready: Promise.resolve({ ok: true }),
          flush: async () => ({ ok: true, durable: true }),
          close: async () => { sequence.push("journal-close"); return { ok: true, closed: true } },
        }
      },
      start: async (input) => {
        sequence.push("start")
        assert.equal(Object.hasOwn(input, "journalRecoveryRecords"), false)
        return {
          connected: true,
          tradingEnabled: false,
          subscriptions: [],
          stop: async () => { sequence.push("runtime-stop"); return { ok: true } },
        }
      },
      registerSignalHandler: (signal, handler) => {
        if (signal === "SIGTERM") signalHandler = handler
      },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.deepEqual(sequence, ["lock", "journal", "start"])
    assert.equal(typeof signalHandler, "function")
    await signalHandler()
    assert.deepEqual(sequence, ["lock", "journal", "start", "runtime-stop", "journal-close", "release"])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when runtime shutdown throws", async () => {
  let signalHandler
  let releaseCalls = 0
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => { releaseCalls += 1; return { ok: true, released: true } },
      }),
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true, available: true, records: [] }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: true, closed: true }),
      }),
      start: async () => ({
        connected: true,
        tradingEnabled: true,
        subscriptions: [],
        stop: async () => { throw new Error("broker intake did not stop") },
      }),
      registerSignalHandler: (signal, handler) => {
        if (signal === "SIGTERM") signalHandler = handler
      },
      logger: { info() {}, error() {}, debug() {} },
    })
    await signalHandler()
    assert.equal(releaseCalls, 0)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when Journal writer shutdown is not confirmed", async () => {
  let releaseCalls = 0
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => { releaseCalls += 1; return { ok: true, released: true } },
      }),
      createJournalService: () => ({
        status: { started: false },
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true, available: true, records: [] }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => ({ ok: false, errors: [new Error("writer close failed")] }),
      }),
      start: async () => { throw new Error("runtime startup failed") },
      registerSignalHandler() {},
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(releaseCalls, 0)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("rejects disabling Journal for TESTNET trading", async () => {
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "false" },
      createJournalService: disabledJournalService,
      start: async () => { started = true; return { connected: false } },
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(started, false)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})


test("retains the process lock when runtime startup fails after it may have activated broker resources", async () => {
  let releaseCalls = 0
  let journalCloseCalls = 0
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_JOURNAL_ENABLED: "true" },
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => { releaseCalls += 1; return { ok: true, released: true } },
      }),
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true, available: true, records: [] }),
        flush: async () => ({ ok: true, durable: true }),
        close: async () => { journalCloseCalls += 1; return { ok: true, closed: true } },
      }),
      start: async () => {
        throw new Error("broker startup failed after connection attempt")
      },
      registerSignalHandler() {},
      logger: { info() {}, error() {}, debug() {} },
    })
    assert.equal(journalCloseCalls, 1)
    assert.equal(releaseCalls, 0)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})


test("closes diagnostic log transports after runtime, Journal, and EventBus shutdown", async () => {
  const operations = []
  const handlers = {}
  await main({
    createEventBus: () => ({
      publish: (event) => ({ ok: true, event }),
      close: async () => { operations.push("eventbus.close"); return { ok: true } },
    }),
    createJournalService: () => ({
      close: async () => { operations.push("journal.close"); return { ok: true } },
    }),
    start: async () => ({
      connected: false,
      stop: async () => { operations.push("runtime.stop") },
    }),
    registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
    logger: { info() {}, error() {} },
    closeLogger: async () => { operations.push("logger.close") },
  })

  await handlers.SIGTERM()
  assert.deepEqual(operations, [
    "runtime.stop",
    "journal.close",
    "eventbus.close",
    "logger.close",
  ])
})
