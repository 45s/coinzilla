import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApi } from "./start-trading-history-api.js"

const API_TOKEN = "test-token-with-more-than-thirty-two-characters"

function createDatabase() {
  let closeCalls = 0
  return {
    get closeCalls() {
      return closeCalls
    },
    prepare() {
      return {
        get: () => ({ total: 0 }),
      }
    },
    async close() {
      closeCalls += 1
    },
  }
}

test("starts the local API without requiring bearer-token configuration", async () => {
  const database = createDatabase()
  const eventBus = new EventBus()
  let serverInput
  let serverCloseCalls = 0
  const service = await startTradingHistoryApi({
    database,
    eventBus,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_HOST: "0.0.0.0",
    },
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {
          serverCloseCalls += 1
        },
      }
    },
  })

  assert.equal(serverInput.environment, "testnet", "The local API must use Harvester's selected environment.")
  assert.equal(serverInput.host, "127.0.0.1", "The unauthenticated local API must bind only to loopback.")
  assert.equal(serverInput.port, 4201, "The API must use its documented default local port.")
  assert.equal(serverInput.eventBus, eventBus, "The WebSocket endpoint must share Harvester's EventBus.")
  await service.close()
  assert.equal(serverCloseCalls, 1, "The optional API lifecycle must close its listener.")
  assert.equal(database.closeCalls, 0, "The API must not close Harvester's shared database.")
  await eventBus.close()
})

test("starts the API over Harvester's already-open relational database without owning that database", async () => {
  const database = createDatabase()
  let serverInput
  let serverCloseCalls = 0
  const eventBus = new EventBus()
  const service = await startTradingHistoryApi({
    database,
    eventBus,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_TOKEN: API_TOKEN,
      HARVESTER_API_PORT: "0",
    },
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {
          serverCloseCalls += 1
        },
      }
    },
  })

  assert.equal(serverInput.environment, "testnet", "The API must report the environment selected by Harvester.")
  assert.equal(serverInput.eventBus, eventBus, "The WebSocket endpoint must share Harvester's EventBus.")
  assert.equal(serverInput.queries.getSummary().ok, true, "The query facade must be composed over the supplied relational connection.")
  assert.deepEqual(service.address, {
    address: "127.0.0.1",
    port: 4201,
  }, "The service must expose the HTTP listener address for process diagnostics.")
  await service.close()
  assert.equal(serverCloseCalls, 1, "The service must close its HTTP listener.")
  assert.equal(database.closeCalls, 0, "The API lifecycle must not close the database connection owned by Harvester.")
  await eventBus.close()
})

test("rejects invalid API configuration before opening the HTTP listener", async () => {
  const invalidConfigurations = [
    {
      name: "environment",
      env: {
        TRADING_MODE: "sandbox",
      },
    },
    {
      name: "port",
      env: {
        TRADING_MODE: "testnet",
        HARVESTER_API_PORT: "65536",
      },
    },
  ]
  const eventBus = new EventBus()

  try {
    for (const configuration of invalidConfigurations) {
      await assert.rejects(
        () => startTradingHistoryApi({
          database: createDatabase(),
          eventBus,
          env: configuration.env,
          startServer: async () => {
            throw new Error("Invalid configuration must be rejected before binding.")
          },
        }),
        (error) => error.code === "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
        `The API must reject invalid ${configuration.name} configuration.`,
      )
    }
  } finally {
    await eventBus.close()
  }
})

test("preserves the HTTP startup error without closing Harvester's shared database", async () => {
  const database = createDatabase()
  const eventBus = new EventBus()
  const startupFailure = new Error("simulated HTTP bind failure")

  await assert.rejects(
    () => startTradingHistoryApi({
      database,
      eventBus,
      env: {
        TRADING_MODE: "testnet",
        HARVESTER_API_TOKEN: API_TOKEN,
      },
      startServer: async () => {
        throw startupFailure
      },
    }),
    (error) => error === startupFailure,
    "The original HTTP startup failure must remain available to Harvester diagnostics.",
  )
  assert.equal(database.closeCalls, 0, "A failed optional API startup must not close Harvester's database.")
  await eventBus.close()
})
