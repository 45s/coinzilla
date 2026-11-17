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

function assertDeeplyFrozen(value, path = "capabilities") {
  assert.equal(
    Object.isFrozen(value),
    true,
    `${path} must be frozen so consumers cannot mutate declared broker guarantees`,
  )

  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== null && typeof nestedValue === "object") {
      assertDeeplyFrozen(nestedValue, `${path}.${key}`)
    }
  }
}

test("Binance broker exposes a versioned, deeply immutable capability declaration", () => {
  const broker = createBroker()
  const descriptor = Object.getOwnPropertyDescriptor(broker, "capabilities")

  assert.equal(
    descriptor?.writable,
    false,
    "the broker capability property must not be replaceable after construction",
  )
  assert.equal(
    descriptor?.configurable,
    false,
    "the broker capability property must not be removable or redefined",
  )
  assert.equal(
    broker.capabilities.contractVersion,
    1,
    "the capability contract must expose its schema version",
  )
  assert.equal(
    broker.capabilities.provider,
    "binance",
    "the declaration must identify the Binance provider",
  )
  assert.equal(
    broker.capabilities.product,
    "spot",
    "the declaration must identify the audited Binance product",
  )
  assertDeeplyFrozen(broker.capabilities)
})

test("Binance capabilities distinguish implemented, unsupported, unknown and conditional guarantees", () => {
  const { capabilities } = createBroker()

  assert.equal(
    capabilities.marketData.oneShotPrice.status,
    "supported",
    "the one-shot ticker.price request is a supported price read",
  )
  assert.equal(
    capabilities.marketData.priceStream.status,
    "supported",
    "the aggTrade subscription is a supported streaming capability",
  )
  assert.equal(
    capabilities.marketData.legacyPriceLookup.status,
    "unsupported",
    "the inherited CoreBroker getPrice method must not be advertised as supported",
  )
  assert.equal(
    capabilities.account.balances.status,
    "supported",
    "Binance account.status exposes normalized balance reads",
  )
  assert.equal(
    capabilities.account.snapshot.status,
    "supported",
    "the account snapshot validates Binance's source updateTime",
  )
  assert.equal(
    capabilities.orders.openOrders.status,
    "supported",
    "the signed openOrders.status operation returns normalized open orders",
  )
  assert.equal(
    capabilities.orders.statusLookup.status,
    "supported",
    "the order.status lookup is supported as a status observation",
  )
  assert.equal(
    capabilities.orders.canonicalLookup.status,
    "supported",
    "the canonical order lookup validates identity and market metadata",
  )
  assert.equal(
    capabilities.orders.reconciliation.status,
    "unsupported",
    "a canonical lookup must not be confused with an order reconciliation workflow",
  )
  assert.equal(
    capabilities.orders.placement.status,
    "environment-dependent",
    "order placement availability depends on the explicitly selected environment and account permissions",
  )
  assert.equal(
    capabilities.orders.cancellation.status,
    "environment-dependent",
    "order cancellation availability depends on the explicitly selected environment and account permissions",
  )
  assert.equal(
    capabilities.fills.canonicalHistory.status,
    "supported",
    "symbol-scoped paginated myTrades queries produce canonical fills",
  )
  assert.equal(
    capabilities.fills.completeHistory.status,
    "unknown",
    "a bounded trade-history query does not prove complete account-wide fill history",
  )
  assert.equal(
    capabilities.fills.executionUpdates.status,
    "supported",
    "TRADE executionReport events are normalized into canonical order and fill updates",
  )
  assert.equal(
    capabilities.userData.stream.status,
    "supported",
    "the signed Binance user-data subscription and event lifecycle are implemented",
  )
  assert.equal(
    capabilities.userData.eventReplay.status,
    "unsupported",
    "reconnecting a user-data stream does not replay missed exchange events",
  )
  assert.equal(
    capabilities.recovery.sameProcess.status,
    "supported",
    "the in-memory session implements reconnect and consumer-acknowledged same-process recovery",
  )
  assert.equal(
    capabilities.recovery.processRestart.status,
    "unsupported",
    "the broker does not persist recovery state across process restarts",
  )
})

test("Binance capability declarations identify the selected trading environment explicitly", () => {
  const testnetBroker = createBroker({ tradingMode: "testnet" })
  const liveBroker = createBroker({ tradingMode: "live" })

  assert.equal(
    testnetBroker.capabilities.environment.status,
    "environment-dependent",
    "Binance capability availability must disclose its environment dependency",
  )
  assert.equal(
    testnetBroker.capabilities.environment.selectedMode,
    "testnet",
    "a TESTNET broker declaration must identify its configured endpoint environment",
  )
  assert.equal(
    liveBroker.capabilities.environment.selectedMode,
    "live",
    "a LIVE broker declaration must identify its configured endpoint environment",
  )
  assert.deepEqual(
    testnetBroker.capabilities.environment.supportedModes,
    ["testnet", "live"],
    "the environment contract must list only the two explicitly supported Binance modes",
  )
  assert.equal(
    testnetBroker.capabilities.environment.nodeEnvSelectsEndpoint,
    false,
    "NODE_ENV must never be represented as an exchange endpoint selector",
  )
})

test("Binance capability declarations do not change CoreBroker compatibility or public exports", async () => {
  const broker = createBroker()

  assert.ok(
    broker instanceof CoreBroker,
    "BinanceWebSocketBroker must continue extending the public CoreBroker compatibility class",
  )
  assert.equal(
    broker.getPrice,
    CoreBroker.prototype.getPrice,
    "the legacy getPrice method must remain the inherited unsupported implementation",
  )
  assert.throws(
    () => broker.getPrice(),
    /implemented/i,
    "calling the inherited getPrice method must retain its existing unsupported behavior",
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
    "capability metadata must be additive without changing the package's existing export surface",
  )
})
