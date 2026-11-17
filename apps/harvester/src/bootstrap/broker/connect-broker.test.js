import nodeTest from "node:test"
import assert from "node:assert/strict"
import { BROKER_PORT_METHODS } from "../../application/ports/broker.port.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { connectBroker } from "./connect-broker.js"

const test = (...args) => nodeTest(`[connect-broker.test.js] ${args[0]}`, ...args.slice(1))

const createCapabilities = ({ provider = "binance" } = {}) => Object.freeze({
  contractVersion: 1,
  provider,
  product: "spot",
  environment: Object.freeze({
    selector: "tradingMode",
    supportedModes: Object.freeze(["testnet", "live"]),
    selectedMode: "testnet",
    nodeEnvSelectsEndpoint: false,
  }),
})

function createBrokerPort({ calls, onConnect, onDisconnect }) {
  const broker = Object.fromEntries(BROKER_PORT_METHODS.map((method) => {
    if (method === "connect") {
      return [method, async () => {
        calls.push("connect")
        await onConnect?.()
      }]
    }
    if (method === "disconnect") {
      return [method, async () => {
        calls.push("disconnect")
        await onDisconnect?.()
      }]
    }
    return [method, async () => undefined]
  }))
  broker.capabilities = createCapabilities()
  return broker
}

function createFixture({ connect, disconnect } = {}) {
  const calls = []
  const events = []
  const broker = createBrokerPort({
    calls,
    onConnect: connect,
    onDisconnect: disconnect,
  })
  const brokerAdapterFactory = ({ config }) => {
    calls.push("factory")
    assert.equal(config.tradingMode, "testnet",
      "The explicit Binance environment must reach the adapter factory.")
    assert.equal(config.apiKey, "test-key",
      "The configured API key must reach the adapter factory.")
    assert.equal(config.apiSecret, "test-secret",
      "The configured API secret must reach the adapter factory.")
    return broker
  }
  return {
    calls,
    events,
    broker,
    brokerAdapterFactory,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        return { ok: true }
      },
    },
    env: {
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET_KEY: "test-secret",
    },
  }
}

function createConnectInput({ fixture, logger = {} } = {}) {
  return {
    ...fixture,
    brokerName: "binance",
    tradingMode: "testnet",
    logger,
  }
}

test("connects the registered Binance broker and publishes the connected lifecycle event", async () => {
  const fixture = createFixture()
  const broker = await connectBroker(createConnectInput({ fixture }))

  assert.equal(broker.capabilities, fixture.broker.capabilities,
    "Bootstrap must receive the registered Binance BrokerPort with its immutable capability declaration.")
  assert.equal(broker.providerInstanceId, "binanceTestnet",
    "The registered BrokerPort facade must retain the explicit Binance instance identity.")
  assert.equal(broker.providerType, "binance",
    "The registered BrokerPort facade must expose provider type separately from instance identity.")
  assert.equal(broker.accountId, "binance-primary",
    "The registered BrokerPort facade must expose the stable non-secret account alias.")
  assert.deepEqual(fixture.calls, ["factory", "connect"],
    "Broker construction must precede the connection attempt.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    "Successful connection must publish the stable lifecycle event.")
})

test("disconnects after connection failure and publishes failure evidence", async () => {
  const fixture = createFixture({
    connect: async () => { throw new Error("connect failed") },
  })

  await assert.rejects(
    connectBroker(createConnectInput({ fixture, logger: { error: () => {} } })),
    /connect failed/,
    "The original connection error must remain the rejection when cleanup succeeds.",
  )
  assert.deepEqual(fixture.calls, ["factory", "connect", "disconnect"],
    "A failed connection must attempt broker disconnect.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
    "Connection failure must publish lifecycle evidence.")
})

test("aggregates connection and disconnect failures without losing either cause", async () => {
  const fixture = createFixture({
    connect: async () => { throw new Error("connect failed") },
    disconnect: async () => { throw new Error("disconnect failed") },
  })

  await assert.rejects(
    connectBroker(createConnectInput({ fixture, logger: { error: () => {} } })),
    (error) => error instanceof AggregateError && error.errors.length === 2,
    "Connection and cleanup failures must be reported together.")
  assert.deepEqual(fixture.calls, ["factory", "connect", "disconnect"],
    "Disconnect must still be attempted after connect fails.")
})

test("cleans a constructed Binance client when capability validation blocks registry registration", async () => {
  const fixture = createFixture()
  fixture.broker.capabilities = createCapabilities({ provider: "other" })

  await assert.rejects(
    connectBroker(createConnectInput({ fixture })),
    /capability declaration/i,
    "A malformed provider declaration must stop before connection and retain an actionable failure.")
  assert.deepEqual(fixture.calls, ["factory", "disconnect"],
    "A constructed client must be disconnected when its capability contract prevents registry registration.")
  assert.equal(fixture.events.length, 0,
    "Registry validation failure must not publish broker connection lifecycle events.")
})

test("rejects invalid provider identity before constructing a Binance client", async () => {
  const fixture = createFixture()
  let factoryCalled = false
  const brokerAdapterFactory = (input) => {
    factoryCalled = true
    return fixture.brokerAdapterFactory(input)
  }
  const input = createConnectInput({ fixture })
  input.brokerAdapterFactory = brokerAdapterFactory
  input.env.BINANCE_PROVIDER_INSTANCE_ID = "invalid instance id"

  await assert.rejects(
    connectBroker(input),
    (error) => error.code === "HARVESTER_PROVIDER_IDENTITY_INVALID",
    "Invalid provider identity must fail closed before any broker construction or connection.",
  )
  assert.equal(factoryCalled, false,
    "Provider identity validation must precede the broker adapter factory.")
})
