import assert from "node:assert/strict"
import test from "node:test"

import { BinanceWebSocketBroker, CoreBroker } from "./index.js"

function createBroker({ tradingMode = "testnet" } = {}) {
  return new BinanceWebSocketBroker({
    apiKey: "capability-test-key",
    apiSecret: "capability-test-secret",
    tradingMode,
  })
}

function assertDeeplyFrozen({
  value,
  path = "capabilities",
}) {
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

const CAPABILITY_STATUSES = new Set([
  "supported",
  "unsupported",
  "unknown",
  "environment-dependent",
])

function assertCapabilityStatuses({ value, path = "capabilities" }) {
  if (value === null || typeof value !== "object") {
    return
  }

  if (Object.hasOwn(value, "status")) {
    assert.ok(
      CAPABILITY_STATUSES.has(value.status),
      `${path}.status must be a recognized capability state`,
    )
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== null && typeof nestedValue === "object") {
      assertCapabilityStatuses({
        value: nestedValue,
        path: `${path}.${key}`,
      })
    }
  }
}

function assertCapabilityStatus({ capability, expectedStatus, message }) {
  assert.equal(capability.status, expectedStatus, message)
}

test("Binance broker exposes a versioned, deeply immutable capability declaration", () => {
  const broker = createBroker()
  const descriptor = Object.getOwnPropertyDescriptor(broker, "capabilities")

  assert.equal(descriptor?.writable, false, "the capability property must not be replaceable")
  assert.equal(descriptor?.configurable, false, "the capability property must not be redefined")
  assert.equal(broker.capabilities.contractVersion, 1, "the declaration must expose its schema version")
  assert.equal(broker.capabilities.provider, "binance", "the declaration must identify Binance")
  assert.equal(broker.capabilities.product, "spot", "the declaration must identify Binance Spot")
  assertDeeplyFrozen({ value: broker.capabilities })
  assertCapabilityStatuses({ value: broker.capabilities })
})

test("Binance market-data declarations distinguish one-shot reads from streams", () => {
  const { capabilities } = createBroker()

  assertCapabilityStatus({
    capability: capabilities.marketData.oneShotPrice,
    expectedStatus: "supported",
    message: "the one-shot ticker.price request is a supported price read",
  })
  assertCapabilityStatus({
    capability: capabilities.marketData.priceStream,
    expectedStatus: "supported",
    message: "the aggTrade subscription is a supported streaming capability",
  })
  assertCapabilityStatus({
    capability: capabilities.marketData.legacyPriceLookup,
    expectedStatus: "unsupported",
    message: "the inherited CoreBroker getPrice method must not be advertised as supported",
  })
})

test("Binance account and order declarations distinguish lookup from reconciliation", () => {
  const { capabilities } = createBroker()

  assertCapabilityStatus({
    capability: capabilities.account.balances,
    expectedStatus: "supported",
    message: "Binance account.status exposes normalized balance reads",
  })
  assertCapabilityStatus({
    capability: capabilities.account.snapshot,
    expectedStatus: "supported",
    message: "the account snapshot validates Binance's source updateTime",
  })
  assertCapabilityStatus({
    capability: capabilities.orders.openOrders,
    expectedStatus: "supported",
    message: "the signed openOrders.status operation returns normalized open orders",
  })
  assertCapabilityStatus({
    capability: capabilities.orders.statusLookup,
    expectedStatus: "supported",
    message: "order.status is supported as a status observation",
  })
  assertCapabilityStatus({
    capability: capabilities.orders.canonicalLookup,
    expectedStatus: "supported",
    message: "the canonical lookup validates order identity and market metadata",
  })
  assertCapabilityStatus({
    capability: capabilities.orders.reconciliation,
    expectedStatus: "unsupported",
    message: "a canonical lookup is not an order reconciliation workflow",
  })
  assertCapabilityStatus({
    capability: capabilities.orders.placement,
    expectedStatus: "environment-dependent",
    message: "order placement depends on the selected environment and account permissions",
  })
  assertCapabilityStatus({
    capability: capabilities.orders.cancellation,
    expectedStatus: "environment-dependent",
    message: "order cancellation depends on the selected environment and account permissions",
  })
})

test("Binance fill and user-data declarations do not imply complete history or replay", () => {
  const { capabilities } = createBroker()

  assertCapabilityStatus({
    capability: capabilities.fills.canonicalHistory,
    expectedStatus: "supported",
    message: "symbol-scoped paginated myTrades queries produce canonical fills",
  })
  assertCapabilityStatus({
    capability: capabilities.fills.completeHistory,
    expectedStatus: "unknown",
    message: "bounded trade queries do not prove complete account-wide fill history",
  })
  assertCapabilityStatus({
    capability: capabilities.fills.executionUpdates,
    expectedStatus: "supported",
    message: "TRADE executionReport events normalize into canonical order and fill updates",
  })
  assertCapabilityStatus({
    capability: capabilities.userData.stream,
    expectedStatus: "supported",
    message: "the signed Binance user-data subscription and event lifecycle are implemented",
  })
  assertCapabilityStatus({
    capability: capabilities.userData.eventReplay,
    expectedStatus: "unsupported",
    message: "reconnecting a user-data stream does not replay missed exchange events",
  })
})

test("Binance recovery declarations distinguish same-process from process-restart recovery", () => {
  const { capabilities } = createBroker()

  assertCapabilityStatus({
    capability: capabilities.recovery.sameProcess,
    expectedStatus: "supported",
    message: "the in-memory session implements consumer-acknowledged same-process recovery",
  })
  assertCapabilityStatus({
    capability: capabilities.recovery.processRestart,
    expectedStatus: "unsupported",
    message: "the broker does not persist recovery state across process restarts",
  })
})

test("Binance capability declarations identify the selected trading environment", () => {
  const testnetBroker = createBroker({ tradingMode: "testnet" })
  const liveBroker = createBroker({ tradingMode: "live" })

  assert.equal(
    testnetBroker.capabilities.environment.status,
    "environment-dependent",
    "Binance capabilities must disclose their environment dependency",
  )
  assert.equal(
    testnetBroker.capabilities.environment.selectedMode,
    "testnet",
    "a TESTNET declaration must identify its configured endpoint environment",
  )
  assert.equal(
    liveBroker.capabilities.environment.selectedMode,
    "live",
    "a LIVE declaration must identify its configured endpoint environment",
  )
  assert.deepEqual(
    testnetBroker.capabilities.environment.supportedModes,
    ["testnet", "live"],
    "the environment contract must list only explicitly supported Binance modes",
  )
  assert.equal(
    testnetBroker.capabilities.environment.nodeEnvSelectsEndpoint,
    false,
    "NODE_ENV must never be represented as an exchange endpoint selector",
  )
})

test("Binance capability metadata preserves CoreBroker compatibility and public exports", async () => {
  const broker = createBroker()

  assert.ok(broker instanceof CoreBroker, "BinanceWebSocketBroker must continue extending CoreBroker")
  assert.equal(
    broker.getPrice,
    CoreBroker.prototype.getPrice,
    "the legacy getPrice method must remain the inherited unsupported implementation",
  )
  assert.throws(
    () => broker.getPrice(),
    /implemented/i,
    "calling inherited getPrice must retain its existing unsupported behavior",
  )
  assert.deepEqual(
    Object.keys(await import("./index.js")).sort(),
    [
      "BinanceWebSocketBroker",
      "BinanceWebSocketConfig",
      "BitunixSpotBroker",
      "BitunixSpotConfig",
      "CoreBroker",
      "normalizeBinanceId",
    ],
    "capability metadata must not change the package's existing export surface",
  )
})
