import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { closeHarvesterPersistence } from "./close-harvester-persistence.js"
import { prepareOrderHistoryPersistence } from "./prepare-order-history-persistence.js"
import { createOrderHistoryEventData } from "../../../test-support/order-history-fixtures.js"

test("connects SQLite, stores filled orders, and omits the temporary process-ID record", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-order-history-persistence-"))
  const eventBus = new EventBus()
  const persistence = await prepareOrderHistoryPersistence({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
    },
    eventBus,
    logger: {
      error() {},
    },
  })
  t.after(async () => {
    await closeHarvesterPersistence(persistence ?? {})
    await eventBus.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })

  assert.ok(persistence, "Valid configuration must prepare the optional order-history database.")
  assert.equal(persistence.database.state, "connected", "The SQLite provider must be connected before the observer is exposed.")

  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  await eventBus.flush()
  await persistence.observer.flush()

  const record = await persistence.database.readOne({
    collection: "harvester_orders",
    id: JSON.stringify([
      "testnet",
      "binanceTestnet",
      "binance",
      "binance-primary",
      "harvester-BTCUSDT-001",
    ]),
  })
  const temporaryProcessRecord = await persistence.database.readOne({
    collection: "harvester_processes",
    id: String(process.pid),
  })

  assert.equal(record.executedQuantity, "0.2500", "The real order-history record must preserve the exact cumulative fill quantity.")
  assert.equal(temporaryProcessRecord, null, "The temporary process-ID smoke-test collection must be removed when real persistence begins.")
})

test("keeps TESTNET and LIVE order history in separate SQLite files", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-order-history-isolation-"))
  const testnetBus = new EventBus()
  const liveBus = new EventBus()
  const options = {
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
    },
    logger: {
      error() {},
    },
  }
  const testnet = await prepareOrderHistoryPersistence({
    ...options,
    tradingMode: "testnet",
    eventBus: testnetBus,
  })
  const live = await prepareOrderHistoryPersistence({
    ...options,
    tradingMode: "live",
    eventBus: liveBus,
  })
  t.after(async () => {
    await closeHarvesterPersistence(testnet ?? {})
    await closeHarvesterPersistence(live ?? {})
    await testnetBus.close()
    await liveBus.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })

  assert.ok(testnet && live, "Both isolated environments must be independently prepared.")
  testnetBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  liveBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData({
      providerInstanceId: "binanceLive",
    }),
  })
  await Promise.all([
    testnetBus.flush(),
    liveBus.flush(),
  ])
  await Promise.all([
    testnet.observer.flush(),
    live.observer.flush(),
  ])

  const testnetId = JSON.stringify([
    "testnet",
    "binanceTestnet",
    "binance",
    "binance-primary",
    "harvester-BTCUSDT-001",
  ])
  const liveId = JSON.stringify([
    "live",
    "binanceLive",
    "binance",
    "binance-primary",
    "harvester-BTCUSDT-001",
  ])
  assert.ok(
    await testnet.database.readOne({
      collection: "harvester_orders",
      id: testnetId,
    }),
    "TESTNET order history must be stored in its own database.",
  )
  assert.ok(
    await live.database.readOne({
      collection: "harvester_orders",
      id: liveId,
    }),
    "LIVE order history must be stored in its own database and use a distinct environment identity.",
  )
})

test("treats invalid optional persistence configuration as non-fatal", async () => {
  const logEntries = []
  const eventBus = new EventBus()
  const result = await prepareOrderHistoryPersistence({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: "relative/database/path",
    },
    eventBus,
    logger: {
      error: (entry) => logEntries.push(entry),
    },
  })
  await eventBus.close()

  assert.equal(result, null, "Invalid optional history configuration must disable only the history projection.")
  assert.equal(logEntries.length, 1, "Optional persistence preparation failures must be reported.")
  assert.equal(logEntries[0].message, "Order history persistence is unavailable", "Preparation diagnostics must use a stable message.")
})
