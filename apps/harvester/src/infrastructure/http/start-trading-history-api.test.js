import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSqliteDatabase } from "@coinzilla/db"
import { EventBus } from "@coinzilla/event-bus"
import { closeHarvesterPersistence } from "../persistence/close-harvester-persistence.js"
import { prepareOrderHistoryPersistence } from "../persistence/prepare-order-history-persistence.js"
import { startTradingHistoryApi } from "./start-trading-history-api.js"

const API_TOKEN = "test-token-with-more-than-thirty-two-characters"

async function createExistingTradingHistoryDatabase({ t } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-trading-history-api-"))
  const eventBus = new EventBus()
  const env = {
    TRADING_MODE: "testnet",
    HARVESTER_DATABASE_DIRECTORY: directory,
    HARVESTER_API_TOKEN: API_TOKEN,
    HARVESTER_API_PORT: "0",
  }
  const persistence = await prepareOrderHistoryPersistence({
    tradingMode: "testnet",
    env,
    eventBus,
    logger: {
      error() {},
    },
  })
  assert.ok(persistence?.relationalDatabase, "The API service test requires an initialized relational trading-history database.")
  await closeHarvesterPersistence(persistence)
  await eventBus.close()
  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  return {
    directory,
    env,
  }
}

test("starts a standalone API over an existing environment database and closes its query connection", async (t) => {
  const { env } = await createExistingTradingHistoryDatabase({ t })
  let database
  const service = await startTradingHistoryApi({
    env,
    createDatabase: (options) => {
      database = createSqliteDatabase(options)
      return database
    },
  })
  t.after(async () => {
    await service.close()
  })

  assert.equal(database.prepare("PRAGMA query_only").get().query_only, 1, "The API connection must enable SQLite query-only mode.")
  const response = await fetch(`${`http://127.0.0.1:${service.address.port}`}/api/v1/trading/metadata`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
    },
  })
  assert.equal(response.status, 200, "The standalone API must serve metadata from the selected persisted database.")
  assert.deepEqual((await response.json()).data, {
    environment: "testnet",
    records: {
      orders: 0,
      fills: 0,
      commissions: 0,
    },
  }, "A fresh trading-history database must report its actual empty record counts.")
  await service.close()
  assert.equal(database.state, "closed", "Service shutdown must close its database connection.")
});

test("does not create a database when the selected environment file does not exist", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-trading-history-api-missing-"))
  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const env = {
    TRADING_MODE: "testnet",
    HARVESTER_DATABASE_DIRECTORY: directory,
    HARVESTER_API_TOKEN: API_TOKEN,
  }
  await assert.rejects(
    () => startTradingHistoryApi({ env }),
    (error) => error.code === "HARVESTER_TRADING_HISTORY_API_DATABASE_UNAVAILABLE",
    "The API must report a missing Harvester database instead of creating a new empty database.",
  )
});

test("closes the database connection when the HTTP server fails to start", async (t) => {
  const { env } = await createExistingTradingHistoryDatabase({ t })
  let database
  const startupFailure = new Error("simulated HTTP bind failure")

  await assert.rejects(
    () => startTradingHistoryApi({
      env,
      createDatabase: (options) => {
        database = createSqliteDatabase(options)
        return database
      },
      startServer: async () => {
        throw startupFailure
      },
    }),
    (error) => error === startupFailure,
    "The original server startup failure must be preserved.",
  )
  assert.equal(database.state, "closed", "Database resources must be closed after a failed HTTP server startup.")
});
