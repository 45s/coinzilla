import assert from "node:assert/strict"
import test from "node:test"

import {
  BinanceWebSocketBroker,
  BitunixSpotBroker,
  BrokerCapabilities,
  BROKER_CAPABILITY_STATUSES,
  CoreBroker,
} from "./index.js"

function createBinanceBroker({ tradingMode = "testnet" } = {}) {
  return new BinanceWebSocketBroker({
    apiKey: "capability-test-key",
    apiSecret: "capability-test-secret",
    tradingMode,
  })
}

function createBitunixBroker({ allowLiveOrderMutations = false } = {}) {
  return new BitunixSpotBroker({
    apiKey: "capability-test-key",
    apiSecret: "capability-test-secret",
    tradingMode: "live",
    allowLiveOrderMutations,
  })
}

function assertDeeplyFrozen({ value, path = "capabilities" }) {
  assert.equal(
    Object.isFrozen(value),
    true,
    `${path} must be frozen so consumers cannot mutate declared broker guarantees`,
  )
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== null && typeof nestedValue === "object") {
      assertDeeplyFrozen({
        value: nestedValue,
        path: `${path}.${key}`,
      })
    }
  }
}

function assertCapability({ declaration, type, status }) {
  assert.equal(
    declaration.getStatus({ type }),
    status,
    `${declaration.provider} ${type} capability status must be ${status}`,
  )
}

test("Binance and Bitunix expose the same immutable canonical capability contract", () => {
  const providers = [createBinanceBroker(), createBitunixBroker()]

  assert.deepEqual(BROKER_CAPABILITY_STATUSES, [
    "SUPPORTED",
    "UNSUPPORTED",
    "UNKNOWN",
  ])

  for (const broker of providers) {
    const descriptor = Object.getOwnPropertyDescriptor(broker, "capabilities")

    assert.ok(broker.capabilities instanceof BrokerCapabilities)
    assert.equal(descriptor?.writable, false)
    assert.equal(descriptor?.configurable, false)
    assert.equal(broker.capabilities.contractVersion, 1)
    assert.equal(broker.capabilities.provider, broker instanceof BinanceWebSocketBroker ? "binance" : "bitunix")
    assert.equal(broker.capabilities.product, "spot")
    assert.ok(broker.capabilities.environment.supportedModes.includes(
      broker.capabilities.environment.selectedMode,
    ))
    assert.equal(Object.hasOwn(broker.capabilities.environment, "status"), false)
    assertDeeplyFrozen({ value: broker.capabilities })
  }
})

test("Binance capabilities distinguish supported operations from reconciliation guarantees", () => {
  const { capabilities } = createBinanceBroker()

  for (const type of [
    "READ_BALANCES",
    "READ_ACCOUNT_SNAPSHOT",
    "READ_OPEN_ORDERS",
    "READ_CANONICAL_ORDER",
    "READ_CANONICAL_ORDER_HISTORY",
    "READ_FILLS",
    "READ_MARKET_PRICE",
    "READ_CANDLES",
    "SUBSCRIBE_MARKET_PRICES",
    "SUBSCRIBE_CANDLES",
    "SUBSCRIBE_BOOK_TICKER",
    "SUBSCRIBE_USER_DATA",
    "PLACE_LIMIT_ORDER",
    "PLACE_MARKET_ORDER",
    "CANCEL_ORDER",
    "CANCEL_ALL_ORDERS",
    "RECOVER_USER_DATA_SESSION",
  ]) {
    assertCapability({
      declaration: capabilities,
      type,
      status: "SUPPORTED",
    })
  }

  assertCapability({
    declaration: capabilities,
    type: "RECONCILE_ORDERS",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "REPLAY_USER_DATA_EVENTS",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "RECOVER_PROCESS_RESTART",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_COMPLETE_FILL_HISTORY",
    status: "UNKNOWN",
  })

  const placement = capabilities.getCapability({ type: "PLACE_LIMIT_ORDER" })
  assert.ok(placement.conditions.length > 0)
  assert.match(placement.limitation, /offline tests/i)
})

test("Binance environment selection is metadata, not a capability status", () => {
  const testnetBroker = createBinanceBroker({ tradingMode: "testnet" })
  const liveBroker = createBinanceBroker({ tradingMode: "live" })

  assert.deepEqual(testnetBroker.capabilities.environment, {
    selector: "tradingMode",
    selectedMode: "testnet",
    supportedModes: ["testnet", "live"],
    notes: "NODE_ENV does not select exchange endpoints.",
  })
  assert.equal(liveBroker.capabilities.environment.selectedMode, "live")
  assertCapability({
    declaration: testnetBroker.capabilities,
    type: "PLACE_LIMIT_ORDER",
    status: "SUPPORTED",
  })
})

test("Bitunix Spot read capabilities preserve incomplete-evidence boundaries", () => {
  const { capabilities } = createBitunixBroker()

  assertCapability({
    declaration: capabilities,
    type: "READ_BALANCES",
    status: "SUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_OPEN_ORDERS",
    status: "SUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_MARKET_PRICE",
    status: "SUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_ACCOUNT_SNAPSHOT",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_CANONICAL_ORDER",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_FILLS",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "PLACE_LIMIT_ORDER",
    status: "SUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "PLACE_MARKET_ORDER",
    status: "SUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "SUBSCRIBE_USER_DATA",
    status: "UNSUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "READ_COMPLETE_FILL_HISTORY",
    status: "UNKNOWN",
  })
  assert.ok(capabilities.getCapability({ type: "READ_OPEN_ORDERS" }).conditions.length > 0)
})

test("Bitunix Spot live mutations remain unsupported until explicitly opted in", () => {
  const { capabilities } = createBitunixBroker()

  for (const type of [
    "PLACE_LIMIT_ORDER",
    "PLACE_MARKET_ORDER",
    "CANCEL_ORDER",
    "CANCEL_ALL_ORDERS",
  ]) {
    assertCapability({
      declaration: capabilities,
      type,
      status: "UNSUPPORTED",
    })
  }
})

test("Bitunix Spot declares implemented mutations when explicit live opt-in is enabled", () => {
  const { capabilities } = createBitunixBroker({
    allowLiveOrderMutations: true,
  })

  for (const type of [
    "PLACE_LIMIT_ORDER",
    "PLACE_MARKET_ORDER",
    "CANCEL_ORDER",
    "CANCEL_ALL_ORDERS",
  ]) {
    assertCapability({
      declaration: capabilities,
      type,
      status: "SUPPORTED",
    })
  }
})

test("Bitunix Spot declares single-order and symbol-scoped bulk cancellation supported after opt-in", () => {
  const { capabilities } = createBitunixBroker({
    allowLiveOrderMutations: true,
  })

  assertCapability({
    declaration: capabilities,
    type: "CANCEL_ORDER",
    status: "SUPPORTED",
  })
  assertCapability({
    declaration: capabilities,
    type: "CANCEL_ALL_ORDERS",
    status: "SUPPORTED",
  })
})

test("provider facades retain CoreBroker compatibility without inheriting the new contract", () => {
  const binance = createBinanceBroker()
  const bitunix = createBitunixBroker()

  assert.ok(binance instanceof CoreBroker)
  assert.ok(bitunix instanceof CoreBroker)
  assert.equal(typeof binance.getPrice, "function")
  assert.equal(typeof bitunix.getPrice, "function")
  assert.notEqual(binance.getPrice, CoreBroker.prototype.getPrice)
})

test("public exports expose the canonical capability model", async () => {
  const brokers = await import("./index.js")

  assert.equal(typeof brokers.BrokerCapabilities, "function")
  assert.deepEqual(brokers.BROKER_CAPABILITY_STATUSES, [
    "SUPPORTED",
    "UNSUPPORTED",
    "UNKNOWN",
  ])
  assert.ok(Array.isArray(brokers.BROKER_CAPABILITY_TYPES))
})
