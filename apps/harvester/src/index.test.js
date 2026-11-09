import test from "node:test"
import { isAbsolute as pathIsAbsolute } from "node:path"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { main as startMain } from "./index.js"
import { prepareOptionalJournal } from "./infrastructure/journal/prepare-optional-journal.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: "disabled" },
  flush: async () => ({ ok: true, durable: true }),
  close: async () => ({ ok: true, closed: true, disabled: true }),
})

const acquireProcessLock = async () => ({
  ok: true,
  release: async () => ({ ok: true, released: true }),
})

const main = (options = {}) => {
  const { createJournalService = disabledJournalService, env = {}, ...rest } = options
  return startMain({
    acquireProcessLock,
    ...rest,
    env: { TRADING_MODE: "testnet", ...env },
    createJournalService: (...args) => {
      const service = createJournalService(...args) ?? {}
      if (!Object.hasOwn(service, "ready")) service.ready = Promise.resolve({ ok: true })
      if (!Object.hasOwn(service, "flush")) service.flush = async () => ({ ok: true, durable: true })
      if (!Object.hasOwn(service, "close")) service.close = async () => ({ ok: true, closed: true })
      return service
    },
  })
}
const runMain = (options = {}) => main(options)

test("uses the injected logger after Binance TESTNET startup", async () => {
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
      start: async () => ({ connected: true, brokerName: "binance", tradingEnabled: true, strategyMode: "conservative", subscriptions: ["BTCUSDT"] }),
      logger,
    })

    assert.deepEqual(calls, [{
      level: "system",
      message: "Connected; subscribed to 1 enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness.",
    }])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("passes the immutable process identity into Journal composition", async () => {
  const processIdentity = {
    application: "harvester",
    version: "1.0.001",
    runtimeSessionId: "runtime-session",
    processId: 123,
    startedAt: "2026-11-09T12:34:56.789Z",
    source: {
      branch: null,
      commit: null,
      shortCommit: null,
      commitMessage: null,
      commitDate: null,
      workingTree: "unknown",
      metadataSource: "unavailable",
    },
  }
  let observedIdentity
  await runMain({
    processIdentity,
    createJournalService: (input) => {
      observedIdentity = input.processIdentity
      return disabledJournalService()
    },
    start: async () => ({ connected: false }),
    logger: { info() {}, system() {}, error() {} },
  })
  assert.equal(observedIdentity, processIdentity)
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

test("reports LIVE trading mode independently of NODE_ENV", async () => {
  const messages = []
  await runMain({
    env: { NODE_ENV: "development", TRADING_MODE: "live" },
    start: async () => ({
      connected: true,
      brokerName: "binance",
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: ["ZROUSDT"],
    }),
    logger: { info: (message) => messages.push(message), error() {} },
  })
  assert.deepEqual(messages, [
    "Connected; subscribed to 1 enabled market(s). Conservative LIVE trading is enabled; waiting for validated market prices and user-data readiness.",
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
  assert.equal(publishedEvents[0].name, HARVESTER_EVENT_NAMES.PROCESS_STARTED, "the process-attempt event must be published before runtime startup")
  assert.equal(publishedEvents[0].data.application, "harvester", "the process event must identify its application")
  assert.equal(publishedEvents[0].data.version, "1.0.001", "the process event must use the Harvester package version")
  assert.equal(publishedEvents[0].data.processId, process.pid, "the process event must retain the operating-system process ID")
  assert.equal(typeof publishedEvents[0].data.runtimeSessionId, "string", "the process event must include a runtime-session correlation ID")
  assert.match(publishedEvents[0].data.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "the process event must contain the original UTC process-entry timestamp")
  assert.deepEqual(publishedEvents.slice(1), [
    {
      name: "harvester.started",
      source: "harvester",
      data: { broker: "none", strategyMode: "read-only", enabledMarkets: [], tradingEnabled: false },
    },
    event,
  ], "the existing runtime-start event and caller-published events must retain their order after process provenance is added")
})

test("waits for required Journal readiness before starting Harvester", async () => {
  let resolveReady
  let runtimeStarted = false
  const journalService = {
    ready: new Promise((resolve) => { resolveReady = resolve }),
    status: { state: "starting" },
    close: async () => ({ ok: true, closed: true }),
  }

  journalService.flush = async () => ({ ok: true, durable: true })
  const pending = runMain({
    createJournalService: () => journalService,
    start: async () => {
      runtimeStarted = true
      return { connected: true, brokerName: "binance", tradingEnabled: true, strategyMode: "conservative", subscriptions: [] }
    },
    logger: { info() {}, error() {}, debug() {} },
  })
  await Promise.resolve()
  assert.equal(runtimeStarted, false, "Trading startup must wait for the required Journal readiness barrier.")
  resolveReady({ ok: true })
  const result = await pending
  assert.equal(runtimeStarted, true)
  assert.equal(result.journalService, journalService)
  assert.equal(result.journalService.status.state, "starting")
})

test("publishes process started and stopped events for Binance trading startup", async () => {
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
      connected: true,
      brokerName: "binance",
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: [],
      tradingConfig: { pairs: { BTCUSDT: { enabled: true } } },
      stop: async () => {},
    }),
    registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
    logger: { info() {}, error() {}, debug() {} },
  })

  assert.ok(result)
  await eventBus.flush()
  assert.equal(events.length, 2, "trading startup must publish process-attempt and successful-runtime-start events")
  assert.equal(events[0].name, HARVESTER_EVENT_NAMES.PROCESS_STARTED, "the process-attempt event must be first when Journal readiness is immediate")
  assert.equal(events[1].name, HARVESTER_EVENT_NAMES.STARTED, "the successful-runtime-start event must remain distinct")
  assert.deepEqual(events[1].data, {
    broker: "binance",
    strategyMode: "conservative",
    enabledMarkets: ["BTCUSDT"],
    tradingEnabled: true,
  })

  await handlers.SIGTERM()
  await eventBus.flush()
  assert.equal(events.length, 3, "shutdown must retain both startup events and append one stopped event")
  assert.equal(events[2].name, HARVESTER_EVENT_NAMES.STOPPED, "the stopped event must follow the process and runtime start events")
  assert.deepEqual(events[2].data, { reason: "SIGTERM", outcome: "success" })

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
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
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
    assert.equal(events.length, 2, "failed startup must retain both the process attempt and startup-failed events")
    assert.equal(events[0].name, HARVESTER_EVENT_NAMES.PROCESS_STARTED, "the process attempt must precede the failed runtime-start event")
    assert.equal(events[1].name, HARVESTER_EVENT_NAMES.STARTUP_FAILED, "the startup-failed event must remain distinct")
    assert.equal(events[1].data.stage, "process-startup")
    assert.equal(events[1].data.error.message, "startup failed apiKey=[REDACTED]")
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
    "publish:harvester.process_started",
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
      "publish:harvester.process_started",
      "publish:harvester.startup_failed",
      "journal.close",
      "eventBus.close",
    ])
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})


test("writes and durably closes a JSONL session in the injected Journal directory", async () => {
  const previousExitCode = process.exitCode
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-journal-session-"))
  const handlers = {}
  process.exitCode = 0
  try {
    const eventBus = new EventBus()
    const processIdentity = {
      application: "harvester",
      version: "1.0.001",
      runtimeSessionId: "journal-integration-test",
      processId: process.pid,
      startedAt: "2026-11-09T12:34:56.789Z",
      source: {
        branch: null,
        commit: null,
        shortCommit: null,
        commitMessage: null,
        commitDate: null,
        workingTree: "unknown",
        metadataSource: "unavailable",
      },
    }
    const result = await main({
      processIdentity,
      createEventBus: () => eventBus,
      createJournalService: (input) => prepareOptionalJournal({ ...input, directory }),
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
    assert.equal(files[0], "2026-11-09_12-34-56-journal-integration-test.jsonl")
    const content = await readFile(path.join(directory, files[0]), "utf8")
    const records = content.trim().split("\n").map((line) => JSON.parse(line))
    assert.ok(records.some((record) => record.name === "harvester.stopped"))
    assert.ok(records.every((record) => record.__coinzillaJournal?.schemaVersion === 1))
    assert.doesNotMatch(content, /apiKey|apiSecret|accessToken|password/)
  } finally {
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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

test("starts the selected trading mode without replaying prior trading history", async () => {
  let started = false
  await main({
    env: { NODE_ENV: "test" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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

test("rejects TESTNET trading when Journal cannot provide durable flush", async () => {
  let started = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { NODE_ENV: "development" },
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
      env: { NODE_ENV: "development" },
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


test("captures process provenance before trading startup and publishes it separately from runtime startup", async () => {
  const operations = []
  const events = []
  const contexts = []
  const processIdentity = {
    application: "harvester",
    version: "1.0.001",
    runtimeSessionId: "runtime-session-123",
    processId: 12345,
    startedAt: "2026-11-09T10:15:30.000Z",
    source: {
      branch: "develop",
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortCommit: "aaaaaaaa",
      commitMessage: 'release apiKey="private-value"',
      commitDate: "2026-11-09T09:00:00.000Z",
      workingTree: "clean",
      metadataSource: "git",
      privateCredential: "must-not-be-copied",
    },
    apiSecret: "must-not-be-copied",
  }
  let journalFlushCalls = 0
  const eventBus = {
    publish(event) {
      events.push(event)
      operations.push("publish:" + event.name)
      return { ok: true, event }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({ ok: true, closed: true }),
  }
  const logger = {
    setContext(context) {
      contexts.push(context)
      operations.push("logger.context")
    },
    info() {},
    system() {},
    error() {},
  }

  await main({
    processIdentity,
    logger,
    createEventBus: () => {
      operations.push("eventBus.create")
      return eventBus
    },
    acquireProcessLock: async () => {
      operations.push("processLock.acquire")
      return { ok: true, release: async () => ({ ok: true, released: true }) }
    },
    createJournalService: () => {
      operations.push("journal.create")
      return {
        ready: Promise.resolve({ ok: true }),
        flush: async () => {
          journalFlushCalls += 1
          return { ok: true, durable: true }
        },
        close: async () => ({ ok: true, closed: true, durable: true }),
      }
    },
    start: async ({ eventPublisher }) => {
      operations.push("runtime.start")
      await eventPublisher.flush()
      return {
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => {},
      }
    },
    registerSignalHandler: () => {},
    env: {
      NODE_ENV: "development",
    },
  })

  assert.deepEqual(
    operations.slice(0, 3),
    ["logger.context", "eventBus.create", "processLock.acquire"],
    "process identity and shared logger context must be established before any startup dependency can emit diagnostics",
  )
  assert.deepEqual(
    events.map(({ name }) => name),
    ["harvester.process_started", HARVESTER_EVENT_NAMES.STARTED],
    "the process-attempt event must precede the successful runtime-start event",
  )
  assert.deepEqual(events[0].data, {
    application: "harvester",
    version: "1.0.001",
    runtimeSessionId: "runtime-session-123",
    processId: 12345,
    startedAt: "2026-11-09T10:15:30.000Z",
    source: {
      branch: "develop",
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortCommit: "aaaaaaaa",
      commitMessage: "release apiKey=[REDACTED]",
      commitDate: "2026-11-09T09:00:00.000Z",
      workingTree: "clean",
      metadataSource: "git",
    },
  }, "the Journal event must contain only the sanitized, allowlisted build and runtime identity")
  assert.deepEqual(contexts[0], events[0].data, "every shared log entry must receive the same sanitized process identity as logger context")
  assert.equal(JSON.stringify(events[0]).includes("private-value"), false, "process-start evidence must not retain sensitive values embedded in build metadata")
  assert.equal(journalFlushCalls, 1, "process provenance must be included by the existing bootstrap flush without introducing an additional Journal flush")
  assert.ok(operations.indexOf("publish:harvester.process_started") < operations.indexOf("runtime.start"), "trading bootstrap must start only after the process event has been admitted to the existing Journal/EventBus pipeline")
})

test("requires Journal readiness and publishes process provenance before trading startup", async () => {
  let resolveJournalReady
  let resolveProcessStarted
  let runtimeStarted = false
  const contexts = []
  const events = []
  const processStarted = new Promise((resolve) => { resolveProcessStarted = resolve })
  const journalService = {
    ready: new Promise((resolve) => { resolveJournalReady = resolve }),
    status: { state: "starting", enabled: true },
    flush: async () => ({ ok: true, durable: true }),
    close: async () => ({ ok: true, closed: true }),
  }
  const eventBus = {
    publish(event) {
      events.push(event)
      if (event.name === "harvester.process_started") {
        resolveProcessStarted(event)
      }
      return { ok: true, event }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({ ok: true, closed: true }),
  }

  const pending = main({
    processIdentity: {
      application: "harvester",
      version: "1.0.001",
      runtimeSessionId: "delayed-journal-session",
      processId: 54321,
      startedAt: "2026-11-09T10:15:30.000Z",
      source: {
        branch: null,
        commit: null,
        shortCommit: null,
        commitMessage: null,
        commitDate: null,
        workingTree: "unknown",
        metadataSource: "unavailable",
      },
    },
    logger: {
      setContext: (context) => contexts.push(context),
      info() {},
      system() {},
      error() {},
    },
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    start: async () => {
      runtimeStarted = true
      return {
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: [],
        stop: async () => {},
      }
    },
    registerSignalHandler: () => {},
    env: {},
  })
  await Promise.resolve()
  assert.equal(runtimeStarted, false, "Trading startup must wait for required Journal readiness")
  resolveJournalReady({ ok: true })
  await pending
  assert.equal(runtimeStarted, true, "Trading runtime starts after Journal readiness")
  assert.equal(contexts[0].runtimeSessionId, "delayed-journal-session", "logger context must be available synchronously even while optional Journal startup is pending")
  assert.equal(events.some((event) => event.name === "harvester.process_started"), false, "the process-start event must not be published before the Journal subscriber is ready")
  resolveJournalReady({ ok: true })
  const processStartedEvent = await processStarted
  assert.equal(processStartedEvent.data.startedAt, "2026-11-09T10:15:30.000Z", "delayed Journal publication must retain the original process-entry timestamp")
  assert.equal(processStartedEvent.data.source.metadataSource, "unavailable", "unavailable Git provenance must remain explicit rather than guessed")
})

test("retains immediate logger provenance when the optional Journal is disabled", async () => {
  const contexts = []
  const events = []
  const eventBus = {
    publish(event) {
      events.push(event)
      return { ok: true, event }
    },
  }

  await main({
    processIdentity: {
      application: "harvester",
      version: "1.0.001",
      runtimeSessionId: "journal-disabled-session",
      processId: 678,
      startedAt: "2026-11-09T10:15:30.000Z",
      source: {
        branch: null,
        commit: null,
        shortCommit: null,
        commitMessage: null,
        commitDate: null,
        workingTree: "unknown",
        metadataSource: "unavailable",
      },
    },
    logger: { setContext: (context) => contexts.push(context), info() {}, system() {}, error() {}, warn() {} },
    createEventBus: () => eventBus,
    createJournalService: disabledJournalService,
    start: async () => ({ connected: false }),
    env: {},
  })

  assert.equal(contexts[0].runtimeSessionId, "journal-disabled-session", "logger context must retain process identity even when optional Journal persistence is disabled")
  assert.equal(events.some((event) => event.name === "harvester.process_started"), true, "the best-effort process event may still be observed by non-Journal EventBus subscribers")
})

test("records the process-start attempt before a failed runtime-start event", async () => {
  const events = []
  const eventBus = {
    publish(event) {
      events.push(event)
      return { ok: true, event }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({ ok: true, closed: true }),
  }
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      processIdentity: {
        application: "harvester",
        version: "1.0.001",
        runtimeSessionId: "failed-start-session",
        processId: 321,
        startedAt: "2026-11-09T10:15:30.000Z",
        source: {
          branch: null,
          commit: null,
          shortCommit: null,
          commitMessage: null,
          commitDate: null,
          workingTree: "unknown",
          metadataSource: "unavailable",
        },
      },
      createEventBus: () => eventBus,
      createJournalService: disabledJournalService,
      start: async () => { throw new Error("runtime startup failed") },
      logger: { setContext() {}, info() {}, error() {}, warn() {} },
      registerSignalHandler() {},
      env: {},
    })

    assert.deepEqual(
      events.map(({ name }) => name),
      ["harvester.process_started", HARVESTER_EVENT_NAMES.STARTUP_FAILED],
      "the process attempt must remain visible when runtime startup fails after Journal readiness",
    )
    assert.equal(process.exitCode, 1, "a process-start evidence record must not convert a failed runtime startup into success")
  } finally {
    process.exitCode = previousExitCode
  }
})

test("fails closed when required Journal readiness fails", async () => {
  const contexts = []
  const events = []
  let runtimeStarted = false
  const previousExitCode = process.exitCode
  process.exitCode = 0
  const eventBus = {
    publish(event) {
      events.push(event)
      return { ok: true, event }
    },
  }

  await main({
    processIdentity: {
      application: "harvester",
      version: "1.0.001",
      runtimeSessionId: "journal-unavailable-session",
      processId: 679,
      startedAt: "2026-11-09T10:15:30.000Z",
      source: {
        branch: null,
        commit: null,
        shortCommit: null,
        commitMessage: null,
        commitDate: null,
        workingTree: "unknown",
        metadataSource: "unavailable",
      },
    },
    logger: {
      setContext: (context) => contexts.push(context),
      warn() {},
      info() {},
      system() {},
      error() {},
    },
    createEventBus: () => eventBus,
    createJournalService: () => ({
      ready: Promise.resolve({ ok: false, errors: [new Error("Journal unavailable")] }),
      flush: async () => ({ ok: true, durable: true }),
      close: async () => ({ ok: true, closed: true }),
    }),
    start: async () => {
      runtimeStarted = true
      return { connected: true, brokerName: "binance", tradingEnabled: true, strategyMode: "conservative", subscriptions: [] }
    },
    env: {},
  })
  assert.equal(runtimeStarted, false, "Trading must not start when the required Journal is unavailable")
  assert.equal(process.exitCode, 1, "A required Journal readiness failure must fail startup")
  assert.equal(contexts[0].runtimeSessionId, "journal-unavailable-session", "logger context must remain available when Journal initialization fails")
  assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.PROCESS_STARTED), false, "The process-start event must not be published before Journal readiness")
  process.exitCode = previousExitCode
})


test("does not await process-start publication before emitting the stopped event", { timeout: 1000 }, async () => {
  const events = []
  const handlers = {}
  const eventBus = {
    publish(event) {
      events.push(event)
      return { ok: true, event }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({ ok: true, closed: true }),
  }
  const journalService = {
    ready: new Promise(() => {}),
    // Resolve close independently to isolate the process-start publication wait; production Journal close semantics are unchanged.
    close: async () => ({ ok: true, closed: true }),
  }

  await main({
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    start: async () => ({
      connected: false,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: [],
      stop: async () => ({ ok: true }),
    }),
    registerSignalHandler: (signal, handler) => { handlers[signal] = handler },
    logger: { info() {}, error() {}, debug() {}, warn() {} },
    env: {},
  })

  await handlers.SIGTERM()
  assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.PROCESS_STARTED), false, "process-start publication must remain pending until Journal subscriber readiness")
  assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.STOPPED), true, "stopped-event publication must not await the process-start publication promise")
})

test("does not await process-start publication before emitting the startup-failed event", { timeout: 1000 }, async () => {
  const events = []
  const eventBus = {
    publish(event) {
      events.push(event)
      return { ok: true, event }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({ ok: true, closed: true }),
  }
  const journalService = {
    ready: new Promise(() => {}),
    close: async () => ({ ok: true, closed: true }),
  }
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      createEventBus: () => eventBus,
      createJournalService: () => journalService,
      start: async () => { throw new Error("optional startup failure") },
      logger: { info() {}, error() {}, debug() {}, warn() {} },
      env: {},
    })
    assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.PROCESS_STARTED), false, "process-start publication must remain pending until Journal subscriber readiness")
    assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.STARTUP_FAILED), true, "startup-failed event publication must not await the process-start publication promise")
  } finally {
    process.exitCode = previousExitCode
  }
})


test("uses TRADING_MODE=live for Binance LIVE and acquires the single-writer lock", async () => {
  const tradingConfig = { strategies: { CG_coinGrabber: { enabled: true } } }
  let lockCalls = 0
  let startInput
  await main({
    env: { NODE_ENV: "development", TRADING_MODE: "live" },
    loadConfig: async () => tradingConfig,
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      flush: async () => ({ ok: true, durable: true }),
      close: async () => ({ ok: true, closed: true, durable: true }),
      status: { state: "ready" },
    }),
    acquireProcessLock: async () => {
      lockCalls += 1
      return acquireProcessLock()
    },
    start: async (input) => {
      startInput = input
      return {
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
      }
    },
    logger: { info() {}, debug() {}, error() {} },
  })

  assert.equal(lockCalls, 1, "LIVE trading must acquire the same single-writer process lock as TESTNET.")
  assert.strictEqual(startInput.tradingConfig, tradingConfig, "Strategy and pair configuration must be passed unchanged to Harvester startup.")
  assert.equal(startInput.env.NODE_ENV, "development", "NODE_ENV must not select the exchange.")
  assert.equal(startInput.env.TRADING_MODE, "live", "TRADING_MODE must select Binance LIVE independently of NODE_ENV.")
})
