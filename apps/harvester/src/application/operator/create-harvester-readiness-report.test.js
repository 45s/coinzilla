import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterReadinessReport } from "./create-harvester-readiness-report.js"

const test = (...args) => nodeTest("[create-harvester-readiness-report.test.js] " + args[0], ...args.slice(1))
const identity = Object.freeze({ providerInstanceId: "binanceTestnet", providerType: "binance", environment: "testnet" })

function createInputs() {
  return {
    observedAt: 20000,
    runtime: { runtimeState: "STARTING", tradingEnabled: true, tradingMode: "testnet", broker: "binance", stopping: false, startupComplete: false, userData: { ready: false, status: "PREFLIGHT_COMPLETE", lastEventAt: 19990, ageMs: 10 } },
    readinessInputs: {
      configuration: { validated: true, enabledMarkets: ["BTCUSDT", "ETHUSDT"] },
      broker: { connected: true, identity, capabilities: { validated: true, missing: [] } },
      account: { preflight: { completed: true, durable: true, sourceTime: 19900, balanceCount: 2 }, openOrders: { completed: true, durable: true, observedAt: 19950, orderCount: 0, readiness: "READY", blockReasons: [], unownedSymbols: [] } },
      userData: { subscriptionEstablished: true, preflightComplete: true, requiresReconciliation: false, accountingFailed: false, streamUnsafe: false, pendingRecovery: false, safetyHaltRequired: false },
      processContinuity: { storeConfigured: true, previousProcessStarted: false, restorationEnabled: false },
      markets: {
        BTCUSDT: { route: { expected: identity, actual: identity, priceSubscriptionReady: true, bookSubscriptionReady: true }, price: { valid: true, fresh: true, timestamp: 19999, source: "INITIAL_SEED", websocketEventReceived: false }, book: { required: true, fresh: true, timestamp: 19998 }, volatility: { enabled: true, snapshot: { ok: true, data: { status: { isReady: true, isFresh: true, blockers: [], historyCount: 100, requiredHistoryCount: 74, lastEventAt: 19999, observedAt: 20000 } } } }, externalOrdersPolicy: "IGNORE", unownedOrderObserved: false },
        ETHUSDT: { route: { expected: identity, actual: identity, priceSubscriptionReady: true, bookSubscriptionReady: true }, price: { valid: true, fresh: true, timestamp: 19999, source: "WEBSOCKET", websocketEventReceived: true }, book: { required: true, fresh: true, timestamp: 19998 }, volatility: { enabled: false, snapshot: null }, externalOrdersPolicy: "IGNORE", unownedOrderObserved: false },
      },
    },
    markets: [
      { symbol: "BTCUSDT", enabled: true, marketMetadataReady: true, orderType: "LIMIT_MAKER", latestPrice: "65000", priceTimestamp: 19999, priceFresh: true, bookTimestamp: 19998, bookFresh: true, volatilityProtection: { mode: "NORMAL" }, blockers: [] },
      { symbol: "ETHUSDT", enabled: true, marketMetadataReady: true, orderType: "LIMIT_MAKER", latestPrice: "2000", priceTimestamp: 19999, priceFresh: true, bookTimestamp: 19998, bookFresh: true, volatilityProtection: null, blockers: [] },
    ],
  }
}

test("reports healthy pre-trading readiness from actual component snapshots without opening the existing gate", () => {
  const report = createHarvesterReadinessReport(createInputs())
  assert.equal(report.status, "HEALTHY", "Complete source-backed startup evidence must produce a healthy readiness report.")
  assert.equal(report.tradingGateOpen, false, "The diagnostic report must not open the existing user-data trading gate.")
  assert.equal(report.markets.length, 2, "Every configured strategy market must have an explicit readiness result.")
  assert.equal(report.markets[0].readiness, "READY", "A market with fresh price, fresh required book and ready volatility must be ready.")
  assert.equal(report.checks.find(({ id }) => id === "account.preflight").status, "PASS", "The report must verify the existing durable account PREFLIGHT boundary.")
  assert.equal(report.markets[0].checks.find(({ id }) => id === "market.price").details.source, "INITIAL_SEED", "The report must distinguish an initial price seed from a live WebSocket price event.")
  assert.equal(report.markets[1].checks.find(({ id }) => id === "market.volatility").status, "NOT_APPLICABLE", "Disabled volatility protection must not be reported as missing data.")
})

test("keeps ADR-0004 external orders scoped to the affected market", () => {
  const inputs = createInputs()
  inputs.readinessInputs.account.openOrders = { completed: true, durable: true, observedAt: 19950, orderCount: 1, readiness: "BLOCKED", blockReasons: ["UNOWNED_OPEN_ORDERS:1"], unownedSymbols: ["ETHUSDT"] }
  inputs.readinessInputs.markets.ETHUSDT.unownedOrderObserved = true
  inputs.readinessInputs.markets.ETHUSDT.externalOrdersPolicy = "BLOCK"
  inputs.markets[1].openOrderBlockerActive = true
  inputs.markets[1].blockers = ["OPEN_ORDER_OWNERSHIP_BLOCKER"]
  const report = createHarvesterReadinessReport(inputs)
  assert.equal(report.checks.find(({ id }) => id === "account.open-orders").status, "WARNING", "External-order audit classification must not become a global account blocker.")
  assert.equal(report.markets[0].readiness, "READY", "An unrelated market must remain ready.")
  assert.equal(report.markets[1].readiness, "BLOCKED", "The configured BLOCK policy must block only its affected market.")
  assert.equal(report.status, "DEGRADED", "A market-local blocker must not globally block another ready market.")
})

test("fails closed for route mismatch, stale price, missing first book and unavailable enabled volatility", () => {
  const inputs = createInputs()
  inputs.readinessInputs.markets.BTCUSDT.route.actual = { providerInstanceId: "wrong-provider", providerType: "binance", environment: "testnet" }
  inputs.readinessInputs.markets.BTCUSDT.price.fresh = false
  inputs.readinessInputs.markets.BTCUSDT.book.fresh = false
  inputs.readinessInputs.markets.BTCUSDT.volatility.snapshot = { ok: true, data: { status: { isReady: false, isFresh: false, blockers: ["AWAITING_LIVE_DATA"], historyCount: 20, requiredHistoryCount: 74 } } }
  inputs.markets[0].priceFresh = false
  inputs.markets[0].bookFresh = false
  inputs.markets[0].blockers = ["MARKET_PRICE_STALE", "MARKET_BOOK_UNAVAILABLE", "VOLATILITY_DATA_UNAVAILABLE"]
  const market = createHarvesterReadinessReport(inputs).markets[0]
  assert.equal(market.readiness, "BLOCKED", "Incomplete market data must remain blocked.")
  assert.equal(market.checks.find(({ id }) => id === "market.route").status, "BLOCKED", "Provider identity mismatch must be explicit.")
  assert.equal(market.checks.find(({ id }) => id === "market.price").status, "BLOCKED", "A stale price must not be hidden by subscription acknowledgement.")
  assert.equal(market.checks.find(({ id }) => id === "market.book").status, "BLOCKED", "A book subscription without a fresh event must remain blocked.")
  assert.equal(market.checks.find(({ id }) => id === "market.volatility").status, "BLOCKED", "Unavailable required volatility history must fail closed.")
})

test("reports prior-process observation-only state and never claims restoration", () => {
  const inputs = createInputs()
  inputs.readinessInputs.processContinuity = { storeConfigured: true, previousProcessStarted: true, restorationEnabled: false }
  const report = createHarvesterReadinessReport(inputs)
  assert.equal(report.status, "BLOCKED", "A prior process with restoration disabled must not be described as healthy.")
  assert.equal(report.checks.find(({ id }) => id === "process.restoration").status, "BLOCKED", "Disabled restoration after a prior process must be explicit.")
  assert.equal(report.tradingEnabled, false, "The existing observation-only restriction must remain authoritative.")
})

test("does not claim a first process when continuity evidence is not configured and redacts private account identifiers", () => {
  const inputs = createInputs()
  inputs.readinessInputs.processContinuity = { storeConfigured: false, previousProcessStarted: null, restorationEnabled: false }
  inputs.readinessInputs.broker.identity.accountId = "private-account-id"
  const report = createHarvesterReadinessReport(inputs)
  const restoration = report.checks.find(({ id }) => id === "process.restoration")
  assert.equal(restoration.status, "NOT_APPLICABLE", "An unconfigured process ledger is not proof of a first process.")
  assert.equal(restoration.details.previousProcessStarted, null, "Unknown prior-process evidence must remain unknown.")
  assert.equal(JSON.stringify(report).includes("private-account-id"), false, "Private account identifiers must never appear in diagnostics.")
  assert.equal(Object.isFrozen(report), true, "The readiness report must be an immutable projection.")
})
