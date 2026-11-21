import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { main } from "./index.js"

const API_TOKEN = "test-token-with-more-than-thirty-two-characters"

function createDisabledJournalService() {
  return {
    ready: Promise.resolve({
      ok: true,
      disabled: true,
    }),
    status: {
      state: "disabled",
    },
    flush: async () => ({
      ok: true,
      durable: true,
    }),
    close: async () => ({
      ok: true,
      closed: true,
      disabled: true,
    }),
  }
}

test("starts the trading-history API with Harvester and closes it before the shared database", async () => {
  const calls = []
  const handlers = {}
  const database = {
    state: "connected",
    async close() {
      calls.push("database")
      database.state = "closed"
    },
  }
  const eventBus = new EventBus()
  const result = await main({
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_TOKEN: API_TOKEN,
    },
    loadConfig: async () => ({}),
    createEventBus: () => eventBus,
    createJournalService: createDisabledJournalService,
    acquireProcessLock: async () => ({
      ok: true,
      release: async () => ({
        ok: true,
        released: true,
      }),
    }),
    prepareOrderHistoryPersistence: async () => ({
      relationalDatabase: database,
    }),
    startTradingHistoryApi: async ({ database: suppliedDatabase, environment }) => {
      assert.equal(suppliedDatabase, database, "The API must reuse Harvester's existing relational database connection.")
      assert.equal(environment, "testnet", "The API environment must come from Harvester's selected runtime configuration.")
      calls.push("api-start")
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {
          calls.push("api-close")
        },
      }
    },
    start: async () => ({
      stop: async () => {
        calls.push("runtime-stop")
      },
    }),
    registerSignalHandler: (signal, handler) => {
      handlers[signal] = handler
    },
    logger: {
      info() {},
      system() {},
      warn() {},
      error() {},
    },
  })

  assert.ok(result, "Harvester must complete startup while the optional API is configured.")
  assert.equal(typeof handlers.SIGTERM, "function", "Harvester must register its normal process shutdown handler.")
  assert.ok(calls.includes("api-start"), "Harvester process startup must start the API after persistence preparation.")
  await handlers.SIGTERM()
  assert.ok(calls.indexOf("runtime-stop") < calls.indexOf("api-close"), "The API must remain available until the Harvester runtime has stopped.")
  assert.ok(calls.indexOf("api-close") < calls.indexOf("database"), "The API listener must close before Harvester closes its shared database.")
})
