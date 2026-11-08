import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { connectBroker } from "./connect-broker.js"

const test = (name, ...args) => nodeTest("[connect-broker.test.js] " + name, ...args)

const createFixture = ({ connect, disconnect } = {}) => {
  const calls = []
  const events = []
  const broker = {
    connect: async () => {
      calls.push("connect")
      if (connect) await connect()
    },
    disconnect: async () => {
      calls.push("disconnect")
      if (disconnect) await disconnect()
    },
    getAccountSnapshot: async () => ({ ok: true, data: { balances: [], sourceTime: 1 } }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getSymbolFilters: async () => ({ ok: true, data: {} }),
    subscribeForPrices: async () => ({ ok: true, data: { unsubscribe: async () => {} } }),
    subscribeForUserData: async () => ({ ok: true, data: { disconnect: async () => {} } }),
  }
  const eventPublisher = { publish: (event) => { events.push(event); return { ok: true } } }
  const brokerAdapterFactory = ({ config }) => {
    calls.push("factory")
    assert.equal(config.apiKey, "test-key", "The configured API key must reach the broker adapter factory.")
    assert.equal(config.apiSecret, "test-secret", "The configured API secret must reach the broker adapter factory.")
    return broker
  }
  return {
    calls, events, broker, brokerAdapterFactory, eventPublisher,
    env: { BINANCE_API_KEY: "test-key", BINANCE_API_SECRET_KEY: "test-secret" },
  }
}

test("connects a validated broker and publishes the connected lifecycle event", async () => {
  const fixture = createFixture()
  const broker = await connectBroker({ ...fixture, brokerName: "binance", logger: {} })

  assert.equal(broker, fixture.broker, "The connected broker port must be returned to bootstrap.")
  assert.deepEqual(fixture.calls, ["factory", "connect"], "Broker construction must precede the connection attempt.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.BROKER_CONNECTED, "Successful connection must publish the stable lifecycle event.")
})

test("disconnects after connection failure and publishes failure evidence", async () => {
  const fixture = createFixture({ connect: async () => { throw new Error("connect failed") } })

  await assert.rejects(
    connectBroker({ ...fixture, brokerName: "binance", logger: { error: () => {} } }),
    /connect failed/,
    "The original connection error must remain the rejection when cleanup succeeds.",
  )
  assert.deepEqual(fixture.calls, ["factory", "connect", "disconnect"], "A failed connection must attempt broker disconnect.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED, "Connection failure must publish lifecycle evidence.")
})

test("aggregates connection and disconnect failures without losing either cause", async () => {
  const fixture = createFixture({
    connect: async () => { throw new Error("connect failed") },
    disconnect: async () => { throw new Error("disconnect failed") },
  })

  await assert.rejects(
    connectBroker({ ...fixture, brokerName: "binance", logger: { error: () => {} } }),
    (error) => error instanceof AggregateError && error.errors.length === 2,
    "Connection and cleanup failures must be reported together.",
  )
  assert.deepEqual(fixture.calls, ["factory", "connect", "disconnect"], "Disconnect must still be attempted after connect fails.")
})
