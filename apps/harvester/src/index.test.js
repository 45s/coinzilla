import test, { after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
// cspell:ignore unvalidated
import path, { isAbsolute as pathIsAbsolute } from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { appConfig as defaultAppConfig } from "../config/index.js"
import { main as startMain } from "./index.js"
import { describeProcessError } from "./infrastructure/process/describe-process-error.js"
import { prepareOptionalJournal } from "./infrastructure/journal/prepare-optional-journal.js"
import { UnvalidatedMarketExchangeConstraintsError } from "./domain/market/errors/unvalidated-market-exchange-constraints-error.js"
import { StrategyId } from "./domain/strategies/strategy-ids.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true,
    disabled: true }),
  status: {
    state: "disabled",
    enabled: false,
  },
  flush: async () => ({ ok: true,
    durable: true }),
  close: async () => ({ ok: true,
    closed: true,
    disabled: true }),
})

const acquireProcessLock = async () => ({
  ok: true,
  release: async () => ({ ok: true,
    released: true }),
})

const main = (options = {}) => {
  const { createJournalService = disabledJournalService, env = {}, ...rest } = options
  return startMain({
    acquireProcessLock,
    createOperationalStateStore: () => ({
      initializeIfEmpty: async () => ({
        ok: true,
        data: {
          ready: true,
          initialized: false,
        },
      }),
      verify: async () => ({ ok: true,
        data: { valid: true,
          durableWriteSupported: true } }),
    }),
    ...rest,
    env: { TRADING_MODE: "testnet",
      ...env },
    createJournalService: (...args) => {
      const service = createJournalService(...args) ?? {}
      if (!Object.hasOwn(service, "ready")) {
        service.ready = Promise.resolve({ ok: true })
      }
      if (!Object.hasOwn(service, "flush")) {
        service.flush = async () => ({ ok: true,
          durable: true })
      }
      if (!Object.hasOwn(service, "close")) {
        service.close = async () => ({ ok: true,
          closed: true })
      }
      return service
    },
  })
}
const confirmedRuntimeStopResult = () => ({
  ok: true,
  status: "STOPPED",
  data: { durableProcessStopAcknowledged: true },
})

const runMain = (options = {}) => main(options)

const createTestAppConfig = ({ operatorControlEnabled = false, allowedUserIds = [] } = {}) => {
  const config = structuredClone(defaultAppConfig)
  config.operatorControl.telegram = {
    enabled: operatorControlEnabled,
    allowedUserIds,
  }
  return config
}

function createStartupFailureCleanupOptions({
  calls,
  releaseResult,
  closeLogger,
  logger,
  eventBusFlushResult = { ok: true },
}) {
  return {
    acquireProcessLock: async () => ({
      ok: true,
      release: async () => {
        calls.push("lock-release")
        return releaseResult
      },
    }),
    createEventBus: () => ({
      publish: () => ({ ok: true }),
      flush: async () => eventBusFlushResult,
      close: async () => {
        calls.push("eventBus.close")
        return {
          ok: true,
          closed: true,
        }
      },
    }),
    createJournalService: () => ({
      status: { enabled: false },
      ready: Promise.resolve({
        ok: false,
        errors: [new Error("Journal readiness failed")],
      }),
      flush: async () => ({
        ok: true,
        durable: true,
      }),
      close: async () => {
        calls.push("journal.close")
        return {
          ok: true,
          closed: true,
          disabled: true,
        }
      },
    }),
    start: async () => {
      throw new Error("Runtime must not start before Journal readiness succeeds.")
    },
    closeLogger,
    logger,
  }
}

test("constructs and injects durable operational state for enabled RS while CG restart recovery is disabled", async () => {


  let storeCreated = false
  let startupInput
  const configuredApp = createTestAppConfig()
  configuredApp.components.recovery.enabled = true
  await runMain({
    loadConfig: async () => configuredApp,
    createOperationalStateStore: () => {
      storeCreated = true
      return {
        initializeIfEmpty: async () => ({
          ok: true,
          data: {
            ready: true,
            initialized: false,
          },
        }),
        verify: async () => ({
          ok: true,
          data: {
            valid: true,
            durableWriteSupported: true,
          },
        }),
      }
    },
    start: async (input) => {
      startupInput = input
      return { connected: false,
        tradingEnabled: false,
        strategyMode: "conservative",
        subscriptions: [] }
    },
    logger: { info() {},
      system() {},
      error() {} },
  })
  assert.equal(storeCreated, true, "Enabled RS must construct and verify the ADR-0001 Operational State Store.")
  assert.ok(startupInput.operationalStateStore, "Enabled RS runtime startup must receive the verified durable STOP store.")
})

test("does not create or inject recovery storage when Telegram operator control is enabled without recovery", async () => {
  const configuredApp = createTestAppConfig({
    operatorControlEnabled: true,
    allowedUserIds: ["12345"],
  })
  configuredApp.strategies[StrategyId.RECOVERY_SELLER].enabled = false
  let storeFactoryCalls = 0
  let startupInput

  await runMain({
    loadConfig: async () => configuredApp,
    createOperationalStateStore: () => {
      storeFactoryCalls += 1
      throw new Error("Telegram CC must not construct ADR-0001 recovery storage when restart recovery is disabled.")
    },
    start: async (input) => {
      startupInput = input
      return { connected: false,
        tradingEnabled: false,
        strategyMode: "conservative",
        subscriptions: [] }
    },
    logger: { info() {},
      system() {},
      error() {} },
  })

  assert.equal(storeFactoryCalls, 0, "Telegram CC alone must not construct the process-owned recovery store.")
  assert.equal(startupInput.operationalStateStore, undefined, "Telegram CC must start without an injected recovery store.")
})

test("uses the injected logger after Binance TESTNET startup", async () => {
  const calls = []
  const logger = {
    info: (message) => calls.push({ level: "info",
      message }),
    system: (message) => calls.push({ level: "system",
      message }),
    error: (data) => calls.push({ level: "error",
      data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await runMain({
      start: async () => ({ connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: ["BTCUSDT"] }),
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
  let observedRuntimeSessionId
  await runMain({
    processIdentity,
    createJournalService: (input) => {
      observedIdentity = input.processIdentity
      return disabledJournalService()
    },
    start: async ({ runtimeSessionId }) => {
      observedRuntimeSessionId = runtimeSessionId
      return { connected: false }
    },
    logger: { info() {},
      system() {},
      error() {} },
  })
  assert.equal(observedIdentity, processIdentity)
  assert.equal(observedRuntimeSessionId, processIdentity.runtimeSessionId, "The exact process session ID must reach bootstrap for durable operator-fact attribution.")
})

test("logs startup failures as one structured logger argument", async () => {
  const calls = []
  const error = new Error("configuration failed")
  const logger = {
    info: (data) => calls.push({ level: "info",
      data }),
    system() {},
    error: (data) => calls.push({ level: "error",
      data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  let processLockReleaseCalls = 0
  try {
    await runMain({
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => {
          processLockReleaseCalls += 1
          return {
            ok: true,
            released: true,
          }
        },
      }),
      start: async () => { throw error },
      logger,
    })

    const startupFailures = calls.filter((call) => call.data?.message === "startup failed.")
    assert.equal(startupFailures.length, 1)
    assert.equal(startupFailures[0].level, "error")
    assert.equal(startupFailures[0].data.error, error)
    assert.equal(startupFailures[0].data.errorDetails.name, "Error")
    assert.equal(startupFailures[0].data.errorDetails.message, "configuration failed")
    assert.match(startupFailures[0].data.errorDetails.stack, /configuration failed/)
    assert.equal(processLockReleaseCalls, 0,
      "The process lock must remain held when runtime startup was attempted but did not complete.")
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
    logger: { info() {},
      system: (message) => messages.push(message),
      error() {} },
  })
  assert.deepEqual(messages, [
    "Connected; subscribed to 1 enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness.",
  ])
})

test("reports LIVE trading mode independently of NODE_ENV", async () => {
  const messages = []
  await runMain({
    env: { NODE_ENV: "development",
      TRADING_MODE: "live" },
    start: async () => ({
      connected: true,
      brokerName: "binance",
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: ["ZROUSDT"],
    }),
    logger: { info: (message) => messages.push(message),
      error() {} },
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
  let processLockReleaseCalls = 0
  try {
    await runMain({
      acquireProcessLock: async () => ({
        ok: true,
        release: async () => {
          processLockReleaseCalls += 1
          return {
            ok: true,
            released: true,
          }
        },
      }),
      start: async () => { throw error },
      logger: {
        info() {},
        debug() {},
        error: (data) => calls.push(data),
      },
    })
    const startupFailures = calls.filter((call) => call.message === "startup failed.")
    assert.equal(startupFailures.length, 1)
    assert.equal(startupFailures[0].errorDetails.name, "AggregateError")
    assert.equal(startupFailures[0].errorDetails.message, "startup and cleanup failed")
    assert.equal(startupFailures[0].errorDetails.errors[0].message, "broker request failed")
    assert.match(startupFailures[0].errorDetails.errors[0].stack, /broker request failed/)
    assert.equal(processLockReleaseCalls, 0,
      "The process lock must remain held when runtime startup was attempted but did not complete.")
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
      return { ok: true,
        event }
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
    logger: { info() {},
      error() {},
      debug() {} },
  })

  assert.equal(eventBusCreations, 1)
  assert.equal(typeof startupInput.eventPublisher.publish, "function")
  const event = { name: "harvester.test",
    source: "test",
    data: {} }
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
      data: { broker: "none",
        strategyMode: "conservative",
        enabledMarkets: [],
        tradingEnabled: false },
    },
    event,
  ], "the existing runtime-start event and caller-published events must retain their order after process provenance is added")
})

test("waits for required Journal readiness before starting Harvester", async () => {
  let resolveReady
  let markJournalCreated
  const journalCreated = new Promise((resolve) => { markJournalCreated = resolve })
  let runtimeStarted = false
  const journalService = {
    ready: new Promise((resolve) => { resolveReady = resolve }),
    status: { state: "starting" },
    close: async () => ({ ok: true,
      closed: true }),
  }

  journalService.flush = async () => ({ ok: true,
    durable: true })
  const pending = runMain({
    createJournalService: () => {
      markJournalCreated()
      return journalService
    },
    start: async () => {
      runtimeStarted = true
      return { connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: [] }
    },
    logger: { info() {},
      error() {},
      debug() {} },
  })
  await journalCreated
  assert.equal(runtimeStarted, false, "Trading startup must wait for the required Journal readiness barrier.")
  resolveReady({ ok: true })
  const result = await pending
  assert.equal(runtimeStarted, true)
  assert.equal(result.journalService, journalService)
  assert.equal(result.journalService.status.state, "starting")
})

async function assertProcessLifecycleEvents({ result, eventBus, events, handlers, subscription } = {}) {
  assert.ok(result)
  await eventBus.flush()
  assert.equal(events.length, 2)
  assert.equal(events[0].name, HARVESTER_EVENT_NAMES.PROCESS_STARTED)
  assert.equal(events[1].name, HARVESTER_EVENT_NAMES.STARTED)
  assert.deepEqual(events[1].data, {
    broker: "binance",
    strategyMode: "conservative",
    enabledMarkets: ["BTCUSDT"],
    tradingEnabled: true,
  })
  await handlers.SIGTERM()
  await eventBus.flush()
  assert.equal(events.length, 3)
  assert.equal(events[2].name, HARVESTER_EVENT_NAMES.STOPPED)
  assert.deepEqual(events[2].data, {
    reason: "SIGTERM",
    outcome: "success",
  })
  subscription.subscription.unsubscribe()
  await eventBus.close()
}

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
    createJournalService: () => ({ status: { state: "disabled" },
      close: async () => ({ ok: true,
        closed: true }) }),
    env: {},
    start: async () => ({
      connected: true,
      brokerName: "binance",
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: [],
      appConfig: {
        strategies: {
          CG_coinGrabber: {
            pairs: {
              BTCUSDT: {
                enabled: true,
                tradingEnvironment: "both",
              },
            },
          },
        },
      },
      stop: async () => ({
        ok: true,
        status: "STOPPED",
        data: { durableProcessStopAcknowledged: true },
      }),
    }),
    registerSignalHandler: (...signalHandlerArguments) => {
      const [signal, handler] = signalHandlerArguments
      handlers[signal] = handler
    },
    logger: { info() {},
      error() {},
      debug() {} },
  })

  await assertProcessLifecycleEvents({
    result,
    eventBus,
    events,
    handlers,
    subscription,
  })
})

test("does not publish STOPPED when runtime.stop rejects", async () => {
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
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        handlers[signal] = handler
      },
      logger: { info() {},
        error() {},
        debug() {} },
    })

    await handlers.SIGINT()
    await eventBus.flush()
    assert.equal(process.exitCode, 1, "A failed runtime shutdown must set a non-zero process exit code.")
    assert.equal(events.length, 2, "A failed runtime shutdown must retain startup events without publishing a false STOPPED event.")
    assert.equal(events.at(-1).name, HARVESTER_EVENT_NAMES.STARTED, "The last lifecycle event must remain STARTED when runtime shutdown is unproven.")
    assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.STOPPED), false, "Harvester must never publish STOPPED when runtime safety was not confirmed.")
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
      logger: { info() {},
        debug() {},
        error() {} },
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
      operations.push(`publish:${event.name}`)
      return { ok: true,
        event }
    },
    close: async () => {
      operations.push("eventBus.close")
      return {
        ok: true,
        closed: true,
      }
    },
    flush: async () => ({ ok: true }),
  }
  const journalService = {
    close: async () => {
      operations.push("journal.close")
      return { ok: true,
        closed: true,
        durable: true }
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
      stop: async () => {
        operations.push("runtime.stop")
        return confirmedRuntimeStopResult()
      },
    }),
    registerSignalHandler: (...signalHandlerArguments) => {
      const [signal, handler] = signalHandlerArguments
      handlers[signal] = handler
    },
    logger: { info() {},
      error() {},
      debug() {} },
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
    publish: (event) => { operations.push(`publish:${event.name}`); return { ok: true,
        event } },
    close: async (options) => {
      operations.push(`eventBus.close:${options.timeoutMs}`)
      return { ok: true,
        closed: true }
    },
    flush: async () => ({ ok: true }),
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
        stop: async () => {
        operations.push("runtime.stop")
        return {
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }
      },
      }),
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        handlers[signal] = handler
      },
      logger: { info() {},
        debug() {},
        error() {} },
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
    publish: (event) => { operations.push(`publish:${event.name}`); return { ok: true,
        event } },
    close: async (options) => {
      operations.push(`eventBus.close:${options.timeoutMs}`)
      return { ok: false,
        timedOut: true,
        errors: [new Error("EventBus close timed out")] }
    },
    flush: async () => ({ ok: true }),
  }
  const journalService = {
    close: async () => {
      operations.push("journal.close")
      return { ok: true,
        closed: true,
        durable: true }
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
        stop: async () => {
        operations.push("runtime.stop")
        return {
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }
      },
      }),
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        handlers[signal] = handler
      },
      logger: { info() {},
        debug() {},
        error() {} },
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
    publish: (event) => { operations.push(`publish:${event.name}`); return { ok: true,
        event } },
    close: async () => { operations.push("eventBus.close"); return { ok: true } },
    flush: async () => ({ ok: true }),
  }
  const journalService = {
    close: async () => {
      operations.push("journal.close")
      return {
        ok: true,
        closed: true,
        durable: true,
      }
    },
  }
  await main({
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    start: async () => ({
      connected: false,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: [],
      stop: async () => {
        operations.push("runtime.stop")
        await stopGate
        return {
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }
      },
    }),
    registerSignalHandler: (...signalHandlerArguments) => {
      const [signal, handler] = signalHandlerArguments
      handlers[signal] = handler
    },
    logger: { info() {},
      debug() {},
      error() {} },
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
    publish: (event) => { operations.push(`publish:${event.name}`); return { ok: true,
        event } },
    close: async () => { operations.push("eventBus.close"); return { ok: true } },
    flush: async () => ({ ok: true }),
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
      logger: { info() {},
        debug() {},
        error() {} },
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


test("reports an ambiguous process-lock release after startup logger cleanup", async () => {
  const diagnostics = []
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main(createStartupFailureCleanupOptions({
      calls,
      releaseResult: { ok: true },
      closeLogger: async () => {
        calls.push("logger.close")
      },
      logger: {
        info() {},
        debug() {},
        error: ({ message }) => diagnostics.push(message),
      },
    }))
    assert.equal(process.exitCode, 1)
    assert.deepEqual(calls, [
      "journal.close",
      "eventBus.close",
      "logger.close",
      "lock-release",
    ])
    assert.ok(
      diagnostics.includes("observability shutdown incomplete"),
      "An ambiguous lock-release result must be reported as incomplete cleanup.",
    )
  } finally {
    process.exitCode = previousExitCode
  }
})




test("retains the process lock when startup logger cleanup fails", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main(createStartupFailureCleanupOptions({
      calls,
      releaseResult: {
        ok: true,
        released: true,
      },
      closeLogger: async () => {
        calls.push("logger.close")
        throw new Error("Logger close failed")
      },
      logger: {
        info() {},
        debug() {},
        error() {},
      },
    }))
    assert.deepEqual(calls, [
      "journal.close",
      "eventBus.close",
      "logger.close",
    ], "The process lock must remain held when logger shutdown is not confirmed.")
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when startup EventBus flush is not confirmed", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main(createStartupFailureCleanupOptions({
      calls,
      releaseResult: {
        ok: true,
        released: true,
      },
      eventBusFlushResult: {
        ok: false,
        errors: [new Error("EventBus flush failed")],
      },
      closeLogger: async () => {
        calls.push("logger.close")
      },
      logger: {
        info() {},
        debug() {},
        error() {},
      },
    }))
    assert.deepEqual(calls, [
      "journal.close",
      "eventBus.close",
      "logger.close",
    ], "The process lock must remain held when startup EventBus flush is not confirmed.")
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains the process lock when startup logger returns an explicit failure", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main(createStartupFailureCleanupOptions({
      calls,
      releaseResult: {
        ok: true,
        released: true,
      },
      closeLogger: async () => {
        calls.push("logger.close")
        return {
          ok: false,
          errors: [new Error("Logger close failed")],
        }
      },
      logger: {
        info() {},
        debug() {},
        error() {},
      },
    }))
    assert.deepEqual(calls, [
      "journal.close",
      "eventBus.close",
      "logger.close",
    ], "The process lock must remain held when logger close returns an explicit failure.")
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
    const processIdentity = createJournalIntegrationProcessIdentity()
    const result = await main({
      processIdentity,
      createEventBus: () => eventBus,
      createJournalService: (input) => prepareOptionalJournal({ ...input,
        directory }),
      start: async () => ({
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => ({
        ok: true,
        status: "STOPPED",
        data: { durableProcessStopAcknowledged: true },
      }),
      }),
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        handlers[signal] = handler
      },
      logger: { info() {},
        debug() {},
        error() {} },
    })
    const ready = await result.journalService.ready
    assert.equal(ready.ok, true)
    assert.equal(result.journalService.status.state, "ready")

    await handlers.SIGTERM()
    assert.equal(result.journalService.status.state, "closed")
    assert.equal(result.journalService.status.closed, true)

    await assertDurableJournalSession({ directory })
  } finally {
    process.exitCode = previousExitCode
    await rm(directory, { recursive: true,
      force: true })
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
        ready: Promise.resolve({ ok: false,
          errors: [new Error("disk unavailable")] }),
        flush: async () => ({
      ok: true,
      durable: true,
    }),
        close: async () => ({ ok: true,
          closed: true }),
      }),
      start: async () => { started = true; return { connected: false } },
      logger: { info() {},
        error() {},
        debug() {} },
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
        recovery: Promise.resolve({ ok: true,
          available: true,
          records: [],
          count: 0 }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: true,
          closed: true }),
      }),
      start: async () => { started = true; return { connected: false,
          tradingEnabled: true } },
      logger: { info() {},
        error() {},
        debug() {} },
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
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: true,
          closed: true }),
      }),
      start: async () => { started = true; return { connected: false,
          tradingEnabled: true } },
      registerSignalHandler() {},
      logger: { info() {},
        error() {},
        debug() {} },
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
          records: [{ id: "old-fill",
            payload: { name: "execution.fill_applied" } }],
        }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: true,
          closed: true }),
      }),
      start: async (input) => {
        startupInput = input
        return { connected: false,
          tradingEnabled: false }
      },
      logger: { info() {},
        error() {},
        debug() {} },
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
        records: [{ id: "old-fill",
          payload: { name: "execution.fill_applied",
            source: "harvester" } }],
      }),
      flush: async () => ({ ok: true,
        durable: true }),
      close: async () => ({ ok: true,
        closed: true }),
    }),
    start: async () => { started = true; return { connected: false,
        tradingEnabled: false } },
    logger: { info() {},
      error() {},
      debug() {} },
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
        recovery: Promise.resolve({ ok: false,
          errors: [new Error("legacy history is malformed")] }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: true,
          closed: true }),
      }),
      start: async () => { started = true; return { connected: false,
          tradingEnabled: true } },
      logger: { info() {},
        error() {},
        debug() {} },
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
      logger: { info() {},
        error() {},
        debug() {} },
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
        release: async () => {
          sequence.push("lock-release")
          return {
            ok: true,
            released: true,
          }
        },
      }),
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true,
          available: true,
          records: [] }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => { sequence.push("journal-close"); return { ok: true,
            closed: true,
            durable: true } },
      }),
      start: async () => ({
        connected: true,
        tradingEnabled: true,
        subscriptions: [],
        stop: async () => {
          sequence.push("runtime-stop")
          return {
            ok: true,
            status: "STOPPED",
            data: { durableProcessStopAcknowledged: true },
          }
        },
      }),
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        if (signal === "SIGTERM") {
          signalHandler = handler
        }
      },
      logger: { info() {},
        error() {},
        debug() {} },
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
      env: {
        NODE_ENV: "development",
      },
      acquireProcessLock: createTestProcessLock({ sequence }),
      createJournalService: () => {
        sequence.push("journal")
        return {
          ready: Promise.resolve({ ok: true }),
          flush: async () => ({ ok: true,
            durable: true }),
          close: async () => { sequence.push("journal-close"); return { ok: true,
              closed: true,
              durable: true } },
        }
      },
      start: async (input) => {
        sequence.push("start")
        assert.equal(Object.hasOwn(input, "journalRecoveryRecords"), false)
        return {
          connected: true,
          tradingEnabled: false,
          subscriptions: [],
          stop: async () => {
            sequence.push("runtime-stop")
            return {
              ok: true,
              status: "STOPPED",
              data: {
                durableProcessStopAcknowledged: true,
              },
            }
          },
        }
      },
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        if (signal === "SIGTERM") {
          signalHandler = handler
        }
      },
      logger: { info() {},
        error() {},
        debug() {} },
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
        release: async () => { releaseCalls += 1; return { ok: true,
            released: true } },
      }),
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true,
          available: true,
          records: [] }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: true,
          closed: true }),
      }),
      start: async () => ({
        connected: true,
        tradingEnabled: true,
        subscriptions: [],
        stop: async () => { throw new Error("broker intake did not stop") },
      }),
      registerSignalHandler: (...signalHandlerArguments) => {
        const [signal, handler] = signalHandlerArguments
        if (signal === "SIGTERM") {
          signalHandler = handler
        }
      },
      logger: { info() {},
        error() {},
        debug() {} },
    })
    await signalHandler()
    assert.equal(releaseCalls, 0)
    assert.equal(process.exitCode, 1)
    process.exitCode = 0
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
        release: async () => { releaseCalls += 1; return { ok: true,
            released: true } },
      }),
      createJournalService: () => ({
        status: { started: false },
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true,
          available: true,
          records: [] }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: false,
          errors: [new Error("writer close failed")] }),
      }),
      start: async () => { throw new Error("runtime startup failed") },
      registerSignalHandler() {},
      logger: { info() {},
        system() {},
        error() {},
        debug() {} },
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
      createJournalService: () => ({ ready: Promise.resolve({ ok: true }),
        flush: undefined,
        close: async () => ({ ok: true,
          closed: true }) }),
      start: async () => { started = true; return { connected: true,
          tradingEnabled: true } },
      logger: { info() {},
        error() {},
        debug() {} },
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
        release: async () => { releaseCalls += 1; return { ok: true,
            released: true } },
      }),
      createJournalService: () => ({
        ready: Promise.resolve({ ok: true }),
        recovery: Promise.resolve({ ok: true,
          available: true,
          records: [] }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => { journalCloseCalls += 1; return { ok: true,
            closed: true } },
      }),
      start: async () => {
        throw new Error("broker startup failed after connection attempt")
      },
      registerSignalHandler() {},
      logger: { info() {},
        error() {},
        debug() {} },
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
      publish: (event) => ({
        ok: true,
        event,
      }),
      flush: async () => ({
        ok: true,
        durable: true,
      }),
      close: async () => { operations.push("eventBus.close"); return { ok: true } },
    }),
    createJournalService: () => ({
      status: { enabled: true },
      close: async () => {
        operations.push("journal.close")
        return {
          ok: true,
          closed: true,
          durable: true,
        }
      },
    }),
    start: async () => ({
      connected: false,
      stop: async () => {
        operations.push("runtime.stop")
        return {
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }
      },
    }),
    registerSignalHandler: (...signalHandlerArguments) => {
      const [signal, handler] = signalHandlerArguments
      handlers[signal] = handler
    },
    logger: { info() {},
      error() {} },
    closeLogger: async () => { operations.push("logger.close") },
  })

  await handlers.SIGTERM()
  assert.deepEqual(operations, [
    "runtime.stop",
    "journal.close",
    "eventBus.close",
    "logger.close",
  ])
})


const createProcessProvenanceIdentity = () => ({
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
})

function createProcessProvenanceScenarioContext() {
  const operations = []
  const events = []
  const contexts = []
  const processIdentity = createProcessProvenanceIdentity()
  return {
    operations,
    events,
    contexts,
    processIdentity,
    eventBus: createProvenanceEventBus({
      events,
      operations,
    }),
    logger: createProvenanceLogger({
      contexts,
      operations,
    }),
  }
}

const captureProcessProvenanceScenario = async () => {
  const scenario = createProcessProvenanceScenarioContext()
  let journalFlushCalls = 0
  let journalWriteFlushCalls = 0

  await main({
    processIdentity: scenario.processIdentity,
    logger: scenario.logger,
    createEventBus: () => {
      scenario.operations.push("eventBus.create")
      return scenario.eventBus
    },
    acquireProcessLock: async () => {
      scenario.operations.push("processLock.acquire")
      return {
        ok: true,
        release: async () => ({
          ok: true,
          released: true,
        }),
      }
    },
    createJournalService: () => createProvenanceJournal({
      operations: scenario.operations,
      onFlush: () => { journalFlushCalls += 1 },
      onWriteFlush: () => { journalWriteFlushCalls += 1 },
    }),
    start: async ({ eventPublisher }) => {
      scenario.operations.push("runtime.start")
      await eventPublisher.flush()
      const writeFlushResult = await eventPublisher.flushWrites()
      assert.equal(writeFlushResult.ok, true, "The process publisher must expose the Journal write-only flush.")
      assert.equal(writeFlushResult.durable, true, "The process publisher must preserve durable write confirmation.")
      return {
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
      }
    },
    registerSignalHandler: () => {},
    env: {
      NODE_ENV: "development",
    },
  })
  return {
    operations: scenario.operations,
    events: scenario.events,
    contexts: scenario.contexts,
    journalFlushCalls,
    journalWriteFlushCalls,
  }
}

test("captures process provenance before trading startup and publishes it separately from runtime startup", async () => {
  const { operations, events, contexts, journalFlushCalls, journalWriteFlushCalls } = await captureProcessProvenanceScenario()
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
  assert.equal(journalWriteFlushCalls, 1, "The write-only barrier must be wired to the process publisher.")
  assert.ok(operations.indexOf("publish:harvester.process_started") < operations.indexOf("runtime.start"), "trading bootstrap must start only after the process event has been admitted to the existing Journal/EventBus pipeline")
})

test("preserves terminal Journal write-failure classification at the Harvester composition boundary", async () => {
  const writeError = new Error("Journal writer is poisoned after a previous append failure")
  let flushResult
  await runMain({
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      status: { state: "degraded",
        started: true,
        closed: false,
        writeFailed: true,
        writeErrorCount: 1 },
      flush: async () => ({ ok: false,
        errors: [writeError] }),
      close: async () => ({ ok: true,
        closed: true,
        durable: false }),
    }),
    start: async ({ eventPublisher }) => {
      flushResult = await eventPublisher.flush()
      return {
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => ({
        ok: true,
        status: "STOPPED",
        data: { durableProcessStopAcknowledged: true },
      }),
      }
    },
    logger: { info() {},
      system() {},
      error() {} },
    registerSignalHandler: () => {},
  })

  assert.equal(flushResult.ok, false, "A failed Journal write must remain a failed durable flush.")
  assert.equal(flushResult.errors[0], writeError, "The original Journal write error must remain available.")
  assert.deepEqual(
    flushResult.recoveryFailure,
    { category: "DURABILITY",
      stage: "JOURNAL_WRITE_FAILURE",
      retryable: false },
    "A poisoned Journal writer must expose an explicit terminal recovery classification.",
  )
})

test("classifies a failed flush as retryable only while the Journal writer is healthy", async () => {
  const syncError = Object.assign(new Error("simulated file sync failure"), { code: "EIO" })
  let flushResult
  await runMain({
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      status: { state: "degraded",
        started: true,
        closed: false,
        writeFailed: false,
        writeErrorCount: 0 },
      flush: async () => ({ ok: false,
        errors: [syncError] }),
      close: async () => ({ ok: true,
        closed: true,
        durable: false }),
    }),
    start: async ({ eventPublisher }) => {
      flushResult = await eventPublisher.flush()
      return { connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => {} }
    },
    logger: { info() {},
      system() {},
      error() {} },
    registerSignalHandler: () => {},
  })
  assert.deepEqual(flushResult.recoveryFailure, {
    category: "DURABILITY",
    stage: "JOURNAL_FLUSH_FAILURE",
    retryable: true,
  })
})

test("fails closed when process Journal publisher lacks write-only flush capability", async () => {
  let flushResult
  await runMain({
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      status: {
        state: "ready",
        started: true,
        closed: false,
        writeFailed: false,
        writeErrorCount: 0,
      },
      flush: async () => ({
        ok: true,
        durable: true,
      }),
      close: async () => ({
        ok: true,
        closed: true,
        durable: true,
      }),
    }),
    start: async ({ eventPublisher }) => {
      flushResult = await eventPublisher.flushWrites()
      return {
        connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => ({
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }),
      }
    },
    logger: {
      info() {},
      system() {},
      error() {},
    },
    registerSignalHandler: () => {},
  })

  assert.equal(flushResult.ok, false, "The process publisher must fail closed without Journal write-only durability.")
  assert.match(flushResult.errors[0].message, /write-only durable flush is unavailable/)
  assert.deepEqual(flushResult.recoveryFailure, {
    category: "DURABILITY",
    stage: "JOURNAL_FLUSH_FAILURE",
    retryable: true,
  })
})

test("fails closed when Journal health metadata cannot classify a failed flush", async () => {
  let flushResult
  await runMain({
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      status: { state: "degraded" },
      flush: async () => ({ ok: false,
        errors: [new Error("unclassified flush failure")] }),
      close: async () => ({ ok: true,
        closed: true,
        durable: false }),
    }),
    start: async ({ eventPublisher }) => {
      flushResult = await eventPublisher.flush()
      return { connected: false,
        tradingEnabled: false,
        strategyMode: "read-only",
        subscriptions: [],
        stop: async () => {} }
    },
    logger: { info() {},
      system() {},
      error() {} },
    registerSignalHandler: () => {},
  })
  assert.deepEqual(flushResult.recoveryFailure, {
    category: "DURABILITY",
    stage: "JOURNAL_FLUSH_UNCLASSIFIED",
    retryable: false,
  })
})

test("requires Journal readiness and publishes process provenance before trading startup", async () => {
  let resolveJournalReady
  let resolveProcessStarted
  let runtimeStarted = false
  const contexts = []
  const events = []
  const processStarted = new Promise((resolve) => { resolveProcessStarted = resolve })
  const journalService = createDelayedJournalService({ onReady: (resolve) => { resolveJournalReady = resolve } })
  const eventBus = createProcessStartedEventBus({
    events,
    resolveProcessStarted,
  })

  const pending = main({
    processIdentity: createDelayedJournalProcessIdentity(),
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
        stop: async () => ({
        ok: true,
        status: "STOPPED",
        data: { durableProcessStopAcknowledged: true },
      }),
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
  assert.equal(contexts[0].runtimeSessionId, "delayed-journal-session", "logger context must be available synchronously while the required Journal readiness barrier is pending")
  assert.equal(events.some((event) => event.name === "harvester.process_started"), true, "the process-start event is published after Journal readiness")
  const processStartedEvent = await processStarted
  assert.equal(processStartedEvent.data.startedAt, "2026-11-09T10:15:30.000Z", "delayed Journal publication must retain the original process-entry timestamp")
  assert.equal(processStartedEvent.data.source.metadataSource, "unavailable", "unavailable Git provenance must remain explicit rather than guessed")
})

test("retains immediate logger provenance when the optional Journal is disabled", async () => {
  const contexts = []
  const events = []
  const eventBus = createRecordingEventBus({ events })

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
    logger: { setContext: (context) => contexts.push(context),
      info() {},
      system() {},
      error() {},
      warn() {} },
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
      return { ok: true,
        event }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({ ok: true,
      closed: true }),
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
      logger: { setContext() {},
        info() {},
        error() {},
        warn() {} },
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
      return { ok: true,
        event }
    },
  }

  await main({
    processIdentity: createUnavailableJournalProcessIdentity(),
    logger: {
      setContext: (context) => contexts.push(context),
      warn() {},
      info() {},
      system() {},
      error() {},
    },
    createEventBus: () => eventBus,
    createJournalService: () => ({
      ready: Promise.resolve({ ok: false,
        errors: [new Error("Journal unavailable")] }),
      flush: async () => ({ ok: true,
        durable: true }),
      close: async () => ({ ok: true,
        closed: true }),
    }),
    start: async () => {
      runtimeStarted = true
      return { connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: [] }
    },
    env: {},
  })
  assert.equal(runtimeStarted, false, "Trading must not start when the required Journal is unavailable")
  assert.equal(process.exitCode, 1, "A required Journal readiness failure must fail startup")
  assert.equal(contexts[0].runtimeSessionId, "journal-unavailable-session", "logger context must remain available when Journal initialization fails")
  assert.equal(events.some((event) => event.name === HARVESTER_EVENT_NAMES.PROCESS_STARTED), false, "The process-start event must not be published before Journal readiness")
  process.exitCode = previousExitCode
})


test("does not register runtime shutdown handlers before the required Journal is ready", async () => {
  let resolveReady
  let markJournalCreated
  const journalCreated = new Promise((resolve) => { markJournalCreated = resolve })
  const registered = []
  let started = false
  const pending = main({
    createJournalService: () => {
      markJournalCreated()
      return {
        ready: new Promise((resolve) => { resolveReady = resolve }),
        flush: async () => ({ ok: true,
          durable: true }),
        close: async () => ({ ok: true,
          closed: true }),
      }
    },
    start: async () => {
      started = true
      return { connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: [],
        stop: async () => ({ ok: true }) }
    },
    registerSignalHandler: (signal) => registered.push(signal),
    logger: { info() {},
      system() {},
      error() {},
      warn() {} },
    env: {},
  })
  await journalCreated
  assert.equal(started, false)
  assert.deepEqual(registered, [])
  resolveReady({ ok: true })
  await pending
  assert.equal(started, true)
  assert.deepEqual(registered, ["SIGINT", "SIGTERM"])
})


test("fails before acquiring a lock when TRADING_MODE is missing", async () => {
  let lockCalls = 0
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      env: { TRADING_MODE: undefined },
      acquireProcessLock: async () => {
        lockCalls += 1
        return acquireProcessLock()
      },
      logger: { info() {},
        system() {},
        error() {},
        warn() {} },
    })
    assert.equal(lockCalls, 0, "Missing mode must fail before acquiring process or broker resources")
    assert.equal(process.exitCode, 1, "Missing TRADING_MODE must fail startup")
  } finally {
    process.exitCode = previousExitCode
  }
})


test("uses TRADING_MODE=live for Binance LIVE and acquires the single-writer lock", async () => {
  const appConfig = createTestAppConfig()
  let lockCalls = 0
  let startInput
  await main({
    env: { NODE_ENV: "development",
      TRADING_MODE: "live" },
    loadConfig: async () => appConfig,
    createJournalService: () => ({
      ready: Promise.resolve({ ok: true }),
      flush: async () => ({ ok: true,
        durable: true }),
      close: async () => ({ ok: true,
        closed: true,
        durable: true }),
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
    logger: { info() {},
      debug() {},
      error() {} },
  })

  assert.equal(lockCalls, 1, "LIVE trading must acquire the same single-writer process lock as TESTNET.")
  assert.strictEqual(startInput.appConfig, appConfig, "Application configuration must be passed unchanged to Harvester startup.")
  assert.equal(startInput.env.NODE_ENV, "development", "NODE_ENV must not select the exchange.")
  assert.equal(startInput.env.TRADING_MODE, "live", "TRADING_MODE must select Binance LIVE independently of NODE_ENV.")
})


test("keeps Harvester process ownership locks outside the application logs directory", async () => {
  let receivedLockDirectories
  await main({
    loadConfig: async () => ({}),
    createJournalService: disabledJournalService,
    acquireProcessLock: async (input) => {
      receivedLockDirectories = {
        journal: input.journalDirectory,
        global: input.globalDirectory,
      }
      return acquireProcessLock()
    },
    start: async () => ({
      connected: false,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: [],
    }),
    logger: { info() {},
      system() {},
      error() {},
      warn() {} },
    env: { TRADING_MODE: "testnet" },
  })

  assert.equal(
    receivedLockDirectories.journal,
    receivedLockDirectories.global,
    "The application and broker ownership locks must share the dedicated runtime lock directory",
  )
  assert.equal(
    path.basename(receivedLockDirectories.global),
    "process-locks",
    "Process ownership locks must be stored under the dedicated process-lock directory, not under logs",
  )
  assert.equal(
    receivedLockDirectories.global.includes(path.join("apps", "harvester", "logs")),
    false,
    "The Harvester logs tree must contain log/session artifacts rather than trading-process ownership locks",
  )
})


test("preserves typed market-readiness diagnostics in fatal startup logs", async () => {
  const calls = []
  const error = new UnvalidatedMarketExchangeConstraintsError({
    symbol: "LINKFDUSD",
    constraints: [
      { type: "DYNAMIC_PRICE_BAND",
        scope: "SYMBOL",
        sourceFilterType: "PERCENT_PRICE_BY_SIDE" },
      { type: "ASSET_ORDER_LIMIT",
        scope: "ACCOUNT",
        sourceFilterType: "MAX_ASSET" },
    ],
  })
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
    const startupFailure = calls.find((call) => call.message === "startup failed.")
    assert.ok(startupFailure, "A fatal market-readiness error must produce a startup-failure diagnostic.")
    assert.equal(startupFailure.errorCode, error.code, "The compact startup diagnostic must expose the stable market-readiness error code.")
    assert.equal(startupFailure.symbol, "LINKFDUSD", "The compact startup diagnostic must identify the blocked market.")
    assert.equal(startupFailure.errorDetails.name, "UnvalidatedMarketExchangeConstraintsError", "The structured error details must preserve the domain-specific error name.")
    assert.equal(startupFailure.errorDetails.code, error.code, "The structured error details must preserve the stable error code.")
    assert.deepEqual(startupFailure.errorDetails.details.constraints, error.constraints, "The structured error details must retain every unvalidated exchange filter.")
    assert.match(startupFailure.errorDetails.stack, /LINKFDUSD/, "The fatal startup stack must point to the exact blocked market.")
    assert.equal(process.exitCode, 1, "A blocked market must continue to fail startup rather than bypass readiness.")
  } finally {
    process.exitCode = previousExitCode
  }
})


test("does not construct the Operational State Store for a stale ledger path when CG recovery and RS are disabled", async () => {
  let storeCreated = false
  let journalCreated = false
  let runtimeStarted = false
  await runMain({
    loadConfig: async () => {
      const configuredApp = createTestAppConfig()
      configuredApp.strategies[StrategyId.RECOVERY_SELLER].enabled = false
      return configuredApp
    },
    env: { OPERATIONAL_STATE_DIRECTORY: "relative/recovery-facts" },
    createOperationalStateStore: () => {
      storeCreated = true
      throw new Error("restart recovery and Telegram operator control are disabled")
    },
    createJournalService: () => {
      journalCreated = true
      return disabledJournalService()
    },
    start: async (input) => {
      runtimeStarted = true
      assert.equal(input.operationalStateStore, undefined)
      return { connected: false }
    },
    logger: { info() {},
      system() {},
      error() {} },
  })
  assert.equal(storeCreated, false, "Disabled restart recovery must not construct or verify the Operational State Store.")
  assert.equal(journalCreated, true, "An unused recovery directory must not prevent normal Journal startup.")
  assert.equal(runtimeStarted, true, "A missing or malformed recovery directory must not block startup while recovery is disabled.")
})

async function startProcessWithUnresolvedStrategyShutdown({ calls } = {}) {
  const signalHandlers = new Map()
  const unsafeShutdown = new Error("BTCUSDT owned BUY remains UNKNOWN")
  const eventBus = {
    publish: () => ({ ok: true }),
    flush: async () => ({ ok: true }),
    close: async () => {
      calls.push("event-bus-close")
      return { ok: true }
    },
  }
  const journalService = {
    ready: Promise.resolve({ ok: true }),
    flush: async () => ({ ok: true,
      durable: true }),
    close: async () => {
      calls.push("journal-close")
      return { ok: true,
        closed: true }
    },
  }
  const logger = {
    info() {},
    system() {},
    error: () => calls.push("logger-error"),
  }
  await runMain({
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    acquireProcessLock: async () => ({
      ok: true,
      release: async () => {
        calls.push("process-lock-release")
        return {
          ok: true,
          released: true,
        }
      },
    }),
    registerSignalHandler: (...args) => {
      const [signal, handler] = args
      signalHandlers.set(signal, handler)
    },
    closeLogger: async () => calls.push("logger-close"),
    start: async () => ({
      connected: true,
      brokerName: "binance",
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: ["BTCUSDT"],
      stop: async () => {
        calls.push("runtime-stop")
        throw unsafeShutdown
      },
    }),
    logger,
  })
  return signalHandlers
}

test("retains Journal, EventBus, process lock and logger when strategy shutdown safety is unresolved", async () => {
  const calls = []
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const signalHandlers = await startProcessWithUnresolvedStrategyShutdown({ calls })
    await signalHandlers.get("SIGINT")()
    assert.equal(process.exitCode, 1, "An unproven strategy shutdown must fail the process exit status.")
    assert.deepEqual(
      calls.filter((call) => [
        "event-bus-close",
        "journal-close",
        "process-lock-release",
        "logger-close",
      ].includes(call)),
      [],
      "An unresolved trading-safety proof must retain Journal, EventBus, the process lock and logging so recovery evidence remains available.",
    )
    assert.ok(
      calls.includes("logger-error"),
      "The failed shutdown attempt must report the exact safety blocker while leaving required runtime services connected.",
    )
    process.exitCode = 0
  } finally {
    process.exitCode = previousExitCode
  }
})


function createJournalIntegrationProcessIdentity() {
  return {
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
}

async function assertDurableJournalSession({ directory }) {
  const sessionDirectory = path.join(directory, "sessions", "2026-11-09_12-34-56-journal-integration-test")
  const files = await readdir(sessionDirectory)
  assert.equal(files.length, 1)
  assert.equal(files[0], "2026-11-09_12-34-56-journal-integration-test.jsonl")
  const content = await readFile(path.join(sessionDirectory, files[0]), "utf8")
  const records = content.trim().split("\n").map((line) => JSON.parse(line))
  assert.ok(records.some((record) => record.name === "harvester.stopped"))
  assert.ok(records.every((record) => record.__coinzillaJournal?.schemaVersion === 1))
  assert.doesNotMatch(content, /apiKey|apiSecret|accessToken|password/)
}

function createTestProcessLock({ sequence }) {
  return async ({ journalDirectory, globalDirectory, broker, tradingMode }) => {
    sequence.push("lock")
    assert.equal(typeof journalDirectory, "string")
    assert.ok(pathIsAbsolute(journalDirectory))
    assert.ok(globalDirectory.includes(".coinzilla"))
    assert.ok(globalDirectory.endsWith("process-locks"))
    assert.equal(broker, "binance")
    assert.equal(tradingMode, "testnet")
    return {
      ok: true,
      release: async () => {
        sequence.push("release")
        return {
          ok: true,
          released: true,
        }
      },
    }
  }
}

function createProvenanceEventBus({ events, operations }) {
  return {
    publish(event) {
      events.push(event)
      operations.push(`publish:${event.name}`)
      return {
        ok: true,
        event,
      }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({
      ok: true,
      closed: true,
    }),
  }
}

function createProvenanceLogger({ contexts, operations }) {
  return {
    setContext(context) {
      contexts.push(context)
      operations.push("logger.context")
    },
    info() {},
    system() {},
    error() {},
  }
}

function createDelayedJournalService({ onReady }) {
  return {
    ready: new Promise(onReady),
    status: {
      state: "starting",
      enabled: true,
    },
    flush: async () => ({
      ok: true,
      durable: true,
    }),
    close: async () => ({
      ok: true,
      closed: true,
    }),
  }
}

function createProcessStartedEventBus({ events, resolveProcessStarted }) {
  return {
    publish(event) {
      events.push(event)
      if (event.name === "harvester.process_started") {
        resolveProcessStarted(event)
      }
      return {
        ok: true,
        event,
      }
    },
    flush: async () => ({ ok: true }),
    close: async () => ({
      ok: true,
      closed: true,
    }),
  }
}

function createUnavailableJournalProcessIdentity() {
  return {
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
  }
}

function createRecordingEventBus({ events }) {
  return {
    publish(event) {
      events.push(event)
      return {
        ok: true,
        event,
      }
    },
  }
}


function createProvenanceJournal({ operations, onFlush, onWriteFlush }) {
  operations.push("journal.create")
  return {
    ready: Promise.resolve({ ok: true }),
    flush: async () => {
      onFlush()
      return {
        ok: true,
        durable: true,
      }
    },
    flushWrites: async () => {
      onWriteFlush()
      return {
        ok: true,
        durable: true,
      }
    },
    close: async () => ({
      ok: true,
      closed: true,
      durable: true,
    }),
  }
}

function createDelayedJournalProcessIdentity() {
  return {
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
  }
}


after(() => {
  // Tests exercise startup failures that intentionally set the process exit code.
  // Reset it after assertions; the test runner reports assertion failures independently.
  process.exitCode = 0
})

test("does not initialize the optional trading-history API when its pre-launch component flag is disabled", async () => {
  const configuredApp = createTestAppConfig()
  configuredApp.components = {
    tradingHistoryApi: { enabled: false },
  }
  let apiStartCount = 0
  await runMain({
    loadConfig: async () => configuredApp,
    start: async () => ({
      stop: async () => ({ ok: true }),
    }),
    startTradingHistoryApi: async () => {
      apiStartCount += 1
      return {
        close: async () => ({
          ok: true,
          closed: true,
        }),
      }
    },
    logger: {
      info() {},
      system() {},
      warn() {},
      error() {},
    },
  })
  assert.equal(
    apiStartCount,
    0,
    "A disabled optional local API must not bind HTTP/WebSocket listeners or construct its runtime service.",
  )
})

test("does not construct or inject recovery storage when the master recovery component is disabled", async () => {
  const configuredApp = createTestAppConfig()
  configuredApp.components.recovery = { enabled: false }
  let storeFactoryCalls = 0
  let startupInput

  await runMain({
    loadConfig: async () => configuredApp,
    createOperationalStateStore: () => {
      storeFactoryCalls += 1
      throw new Error("The master recovery switch must prevent store construction.")
    },
    start: async (input) => {
      startupInput = input
      return {
        connected: false,
        tradingEnabled: false,
        strategyMode: "conservative",
        subscriptions: [],
      }
    },
    logger: {
      info() {},
      system() {},
      error() {},
    },
  })

  assert.equal(storeFactoryCalls, 0, "The disabled master switch must not construct the Operational State Store.")
  assert.equal(startupInput.operationalStateStore, undefined, "The disabled master switch must not inject an existing recovery store.")
})


test("keeps unknown native startup codes beside the catalogued startup wrapper", async () => {
  const calls = []
  const error = Object.assign(new Error("provider handshake failed"), {
    code: "ERR_PROVIDER_HANDSHAKE",
  })
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
    const startupFailure = calls.find((call) => call.message === "startup failed.")
    assert.ok(startupFailure, "A failed startup must produce the catalogued startup summary.")
    assert.equal(startupFailure.errorCode, "HARVESTER_STARTUP_FAILED", "Unknown native codes must use the stable startup catalog entry.")
    assert.equal(startupFailure.causeCode, "ERR_PROVIDER_HANDSHAKE", "The original native error code must remain visible beside the wrapper.")
    assert.equal(startupFailure.errorMessage, error.message, "The startup summary must preserve the concrete originating message.")
  } finally {
    process.exitCode = previousExitCode
  }
})


test("preserves nested process error identity while redacting credential-bearing text", () => {
  const secretBotToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  const nestedCause = Object.assign(
    new Error("request failed with apiKey=api-secret-value and token=token-secret-value"),
    { code: "ERR_PROVIDER_HANDSHAKE" },
  )
  const original = Object.assign(
    new Error(`provider failed: bot${secretBotToken} authorization=Bearer bearer-secret-value https://alice:password-secret@private.example/path`, {
      cause: nestedCause,
    }),
    { code: "HARVESTER_PROVIDER_IDENTITY_INVALID" },
  )

  const diagnostic = describeProcessError(original)
  const serialized = JSON.stringify(diagnostic)

  assert.equal(diagnostic.name, "Error", "The original error name must be preserved.")
  assert.equal(diagnostic.code, original.code, "The original stable code must be preserved.")
  assert.ok(diagnostic.message.includes("[REDACTED]"), "Credential-bearing message fragments must be masked.")
  assert.equal(diagnostic.cause.name, "Error", "The nested cause name must be preserved.")
  assert.equal(diagnostic.cause.code, nestedCause.code, "The nested native cause code must be preserved.")
  assert.ok(diagnostic.cause.message.includes("[REDACTED]"), "Nested cause messages must also be sanitized.")
  for (const secret of [
    secretBotToken,
    "api-secret-value",
    "token-secret-value",
    "bearer-secret-value",
    "password-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, `Serialized process diagnostics must not expose ${secret}.`)
  }
  assert.ok(diagnostic.stack.includes("[REDACTED]"), "The original stack must remain available with credential fragments masked.")
})
