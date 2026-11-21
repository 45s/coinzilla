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

function createTradingHistoryTestConfig() {
  return {
    strategies: {
      CG_coinGrabber: {
        pairs: {
          DOGEUSDT: {
            enabled: true,
            tradingEnvironment: "testnet",
          },
        },
      },
    },
  }
}

function createMainOptions({ database, calls, handlers, startTradingHistoryApi } = {}) {
  return {
    env: {
      TRADING_MODE: "testnet",
      BINANCE_PROVIDER_INSTANCE_ID: "binanceTestnet",
      BINANCE_ACCOUNT_ID: "binance-primary",
      BINANCE_API_KEY: "test-api-key",
      BINANCE_API_SECRET_KEY: "test-api-secret",
      NODE_ENV: "test",
      HARVESTER_API_TOKEN: API_TOKEN,
    },
    loadConfig: async () => createTradingHistoryTestConfig(),
    createEventBus: () => new EventBus(),
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
    startTradingHistoryApi: startTradingHistoryApi ?? (async ({ database: suppliedDatabase, environment, eventBus }) => {
      assert.equal(suppliedDatabase, database, "The API must reuse Harvester's existing relational database connection.")
      assert.equal(environment, "testnet", "The API environment must come from Harvester's selected runtime configuration.")
      assert.equal(typeof eventBus?.subscribe, "function", "The WebSocket adapter must share Harvester's existing EventBus.")
      calls.push("api-start")
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => { calls.push("api-close") },
      }
    }),
    start: async () => ({
      stop: async () => { calls.push("runtime-stop") },
    }),
    registerSignalHandler: (...args) => {
      const [signal, handler] = args
      handlers[signal] = handler
    },
    logger: {
      info() {},
      system() {},
      warn() {},
      error() {},
    },
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
  const result = await main(createMainOptions({
    database,
    calls,
    handlers,
  }))

  assert.ok(result?.runtime, "Harvester startup must return its started runtime.")
  assert.equal(typeof handlers.SIGTERM, "function", "Harvester must register its normal process shutdown handler.")
  assert.ok(calls.includes("api-start"), "Harvester process startup must start the API after persistence preparation.")
  await handlers.SIGTERM()
  assert.ok(calls.indexOf("runtime-stop") < calls.indexOf("api-close"), "The API must remain available until the Harvester runtime has stopped.")
  assert.ok(calls.indexOf("api-close") < calls.indexOf("database"), "The API listener must close before Harvester closes its shared database.")
})

test("keeps Harvester trading startup successful when the optional API cannot bind", async () => {
  const calls = []
  const handlers = {}
  const database = {
    state: "connected",
    async close() {
      calls.push("database")
      database.state = "closed"
    },
  }
  const result = await main(createMainOptions({
    database,
    calls,
    handlers,
    startTradingHistoryApi: async () => {
      throw new Error("simulated optional API bind failure")
    },
  }))

  assert.ok(result?.runtime, "Optional API startup failure must not prevent Harvester runtime startup.")
  await handlers.SIGTERM()
  assert.ok(calls.includes("runtime-stop"), "Harvester must remain available for normal shutdown.")
  assert.ok(calls.includes("database"), "Normal persistence cleanup must continue after optional API startup failure.")
})
