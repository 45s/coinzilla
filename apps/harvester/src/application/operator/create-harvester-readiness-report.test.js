import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterReadinessReport } from "./create-harvester-readiness-report.js"

const test = (...args) => nodeTest(`[create-harvester-readiness-report.test.js] ${  args[0]}`, ...args.slice(1))
const identity = Object.freeze({ providerInstanceId: "binanceTestnet",
providerType: "binance",
environment: "testnet" })

const DEFAULT_READINESS_INPUTS = {
    observedAt: 20000,
    runtime: { runtimeState: "STARTING",
startupBoundary: true,
tradingEnabled: true,
tradingMode: "testnet",
broker: "binance",
stopping: false,
startupComplete: false,
userData: { ready: false,
status: "PREFLIGHT_COMPLETE",
lastEventAt: 19990,
ageMs: 10 } },
    readinessInputs: {
      configuration: { validated: true,
enabledMarkets: ["BTCUSDT", "ETHUSDT"] },
      broker: { connected: true,
identity,
capabilities: { validated: true,
missing: [] } },
      account: { preflight: { completed: true,
durable: true,
sourceTime: 19900,
balanceCount: 2 },
openOrders: { completed: true,
durable: true,
observedAt: 19950,
orderCount: 0,
readiness: "READY",
blockReasons: [],
unownedSymbols: [] } },
      userData: { subscriptionEstablished: true,
preflightComplete: true,
requiresReconciliation: false,
accountingFailed: false,
streamUnsafe: false,
pendingRecovery: false,
safetyHaltRequired: false },
      processContinuity: { storeConfigured: true,
previousProcessStarted: false,
recoveryEnabled: false,
restorationEnabled: false },
      markets: {
        BTCUSDT: { route: { expected: identity,
actual: identity,
priceSubscriptionReady: true,
bookSubscriptionReady: true },
price: { valid: true,
fresh: true,
timestamp: 19999,
source: "INITIAL_SEED",
websocketEventReceived: false,
freshnessThresholdMs: 5000 },
book: { required: true,
fresh: true,
timestamp: 19998,
eventReceived: true,
freshnessThresholdMs: 5000 },
volatility: { enabled: true,
snapshot: { ok: true,
data: { status: { isReady: true,
isFresh: true,
blockers: [],
historyCount: 100,
requiredHistoryCount: 74,
lastEventAt: 19999,
freshnessThresholdMs: 65000,
observedAt: 20000 } } } },
externalOrdersPolicy: "IGNORE",
unownedOrderObserved: false },
        ETHUSDT: { route: { expected: identity,
actual: identity,
priceSubscriptionReady: true,
bookSubscriptionReady: true },
price: { valid: true,
fresh: true,
timestamp: 19999,
source: "WEBSOCKET",
websocketEventReceived: true },
book: { required: true,
fresh: true,
timestamp: 19998,
eventReceived: true },
volatility: { enabled: false,
snapshot: null },
externalOrdersPolicy: "IGNORE",
unownedOrderObserved: false },
      },
    },
    markets: [
      { symbol: "BTCUSDT",
enabled: true,
marketMetadataReady: true,
orderType: "LIMIT_MAKER",
latestPrice: "65000",
priceTimestamp: 19999,
priceFresh: true,
bookTimestamp: 19998,
bookFresh: true,
volatilityProtection: { mode: "NORMAL" },
blockers: [] },
      { symbol: "ETHUSDT",
enabled: true,
marketMetadataReady: true,
orderType: "LIMIT_MAKER",
latestPrice: "2000",
priceTimestamp: 19999,
priceFresh: true,
bookTimestamp: 19998,
bookFresh: true,
volatilityProtection: null,
blockers: [] },
    ],
  }

function createInputs() {
  return structuredClone(DEFAULT_READINESS_INPUTS)
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
  inputs.readinessInputs.account.openOrders = { completed: true,
durable: true,
observedAt: 19950,
orderCount: 1,
readiness: "BLOCKED",
blockReasons: ["UNOWNED_OPEN_ORDERS:1"],
unownedSymbols: ["ETHUSDT"] }
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

test("reports measured broker connection latency and configured exchange capability evidence", () => {
  const inputs = createInputs()
  inputs.readinessInputs.broker.connection = {
    startedAt: 19_900,
    connectedAt: 19_950,
    elapsedMs: 50,
    errorCode: null,
  }
  inputs.readinessInputs.broker.capabilities.exchangeRequired = ["ORDER_READ"]
  inputs.readinessInputs.broker.capabilities.exchangeValidated = true
  const report = createHarvesterReadinessReport(inputs)
  const connection = report.checks.find(({ id }) => id === "broker.connection")
  const capabilities = report.checks.find(({ id }) => id === "broker.capabilities")

  assert.equal(connection.observed.elapsedMs, 50, "Connection latency must come from the measured startup handshake.")
  assert.equal(connection.observed.connectedAt, 19_950, "The report must expose the observed connection timestamp.")
  assert.equal(capabilities.observed.exchangeValidation, "PASS", "Configured provider capability requirements must be reported separately from structural BrokerPort methods.")
})


test("reports measured broker connection latency and configured exchange capability evidence", () => {
  const inputs = createInputs()
  inputs.readinessInputs.broker.connection = {
    startedAt: 19_900,
    connectedAt: 19_950,
    elapsedMs: 50,
    errorCode: null,
  }
  inputs.readinessInputs.broker.capabilities.exchangeRequired = ["ORDER_READ"]
  inputs.readinessInputs.broker.capabilities.exchangeValidated = true
  const report = createHarvesterReadinessReport(inputs)
  const connection = report.checks.find(({ id }) => id === "broker.connection")
  const capabilities = report.checks.find(({ id }) => id === "broker.capabilities")

  assert.equal(connection.observed.elapsedMs, 50, "Connection latency must come from the measured startup handshake.")
  assert.equal(connection.observed.connectedAt, 19_950, "The report must expose the observed connection timestamp.")
  assert.equal(capabilities.observed.exchangeValidation, "PASS", "Configured provider capability requirements must be reported separately from structural BrokerPort methods.")
})


test("account-scoped safety blockers block globally while non-account blockers remain scoped warnings", () => {
  const accountInputs = createInputs()
  accountInputs.readinessInputs.accountSafety = {
    blocker: {
      scope: "ACCOUNT",
      reason: "ACCOUNT_SAFETY_HALT",
      blockerId: "safety-halt-1",
    },
  }
  const accountReport = createHarvesterReadinessReport(accountInputs)
  assert.equal(accountReport.runtimeBlockers.includes("ACCOUNT_SAFETY_HALT"), true, "An account-scoped safety blocker must prevent global trading activation.")

  const marketInputs = createInputs()
  marketInputs.readinessInputs.accountSafety = {
    blocker: {
      scope: "MARKET",
      reason: "MARKET_SAFETY_PAUSE",
      blockerId: "market-pause-1",
    },
  }
  const marketReport = createHarvesterReadinessReport(marketInputs)
  const safetyCheck = marketReport.checks.find(({ id }) => id === "account.safety-blocker")
  assert.equal(safetyCheck.status, "WARNING", "A non-account safety blocker must not become a global trading blocker.")
  assert.equal(marketReport.runtimeBlockers.includes("MARKET_SAFETY_PAUSE"), false, "Market-scoped safety must remain outside the account-wide blocker list.")
})

test("exposes source, expected condition and source-owned freshness thresholds without leaking account identity", () => {
  const inputs = createInputs()
  inputs.readinessInputs.broker.identity = {
    ...inputs.readinessInputs.broker.identity,
    accountId: "private-account-123",
  }
  const report = createHarvesterReadinessReport(inputs)
  const priceCheck = report.markets[0].checks.find(({ id }) => id === "market.price")
  const volatilityCheck = report.markets[0].checks.find(({ id }) => id === "market.volatility")

  assert.equal(priceCheck.observedAt, 20_000, "Every market diagnostic must carry the report observation time.")
  assert.equal(priceCheck.sourceOfTruth, "Accepted market-price event and existing engine freshness snapshot", "The report must identify the authoritative source for its price claim.")
  assert.equal(priceCheck.expected.length > 0, true, "The report must state the expected price condition.")
  assert.equal(priceCheck.observed.freshnessThresholdMs, 5_000, "Price diagnostics must preserve the existing five-second gate.")
  assert.equal(volatilityCheck.observed.freshnessThresholdMs, 65_000, "Volatility diagnostics must preserve the candle service's 65-second threshold.")
  assert.equal(JSON.stringify(report).includes("private-account-123"), false, "Provider account identity must not be exposed in the report.")
})


test("fails closed for route mismatch, stale price, missing first book and unavailable enabled volatility", () => {
  const inputs = createInputs()
  inputs.readinessInputs.markets.BTCUSDT.route.actual = { providerInstanceId: "wrong-provider",
providerType: "binance",
environment: "testnet" }
  inputs.readinessInputs.markets.BTCUSDT.price.fresh = false
  inputs.readinessInputs.markets.BTCUSDT.book.fresh = false
  inputs.readinessInputs.markets.BTCUSDT.book.eventReceived = false
  inputs.readinessInputs.markets.BTCUSDT.volatility.snapshot = { ok: true,
data: { status: { isReady: false,
isFresh: false,
blockers: ["AWAITING_LIVE_DATA"],
historyCount: 20,
requiredHistoryCount: 74 } } }
  inputs.markets[0].priceFresh = false
  inputs.markets[0].bookFresh = false
  inputs.markets[0].blockers = ["MARKET_PRICE_STALE", "MARKET_BOOK_UNAVAILABLE", "VOLATILITY_DATA_UNAVAILABLE"]
  const { markets: [market] } = createHarvesterReadinessReport(inputs)
  assert.equal(market.readiness, "BLOCKED", "Incomplete market data must remain blocked.")
  assert.equal(market.checks.find(({ id }) => id === "market.route").status, "BLOCKED", "Provider identity mismatch must be explicit.")
  assert.equal(market.checks.find(({ id }) => id === "market.price").status, "BLOCKED", "A stale price must not be hidden by subscription acknowledgement.")
  assert.equal(market.checks.find(({ id }) => id === "market.book").status, "BLOCKED", "A book subscription without a fresh event must remain blocked.")
  assert.equal(market.checks.find(({ id }) => id === "market.volatility").status, "BLOCKED", "Unavailable required volatility history must fail closed.")
})

test("does not block a fresh current-process session when prior process recovery is disabled", () => {
  const inputs = createInputs()
  inputs.readinessInputs.processContinuity = {
    storeConfigured: true,
    previousProcessStarted: true,
    restorationEnabled: false,
    recoveryEnabled: false,
  }
  inputs.runtime.tradingEnabled = true
  inputs.runtime.userData.ready = true
  const report = createHarvesterReadinessReport(inputs)
  const restoration = report.checks.find(({ id }) => id === "process.restoration")

  assert.equal(report.status, "HEALTHY", "Disabled process restoration must not block a fresh current-session readiness report.")
  assert.equal(restoration.status, "NOT_APPLICABLE", "Prior process history is not a restoration failure when restoration is disabled by configuration.")
  assert.equal(restoration.code, "PROCESS_RESTART_RECOVERY_DISABLED", "The report must identify the explicit recovery configuration.")
  assert.equal(restoration.blocksTrading, false, "A deliberately disabled restoration check must not gate current-session trading.")
  assert.equal(report.tradingEnabled, true, "Fresh current-session trading remains eligible after its own readiness checks pass.")
  assert.equal(report.tradingGateOpen, true, "The current-process PREFLIGHT/user-data gate must be open.")
  assert.ok(report.checks.filter(({ id }) => id === "market.price").every(({ status }) => status === "PASS"),
    "Fresh initial-price seeds must clear market.price health checks.")
  assert.ok(report.checks.filter(({ id }) => id === "market.engine-safety").every(({ status }) => status === "PASS"),
    "With current-session readiness established, market engine-safety checks must report their actual blockers.")
})

test("keeps prior-process trading blocked when process recovery is enabled but restoration is not accepted", () => {
  const inputs = createInputs()
  inputs.readinessInputs.processContinuity = {
    storeConfigured: true,
    previousProcessStarted: true,
    restorationEnabled: false,
    recoveryEnabled: true,
  }
  inputs.runtime.tradingEnabled = false
  const report = createHarvesterReadinessReport(inputs)
  const restoration = report.checks.find(({ id }) => id === "process.restoration")

  assert.equal(report.status, "BLOCKED", "An unrestored prior process must remain blocked when process recovery is enabled.")
  assert.equal(restoration.status, "BLOCKED", "The readiness report must retain the existing fail-closed restoration gate.")
  assert.equal(report.tradingEnabled, false, "The report must not enable trading before required restoration is accepted.")
})

test("does not claim a first process when continuity evidence is not configured and redacts private account identifiers", () => {
  const inputs = createInputs()
  inputs.readinessInputs.processContinuity = { storeConfigured: false,
previousProcessStarted: null,
restorationEnabled: false }
  inputs.readinessInputs.broker.identity.accountId = "private-account-id"
  const report = createHarvesterReadinessReport(inputs)
  const restoration = report.checks.find(({ id }) => id === "process.restoration")
  assert.equal(restoration.status, "NOT_APPLICABLE", "An unconfigured process ledger is not proof of a first process.")
  assert.equal(restoration.details.previousProcessStarted, null, "Unknown prior-process evidence must remain unknown.")
  assert.equal(JSON.stringify(report).includes("private-account-id"), false, "Private account identifiers must never appear in diagnostics.")
  assert.equal(Object.isFrozen(report), true, "The readiness report must be an immutable projection.")
})

test("reports non-Conservative-only market scope without blocking its existing strategy gate", () => {
  const inputs = createInputs()
  inputs.readinessInputs.configuration.marketSnapshotRequired = false
  inputs.readinessInputs.marketSnapshotAvailable = true
  inputs.markets = []

  const report = createHarvesterReadinessReport(inputs)
  const scopeCheck = report.checks.find(({ id }) => id === "runtime.conservative-market-snapshot")

  assert.equal(report.status, "DEGRADED", "A Conservative snapshot must not be claimed when only non-Conservative routes are configured.")
  assert.equal(report.runtimeBlockers.length, 0, "A missing Conservative engine snapshot must not globally block a non-Conservative-only runtime.")
  assert.equal(scopeCheck.status, "WARNING", "The report must explicitly disclose that Conservative engine evidence is not applicable.")
  assert.equal(scopeCheck.blocksTrading, false, "The warning must not replace the existing non-Conservative strategy admission gate.")
})
