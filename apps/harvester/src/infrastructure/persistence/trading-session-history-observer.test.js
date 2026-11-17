import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import {
  createDatabase,
  createSqliteProvider,
} from "@coinzilla/db"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { createTradingSessionRepository } from "./trading-session-repository.js"
import { createTradingSessionHistoryObserver } from "./create-trading-session-history-observer.js"

const PROCESS_IDENTITY = Object.freeze({
  application: "harvester",
  version: "1.0.001",
  runtimeSessionId: "runtime-session-observer-001",
  processId: 12345,
  startedAt: "2026-11-17T16:00:00.000Z",
  source: {
    branch: "develop",
    commit: "a".repeat(40),
    shortCommit: "a".repeat(8),
    commitMessage: "test build",
    commitDate: "2026-11-17T15:00:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
  },
})
const RUNTIME_CONFIG = Object.freeze({ brokerName: "binance" })
const CONFIGURATION = Object.freeze({
  enabledMarkets: ["BTCUSDT", "ETHUSDT"],
  strategyMode: "conservative",
  tradingMode: "testnet",
  configurationFingerprint: "b".repeat(64),
  tradingEnabled: true,
})

async function createObserverFixture({ t, overrides = {} }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-session-observer-"))
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: path.join(directory, "history.db"),
      timeout: 5_000,
    }),
  })
  await database.connect()
  const eventBus = new EventBus()
  const repository = overrides.repository ?? createTradingSessionRepository({ database })
  const observer = createTradingSessionHistoryObserver({
    eventBus,
    repository,
    processIdentity: PROCESS_IDENTITY,
    runtimeConfig: RUNTIME_CONFIG,
    logger: overrides.logger,
  })
  t.after(async () => {
    await observer.close()
    await eventBus.close()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  return {
    database,
    eventBus,
    observer,
    repository,
  }
}

async function publishAndDrain({ eventBus, observer, name, data }) {
  const result = eventBus.publish({
    name,
    source: "harvester",
    data,
  })
  assert.equal(result.ok, true, `The EventBus must accept lifecycle event ${name} for its independent history observer.`)
  await eventBus.flush()
  await observer.flush()
}

test("creates and updates session history from lifecycle events without changing event delivery", async (t) => {
  const { eventBus, observer, repository } = await createObserverFixture({ t })

  await publishAndDrain({
    eventBus,
    observer,
    name: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    data: CONFIGURATION,
  })
  const created = await repository.findById(PROCESS_IDENTITY.runtimeSessionId)
  assert.equal(created.status, "STARTING", "Validated configuration must create an ordinary historical session in STARTING state.")

  await publishAndDrain({
    eventBus,
    observer,
    name: HARVESTER_EVENT_NAMES.STARTED,
    data: {
      broker: "binance",
      strategyMode: "conservative",
      enabledMarkets: CONFIGURATION.enabledMarkets,
      tradingEnabled: true,
    },
  })
  const running = await repository.findById(PROCESS_IDENTITY.runtimeSessionId)
  assert.equal(running.status, "RUNNING", "A successful runtime-start event must transition the history projection to RUNNING.")

  await publishAndDrain({
    eventBus,
    observer,
    name: HARVESTER_EVENT_NAMES.STOPPED,
    data: {
      reason: "SIGINT",
      outcome: "success",
    },
  })
  const stopped = await repository.findById(PROCESS_IDENTITY.runtimeSessionId)
  assert.equal(stopped.status, "STOPPED", "A successful shutdown event must transition the history projection to STOPPED.")
  assert.equal(typeof stopped.endedAt, "string", "A successful shutdown must preserve the lifecycle event timestamp as endedAt.")
  assert.equal(stopped.startedAt, PROCESS_IDENTITY.startedAt, "The session history must preserve the original immutable process-entry timestamp.")
  assert.equal(stopped.environment, "testnet", "The session history must preserve the validated explicit trading environment.")
  assert.equal(stopped.broker, "binance", "The session history must preserve the configured broker identity.")
})

test("records startup failure and does not mark an unsuccessful shutdown as stopped", async (t) => {
  const { eventBus, observer, repository } = await createObserverFixture({ t })
  await publishAndDrain({
    eventBus,
    observer,
    name: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    data: CONFIGURATION,
  })
  await publishAndDrain({
    eventBus,
    observer,
    name: HARVESTER_EVENT_NAMES.STARTUP_FAILED,
    data: {
      stage: "broker-connect",
      error: {
        name: "Error",
        message: "connection failed",
      },
    },
  })
  const failed = await repository.findById(PROCESS_IDENTITY.runtimeSessionId)
  assert.equal(failed.status, "STARTUP_FAILED", "A startup-failed lifecycle event must terminate a session that never reached RUNNING.")
  assert.equal(typeof failed.endedAt, "string", "A failed startup must preserve its event timestamp as the session end time.")
  await observer.close()

  const secondIdentity = {
    ...PROCESS_IDENTITY,
    runtimeSessionId: "runtime-session-observer-002",
  }
  const secondObserver = createTradingSessionHistoryObserver({
    eventBus,
    repository,
    processIdentity: secondIdentity,
    runtimeConfig: RUNTIME_CONFIG,
  })
  await publishAndDrain({
    eventBus,
    observer: secondObserver,
    name: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    data: CONFIGURATION,
  })
  await publishAndDrain({
    eventBus,
    observer: secondObserver,
    name: HARVESTER_EVENT_NAMES.STARTED,
    data: {
      broker: "binance",
      strategyMode: "conservative",
      enabledMarkets: CONFIGURATION.enabledMarkets,
      tradingEnabled: true,
    },
  })
  await publishAndDrain({
    eventBus,
    observer: secondObserver,
    name: HARVESTER_EVENT_NAMES.STOPPED,
    data: {
      reason: "SIGTERM",
      outcome: "failed",
    },
  })
  const running = await repository.findById(secondIdentity.runtimeSessionId)
  assert.equal(running.status, "RUNNING", "An unsuccessful shutdown must not falsely close the ordinary historical session.")
  assert.equal(running.endedAt, null, "An unsuccessful shutdown must not invent an end timestamp.")
  await secondObserver.close()
})

test("isolates persistence failures from EventBus publication and reports them", async (t) => {
  const loggedEntries = []
  const repository = {
    create: async () => { throw Object.assign(new Error("provider unavailable"), { code: "DB_PROVIDER_OPERATION_FAILED" }) },
    findById: async () => null,
    transition: async () => null,
  }
  const { eventBus, observer } = await createObserverFixture({
    t,
    overrides: {
      repository,
      logger: {
        error: (entry) => loggedEntries.push(entry),
      },
    },
  })

  await publishAndDrain({
    eventBus,
    observer,
    name: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    data: CONFIGURATION,
  })

  assert.equal(loggedEntries.length, 1, "A failed ordinary-history write must be reported exactly once to the configured logger.")
  assert.equal(loggedEntries[0].errorCode, "DB_PROVIDER_OPERATION_FAILED", "The persistence boundary must retain the provider-neutral failure code.")
})
