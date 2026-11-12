import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[read-operator-state.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { createReadOperatorState } from "./read-operator-state.js"

const actor = Object.freeze({
  id: "telegram-user:12345",
  roles: Object.freeze(["trading-operator"]),
})

function createHarness({
  runtimeSnapshot = {
    observedAt: 2000,
    startedAt: 100,
    connected: true,
    tradingEnabled: true,
    tradingMode: "testnet",
    strategyMode: "conservative",
    stopping: false,
    userData: {
      ready: false,
      status: "AUTHORITATIVE_RECONCILIATION_REQUIRED",
      lastEventAt: 1500,
      ageMs: 500,
    },
  },
  markets = [
    {
      symbol: "DOGEUSDT",
      enabled: true,
      baseAsset: "DOGE",
      quoteAsset: "USDT",
      marketMetadataReady: true,
      latestPrice: "0.12",
      priceTimestamp: 1400,
      priceFresh: false,
      operatorPaused: false,
      safetyPaused: false,
      recoveryManagedPaused: false,
      replacementPending: false,
      trailingBuyRepricePending: false,
      openOrderBlockerActive: false,
      volatilityProtection: { mode: "PROTECTED", reason: "HIGH_VOLATILITY" },
      blockers: ["MARKET_PRICE_STALE", "VOLATILITY_PROTECTION_ACTIVE"],
    },
    {
      symbol: "BTCUSDT",
      enabled: false,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      marketMetadataReady: true,
      latestPrice: null,
      priceTimestamp: null,
      priceFresh: false,
      operatorPaused: false,
      safetyPaused: false,
      recoveryManagedPaused: false,
      replacementPending: false,
      trailingBuyRepricePending: false,
      openOrderBlockerActive: false,
      volatilityProtection: null,
      blockers: ["MARKET_DISABLED"],
    },
  ],
  marketResult = { ok: true, data: { markets } },
} = {}) {
  const calls = []
  const engine = {
    getOperatorMarketSnapshots: async () => {
      calls.push("markets")
      return marketResult
    },
  }
  const readState = createReadOperatorState({
    engine,
    getRuntimeSnapshot: () => {
      calls.push("runtime")
      return runtimeSnapshot
    },
  })
  return { calls, readState }
}

test("returns an authorized immutable runtime status with explicit readiness and market counts", async () => {
  const { readState } = createHarness()

  const result = await readState.getStatus({ actor })

  assert.equal(result.ok, true, "An authorized operator must receive a successful read-only runtime status.")
  assert.equal(result.data.readiness.state, "BLOCKED", "An unready user-data gate must be reported as blocked.")
  assert.deepEqual(
    result.data.readiness.blockers,
    ["AUTHORITATIVE_RECONCILIATION_REQUIRED"],
    "The status must expose the actual application readiness blocker instead of claiming the runtime is ready.",
  )
  assert.deepEqual(
    result.data.markets,
    { configured: 2, enabled: 1, blocked: 1 },
    "The status summary must count configured, enabled, and blocked markets from the same snapshot.",
  )
  assert.equal(result.data.userData.ageMs, 500, "The status must preserve the age of the last user-data status event.")
  assert.equal(Object.isFrozen(result.data), true, "The application query must return an immutable status snapshot.")
  assert.equal(Object.isFrozen(result.data.readiness.blockers), true, "The blocker list must not expose mutable application state.")
})

test("returns market snapshots with global readiness blockers without mutating engine data", async () => {
  const { readState } = createHarness()

  const result = await readState.getMarkets({ actor })

  assert.equal(result.ok, true, "An authorized operator must receive a successful market snapshot.")
  assert.equal(result.data.markets[0].readiness, "BLOCKED", "An enabled market must be blocked while user-data readiness is closed.")
  assert.deepEqual(
    result.data.markets[0].blockers,
    ["MARKET_PRICE_STALE", "VOLATILITY_PROTECTION_ACTIVE", "USER_DATA_NOT_READY"],
    "Market output must combine market-local and global readiness blockers without hiding either source.",
  )
  assert.equal(result.data.markets[1].readiness, "DISABLED", "A disabled configured market must remain visibly disabled.")
  assert.deepEqual(
    result.data.markets[1].blockers,
    ["MARKET_DISABLED"],
    "A disabled market must not inherit trading-readiness blockers from the enabled runtime.",
  )
  assert.equal(Object.isFrozen(result.data.markets), true, "The returned market collection must be immutable.")
  assert.equal(Object.isFrozen(result.data.markets[0].blockers), true, "The returned blocker list must be immutable.")
})

test("reports observation-only readiness when trading is explicitly disabled", async () => {
  const { readState } = createHarness({
    runtimeSnapshot: {
      observedAt: 2000,
      startedAt: 100,
      connected: true,
      tradingEnabled: false,
      tradingMode: "testnet",
      strategyMode: "conservative",
      stopping: false,
      userData: { ready: false, status: "NOT_SUBSCRIBED", lastEventAt: null, ageMs: null },
    },
  })

  const result = await readState.getMarkets({ actor })

  assert.equal(result.ok, true, "Read-only market inspection must remain available when trading is disabled.")
  assert.equal(result.data.markets[0].readiness, "OBSERVATION_ONLY", "A non-trading runtime must not be mislabeled as trading-ready or blocked.")
  assert.deepEqual(
    result.data.markets[0].blockers,
    ["MARKET_PRICE_STALE", "VOLATILITY_PROTECTION_ACTIVE"],
    "Observation-only output must preserve market-data blockers without inventing a user-data trading blocker.",
  )
})

test("rejects an unauthorized query before reading runtime or engine state", async () => {
  const { calls, readState } = createHarness()

  const result = await readState.getStatus({ actor: { id: "untrusted", roles: [] } })

  assert.equal(result.ok, false, "A caller without the trading-operator role must not read operator status.")
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED", "Unauthorized query failures must use the stable operator authorization code.")
  assert.deepEqual(calls, [], "Unauthorized queries must be rejected before runtime or engine state is accessed.")
})

test("propagates an unsuccessful engine snapshot instead of returning partial or healthy market data", async () => {
  const { readState } = createHarness({
    marketResult: { ok: false, errors: [{ code: "SNAPSHOT_UNAVAILABLE" }] },
  })

  const result = await readState.getMarkets({ actor })

  assert.equal(result.ok, false, "A failed engine snapshot must make the market query fail rather than return partial data.")
  assert.equal(result.errors[0].code, "SNAPSHOT_UNAVAILABLE", "The query must preserve the engine's stable snapshot failure code.")
})
