import test from "node:test"
import assert from "node:assert/strict"
import { EventBus } from "@coinzilla/event-bus"
import { Asset, CanonicalOrder, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { HARVESTER_EVENT_NAMES, HARVESTER_EVENT_SOURCE } from "./event-names.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerDisconnectedData,
  mapBrokerStatusChangedData,
  mapBrokerExecutionReportData,
  mapOrderUpdatedData,
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
  mapConfigValidatedData,
  mapHarvesterStartedData,
  mapHarvesterStartupFailedData,
  mapHarvesterStoppedData,
  mapOrderSubmissionFailedData,
  mapOrderCancelFailedData,
  mapOrderCancelledData,
  mapOrderCancellationRequestedData,
  mapFillAppliedData,
  mapDuplicateFillData,
  mapRecoveryCycleCompletedData,
  mapAccountSnapshotCapturedData,
  mapAccountOpenOrdersCapturedData,
  mapExecutionAccountingFailedData,
  mapExecutionInvalidFillData,
  mapExecutionUnownedOrderData,
  mapOrderSubmissionRequestedData,
  mapOrderSubmittedData,
  mapStrategyDecisionData,
  mapStrategyPausedData,
} from "./lifecycle-event-dtos.js"

const validLifecycle = {
  broker: "binance",
  strategyMode: "read-only",
  enabledMarkets: ["ZROUSDT", "BTCUSDT"],
  tradingEnabled: false,
}

test("exports stable names and source for the initial operational lifecycle contract", () => {
  assert.deepEqual(HARVESTER_EVENT_NAMES, {
    STARTED: "harvester.started",
    STARTUP_FAILED: "harvester.startup_failed",
    STOPPED: "harvester.stopped",
    CONFIG_VALIDATED: "config.validated",
    BROKER_CONNECTED: "broker.connected",
    BROKER_CONNECTION_FAILED: "broker.connection_failed",
    BROKER_DISCONNECTED: "broker.disconnected",
    BROKER_STATUS_CHANGED: "broker.status_changed",
    BROKER_SUBSCRIPTION_ESTABLISHED: "broker.subscription_established",
    BROKER_SUBSCRIPTION_FAILED: "broker.subscription_failed",
    STRATEGY_DECISION: "strategy.decision",
    BROKER_EXECUTION_REPORT: "broker.execution_report",
    ORDER_UPDATED: "order.updated",
    ORDER_SUBMISSION_REQUESTED: "order.submission_requested",
    ORDER_SUBMITTED: "order.submitted",
    ORDER_CANCELLATION_REQUESTED: "order.cancel_requested",
    ORDER_SUBMISSION_FAILED: "order.submission_failed",
    STRATEGY_PAUSED: "strategy.paused",
    ORDER_CANCELLED: "order.cancelled",
    ORDER_CANCEL_FAILED: "order.cancel_failed",
    FILL_APPLIED: "execution.fill_applied",
    EXECUTION_UNOWNED_ORDER: "execution.unowned_order",
    EXECUTION_INVALID_FILL: "execution.invalid_fill",
    EXECUTION_ACCOUNTING_FAILED: "execution.accounting_failed",
    EXECUTION_DUPLICATE_FILL: "execution.duplicate_fill",
    RECOVERY_CYCLE_COMPLETED: "recovery.cycle_completed",
    ACCOUNT_SNAPSHOT_CAPTURED: "account.snapshot_captured",
  ACCOUNT_OPEN_ORDERS_CAPTURED: "account.open_orders_captured",
  })
  assert.equal(HARVESTER_EVENT_SOURCE, "harvester")
  assert.ok(Object.isFrozen(HARVESTER_EVENT_NAMES))
})

test("maps application-start facts to an allowlisted plain DTO", () => {
  const result = mapHarvesterStartedData({
    ...validLifecycle,
    apiKey: "must-not-be-copied",
    apiSecret: "must-not-be-copied",
    account: { balances: ["private"] },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    broker: "binance",
    strategyMode: "read-only",
    enabledMarkets: ["ZROUSDT", "BTCUSDT"],
    tradingEnabled: false,
  })
  assert.equal("apiKey" in result.data, false)
  assert.equal("account" in result.data, false)
})

test("maps validated configuration without copying full configuration or credentials", () => {
  const result = mapConfigValidatedData({
    enabledMarkets: ["ZROUSDT"],
    strategyMode: "conservative",
    tradingEnabled: true,
    config: { apiKey: "private", pairs: { ZROUSDT: { investment: 100 } } },
  })

  assert.deepEqual(result, {
    ok: true,
    data: {
      enabledMarkets: ["ZROUSDT"],
      strategyMode: "conservative",
      tradingEnabled: true,
    },
  })
})

test("maps broker connection success and sanitizes sensitive error values", () => {
  assert.deepEqual(mapBrokerConnectedData({ broker: "binance" }), {
    ok: true,
    data: { broker: "binance" },
  })

  const result = mapBrokerConnectionFailedData({
    broker: "binance",
    error: new Error('connect failed apiKey="key-value" api_secret=secret-value API key plain-value Bearer abc.def https://user:password@host.invalid/path'),
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.broker, "binance")
  assert.equal(result.data.error.name, "Error")
  assert.match(result.data.error.message, /apiKey=\[REDACTED\]/)
  assert.match(result.data.error.message, /api_secret=\[REDACTED\]/)
  assert.match(result.data.error.message, /Bearer \[REDACTED\]/)
  assert.match(result.data.error.message, /API key \[REDACTED\]/)
  assert.match(result.data.error.message, /https:\/\/\[REDACTED\]@host\.invalid/)
  assert.equal("stack" in result.data.error, false)
  assert.equal("cause" in result.data.error, false)
  assert.ok(result.data.error.message.length <= 240)
})

test("maps broker disconnection outcome without retaining an Error instance", () => {
  const error = new Error("socket closed")
  const result = mapBrokerDisconnectedData({ broker: "binance", outcome: "failed", error })
  assert.deepEqual(result, {
    ok: true,
    data: {
      broker: "binance",
      outcome: "failed",
      error: { name: "Error", message: "socket closed" },
    },
  })
  assert.equal(result.data.error instanceof Error, false)
})

test("maps process startup failure with a bounded, sanitized error DTO", () => {
  const result = mapHarvesterStartupFailedData({
    stage: "bootstrap",
    error: new Error("startup failed password=secret-value"),
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      stage: "bootstrap",
      error: { name: "Error", message: "startup failed password=[REDACTED]" },
    },
  })
})

test("maps process shutdown reason and outcome", () => {
  assert.deepEqual(mapHarvesterStoppedData({ reason: "SIGTERM", outcome: "success" }), {
    ok: true,
    data: { reason: "SIGTERM", outcome: "success" },
  })
})

test("rejects missing identifiers, invalid modes, duplicate markets, and invalid values", () => {
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, broker: " " }).ok, false)
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, strategyMode: "unknown" }).ok, false)
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, enabledMarkets: ["BTCUSDT", "BTCUSDT"] }).ok, false)
  assert.equal(mapHarvesterStartedData({ ...validLifecycle, tradingEnabled: "false" }).ok, false)
  assert.equal(mapConfigValidatedData({ enabledMarkets: "ZROUSDT", strategyMode: "read-only", tradingEnabled: false }).ok, false)
  assert.equal(mapBrokerConnectedData({ broker: "" }).ok, false)
  assert.equal(mapHarvesterStoppedData({ reason: "SIGTERM", outcome: "unknown" }).ok, false)
  assert.equal(mapHarvesterStartupFailedData({ stage: "bootstrap", error: "failure" }).ok, false)
})

test("rejects non-object mapper inputs and non-Error failure details safely", () => {
  assert.equal(mapHarvesterStartedData(null).ok, false)
  assert.equal(mapBrokerConnectionFailedData({ broker: "binance", error: { message: "bad" } }).ok, false)
  assert.equal(mapBrokerDisconnectedData({ broker: "binance", outcome: "success", error: new Date() }).ok, false)
})

test("EventBus accepts mapped lifecycle DTOs and rejects unsupported payload objects", () => {
  const eventBus = new EventBus()
  const mapped = mapHarvesterStartedData(validLifecycle)
  assert.equal(mapped.ok, true)
  const accepted = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.STARTED,
    source: HARVESTER_EVENT_SOURCE,
    data: mapped.data,
  })
  assert.equal(accepted.ok, true)
  assert.doesNotThrow(() => JSON.stringify(mapped.data))

  const rejected = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.STARTED,
    source: HARVESTER_EVENT_SOURCE,
    data: { invalid: new Date() },
  })
  assert.equal(rejected.ok, false)
  assert.ok(rejected.errors[0] instanceof TypeError)

  class PrivateAccountSnapshot {
    constructor() { this.balance = "private" }
  }
  const classInstanceResult = eventBus.publish({
    name: HARVESTER_EVENT_NAMES.STARTED,
    source: HARVESTER_EVENT_SOURCE,
    data: { account: new PrivateAccountSnapshot() },
  })
  assert.equal(classInstanceResult.ok, false)
  assert.ok(classInstanceResult.errors[0] instanceof TypeError)
})

test("maps subscription lifecycle facts without SDK objects", () => {
  assert.deepEqual(mapBrokerSubscriptionEstablishedData({
    broker: "binance",
    stream: "market-price",
    market: "BTCUSDT",
    subscription: { id: "private-sdk-object" },
  }), {
    ok: true,
    data: { broker: "binance", stream: "market-price", market: "BTCUSDT" },
  })

  const failed = mapBrokerSubscriptionFailedData({
    broker: "binance",
    stream: "user-data",
    error: new Error("subscription failed token=private"),
  })
  assert.equal(failed.ok, true)
  assert.deepEqual(failed.data, {
    broker: "binance",
    stream: "user-data",
    error: { name: "Error", message: "subscription failed token=[REDACTED]" },
  })
})

test("maps meaningful broker stream transitions and recovery metadata", () => {
  const result = mapBrokerStatusChangedData({
    broker: "binance",
    stream: "user-data",
    status: "recovered",
    recoveryRequired: true,
    attempt: 2,
    subscriptionId: "private-sdk-id",
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      broker: "binance",
      stream: "user-data",
      status: "recovered",
      recoveryRequired: true,
      attempt: 2,
    },
  })
  assert.equal(mapBrokerStatusChangedData({
    broker: "binance",
    stream: "user-data",
    status: "connectionClosed",
    recoveryRequired: true,
    code: 1006,
    error: new Error("socket closed"),
  }).ok, true)
})

test("rejects invalid subscription and stream status DTOs", () => {
  assert.equal(mapBrokerSubscriptionEstablishedData({ broker: "binance", stream: "unknown" }).ok, false)
  assert.equal(mapBrokerSubscriptionEstablishedData({ broker: "binance", stream: "market-price" }).ok, false)
  assert.equal(mapBrokerSubscriptionFailedData({ broker: "binance", stream: "user-data", error: "failure" }).ok, false)
  assert.equal(mapBrokerStatusChangedData({ broker: "binance", stream: "user-data", status: "recovered", recoveryRequired: "true" }).ok, false)
  assert.equal(mapBrokerStatusChangedData({ broker: "binance", stream: "user-data", status: "recovered", recoveryRequired: true, attempt: -1 }).ok, false)
})


const canonicalOrderFacts = {
  clientOrderId: "h-DOGEUSDT-1",
  brokerOrderId: "broker-1",
  market: { symbol: "DOGEUSDT" },
  side: "BUY",
  type: "LIMIT_MAKER",
  limitPrice: { amount: "99.9500" },
  originalQuantity: { amount: "1.00" },
  status: "OPEN",
}

test("maps actionable strategy decisions using exact decimal strings and allowlisted fields", () => {
  const result = mapStrategyDecisionData({
    strategy: "CONSERVATIVE",
    symbol: "DOGEUSDT",
    referencePrice: "100.000",
    actions: [{
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.9500",
      quantity: "1.00",
      reason: "INITIAL_BUY",
      apiKey: "must-not-be-copied",
    }],
    account: { balance: "private" },
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      strategy: "CONSERVATIVE",
      symbol: "DOGEUSDT",
      referencePrice: "100.000",
      actions: [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "99.9500",
        quantity: "1.00",
        reason: "INITIAL_BUY",
      }],
    },
  })
  assert.equal(mapStrategyDecisionData({
    strategy: "CONSERVATIVE", symbol: "DOGEUSDT", referencePrice: "100", actions: [],
  }).ok, false)
  assert.equal(mapStrategyDecisionData({
    strategy: "CONSERVATIVE", symbol: "DOGEUSDT", referencePrice: "100", actions: [{
      side: "BUY", type: "LIMIT", price: "not-a-decimal", quantity: "1",
    }],
  }).ok, false)
})

test("maps order request and acknowledgement without leaking extra order properties", () => {
  assert.deepEqual(mapOrderSubmissionRequestedData({
    order: { ...canonicalOrderFacts, apiSecret: "private", account: { balance: "private" } },
  }), {
    ok: true,
    data: {
      clientOrderId: "h-DOGEUSDT-1",
      symbol: "DOGEUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.9500",
      quantity: "1.00",
      status: "OPEN",
    },
  })
  assert.deepEqual(mapOrderSubmittedData({ order: canonicalOrderFacts }), {
    ok: true,
    data: {
      clientOrderId: "h-DOGEUSDT-1",
      symbol: "DOGEUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.9500",
      quantity: "1.00",
      brokerOrderId: "broker-1",
      status: "OPEN",
    },
  })
})

test("maps rejected and unknown order outcomes with sanitized errors only", () => {
  const result = mapOrderSubmissionFailedData({
    order: canonicalOrderFacts,
    outcome: "UNKNOWN",
    error: new Error("request failed apiKey=private-value"),
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      clientOrderId: "h-DOGEUSDT-1",
      symbol: "DOGEUSDT",
      side: "BUY",
      outcome: "UNKNOWN",
      error: { name: "Error", message: "request failed apiKey=[REDACTED]" },
    },
  })
  assert.equal(mapOrderSubmissionFailedData({
    order: canonicalOrderFacts, outcome: "INVALID", error: new Error("no"),
  }).ok, false)
})


test("maps cancellation intent before broker I/O with exact order identity", () => {
  const result = mapOrderCancellationRequestedData({
    order: {
      ...canonicalOrderFacts,
      executedQuantity: { amount: "0.25" },
      status: "PARTIALLY_FILLED",
    },
    reason: "TRAILING_BUY_REPRICE",
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      clientOrderId: "h-DOGEUSDT-1",
      symbol: "DOGEUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.9500",
      quantity: "1.00",
      brokerOrderId: "broker-1",
      executedQuantity: "0.25",
      status: "PARTIALLY_FILLED",
      reason: "TRAILING_BUY_REPRICE",
    },
  })
  assert.equal(mapOrderCancellationRequestedData({
    order: { ...canonicalOrderFacts, status: "PENDING" },
    reason: "TRAILING_BUY_REPRICE",
  }).ok, false)
})

test("maps strategy pause and cancellation outcomes as safe DTOs", () => {
  const paused = mapStrategyPausedData({
    symbol: "DOGEUSDT",
    reason: "ORDER_REJECTED",
    error: new Error("password=private-value"),
    apiKey: "not-copied",
  })
  assert.deepEqual(paused, {
    ok: true,
    data: {
      symbol: "DOGEUSDT",
      reason: "ORDER_REJECTED",
      error: { name: "Error", message: "password=[REDACTED]" },
    },
  })

  assert.deepEqual(mapOrderCancelledData({ order: {
    ...canonicalOrderFacts,
    status: "CANCELED",
    executedQuantity: { amount: "0.25" },
    account: { balance: "private" },
  } }), {
    ok: true,
    data: {
      clientOrderId: "h-DOGEUSDT-1",
      symbol: "DOGEUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.9500",
      quantity: "1.00",
      brokerOrderId: "broker-1",
      executedQuantity: "0.25",
      status: "CANCELED",
    },
  })

  const failed = mapOrderCancelFailedData({
    order: canonicalOrderFacts,
    outcome: "UNCONFIRMED",
    error: new Error("apiSecret=private-value"),
  })
  assert.deepEqual(failed, {
    ok: true,
    data: {
      clientOrderId: "h-DOGEUSDT-1",
      symbol: "DOGEUSDT",
      side: "BUY",
      brokerOrderId: "broker-1",
      status: "OPEN",
      outcome: "UNCONFIRMED",
      error: { name: "Error", message: "apiSecret=[REDACTED]" },
    },
  })
  assert.equal(mapOrderCancelledData({ order: canonicalOrderFacts }).ok, false)
})


test("maps an unknown recovery SELL cancellation state safely", () => {
  const result = mapOrderCancelFailedData({
    order: canonicalOrderFacts,
    outcome: "ORDER_STATE_UNKNOWN",
    error: new Error("order state unavailable"),
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.data.outcome, "ORDER_STATE_UNKNOWN")
})


test("maps canonical applied Fill facts to an allowlisted exact-decimal DTO", () => {
  const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
  const fill = new Fill({
    tradeId: "trade-42",
    brokerOrderId: "broker-order-42",
    clientOrderId: "harvester-order-42",
    market,
    side: "BUY",
    price: new Money({ amount: "99.9500", asset: quoteAsset }),
    quantity: new Quantity({ amount: "0.500", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "49.97500", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 123,
    commissions: [new Commission({
      amount: new Money({ amount: "0.0005", asset: baseAsset }),
    })],
    commissionStatus: "COMPLETE",
  })
  const result = mapFillAppliedData({
    fill,
    apiSecret: "must-not-be-copied",
    accountSnapshot: { balance: "private" },
  })

  assert.deepEqual(result, {
    ok: true,
    data: {
      fillId: fill.id,
      tradeId: "trade-42",
      brokerOrderId: "broker-order-42",
      clientOrderId: "harvester-order-42",
      symbol: "DOGEUSDT",
      side: "BUY",
      price: "99.95",
      quantity: "0.5",
      quoteQuantity: "49.975",
      liquidityRole: "MAKER",
      executedAt: 123,
      commissions: [{
        amount: "0.0005",
        assetId: "asset:DOGE",
        asset: "DOGE",
      }],
      commissionStatus: "COMPLETE",
    },
  })
  assert.equal(mapFillAppliedData({ fill: {} }).ok, false)
})


test("maps invalid, unowned, and accounting-failed execution facts safely", () => {
  const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
  const order = new CanonicalOrder({
    clientOrderId: "harvester-client-1",
    brokerOrderId: "broker-order-1",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99.95", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    status: "PARTIALLY_FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
  })
  const fill = new Fill({
    tradeId: "trade-1",
    brokerOrderId: "broker-order-1",
    clientOrderId: "harvester-client-1",
    market,
    side: "BUY",
    price: new Money({ amount: "99.95", asset: quoteAsset }),
    quantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "49.975", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 2,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  assert.equal(mapExecutionUnownedOrderData({ order, apiSecret: "private" }).data.reason,
    "UNKNOWN_OR_EXTERNAL_ORDER_EVENT")
  assert.deepEqual(mapExecutionInvalidFillData({
    order, fill, reason: "IDENTITY_MISMATCH", error: new Error("token=private"),
  }).data, {
    clientOrderId: "harvester-client-1",
    brokerOrderId: "broker-order-1",
    symbol: "DOGEUSDT",
    side: "BUY",
    status: "PARTIALLY_FILLED",
    reason: "IDENTITY_MISMATCH",
    fillId: fill.id,
    fillBrokerOrderId: "broker-order-1",
    fillSymbol: "DOGEUSDT",
    fillSide: "BUY",
    error: { name: "Error", message: "token=[REDACTED]" },
  })
  assert.equal(mapExecutionAccountingFailedData({
    order, fill, error: new Error("commission rejected"),
  }).data.fillId, fill.id)
})


test("maps duplicate Fill and recovery-cycle completion DTOs", () => {
  const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
  const fill = new Fill({
    tradeId: "duplicate-trade",
    brokerOrderId: "broker-order",
    clientOrderId: "harvester-order",
    market,
    side: "SELL",
    price: new Money({ amount: "101.25", asset: quoteAsset }),
    quantity: new Quantity({ amount: "0.25", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "25.3125", asset: quoteAsset }),
    liquidityRole: "TAKER",
    executedAt: 124,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const duplicate = mapDuplicateFillData({ fill })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(duplicate.data.fillId, fill.id)
  assert.deepEqual(mapRecoveryCycleCompletedData({
    symbol: "DOGEUSDT",
    marketId: market.id,
    freeQuantity: "0.1",
    realizedNetProfit: "1.2345",
    apiKey: "not-copied",
  }), {
    ok: true,
    data: {
      symbol: "DOGEUSDT",
      marketId: market.id,
      freeQuantity: "0.1",
      realizedNetProfit: "1.2345",
    },
  })
})

test("maps all account assets into sorted exact-decimal snapshot facts", () => {
  const balance = (code, free, locked) => ({ asset: { code }, free: { amount: free }, locked: { amount: locked } })
  const result = mapAccountSnapshotCapturedData({
    phase: "OPENING",
    snapshot: { sourceTime: 1730740000000, balances: [balance("USDT", "12.3400", "1.66"), balance("DOGE", "12321", "0"), balance("BNB", "0.2", "0.01")] },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.balances, [
    { asset: "BNB", free: "0.2", locked: "0.01", total: "0.21" },
    { asset: "DOGE", free: "12321", locked: "0", total: "12321" },
    { asset: "USDT", free: "12.3400", locked: "1.66", total: "14" },
  ])
  assert.equal(result.data.assetCount, 3)
  assert.equal(result.data.auditStatus, "COMPLETE")
})

test("rejects invalid account snapshot phase, decimals, duplicate assets and incomplete reasons", () => {
  const balance = { asset: { code: "USDT" }, free: { amount: "1" }, locked: { amount: "0" } }
  assert.equal(mapAccountSnapshotCapturedData({ phase: "MID", snapshot: { sourceTime: 1, balances: [balance] } }).ok, false)
  assert.equal(mapAccountSnapshotCapturedData({ phase: "OPENING", snapshot: { sourceTime: 1, balances: [{ ...balance, free: { amount: "NaN" } }] } }).ok, false)
  assert.equal(mapAccountSnapshotCapturedData({ phase: "CLOSING", auditStatus: "INCOMPLETE", snapshot: { sourceTime: 1, balances: [balance] } }).ok, false)
  assert.equal(mapAccountSnapshotCapturedData({ phase: "CLOSING", snapshot: { sourceTime: 1, balances: [balance, balance] } }).ok, false)
  assert.equal(mapAccountSnapshotCapturedData({ phase: "CLOSING", auditStatus: "INCOMPLETE", auditReasons: ["OPEN_ORDERS"], snapshot: { sourceTime: 1, balances: [balance] } }).ok, true)
})


test("maps complete account-wide open orders and blocks trading while any are unowned", () => {
  const order = {
    clientOrderId: "manual-order-1",
    id: "699694",
    symbol: "ZROUSDT",
    side: "SELL",
    type: "LIMIT",
    originalPrice: "1.82800000",
    originalQuantity: "4.98000000",
    executedQuantity: "0.00000000",
    status: "NEW",
  }
  const result = mapAccountOpenOrdersCapturedData({
    phase: "OPENING",
    observedAt: 1793830000000,
    orders: [order],
    readiness: "BLOCKED",
    blockReasons: ["UNOWNED_OPEN_ORDERS:1"],
  })
  assert.deepEqual(result, {
    ok: true,
    data: {
      phase: "OPENING",
      observedAt: 1793830000000,
      readiness: "BLOCKED",
      orderCount: 1,
      orders: [{
        clientOrderId: "manual-order-1",
        brokerOrderId: "699694",
        symbol: "ZROUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "1.82800000",
        quantity: "4.98000000",
        executedQuantity: "0.00000000",
        status: "NEW",
      }],
      blockReasons: ["UNOWNED_OPEN_ORDERS:1"],
    },
  })
  assert.equal(mapAccountOpenOrdersCapturedData({
    phase: "OPENING", observedAt: 1, orders: [], readiness: "READY",
  }).ok, true)
  assert.equal(mapAccountOpenOrdersCapturedData({
    phase: "OPENING", observedAt: 1, orders: [order], readiness: "READY",
  }).ok, false)
  assert.equal(mapAccountOpenOrdersCapturedData({
    phase: "OPENING", observedAt: 1, orders: [order], readiness: "RECONCILED",
  }).ok, true)
  assert.equal(mapAccountOpenOrdersCapturedData({
    phase: "OPENING", observedAt: 1, orders: [], readiness: "RECONCILED",
  }).ok, false)
})


test("maps versioned broker execution evidence and rejects untrusted payloads", () => {
  const result = mapBrokerExecutionReportData({ evidence: {
    schemaVersion: 1, source: "binance.spot.userData.executionReport",
    eventTime: 1730000000000, transactionTime: 1730000000001,
    symbol: "DOGEUSDT", clientOrderId: "h-DOGEUSDT-8", side: "SELL",
    executionType: "TRADE", orderStatus: "PARTIALLY_FILLED", orderId: 12345,
    orderQuantity: "10", lastExecutedQuantity: "4", cumulativeExecutedQuantity: "4",
    commissionAmount: "0.0006", commissionAsset: "USDT", tradeId: 98765,
    cumulativeQuoteQuantity: "0.6", isMaker: true, apiKey: "not-copied",
  } })
  assert.equal(result.ok, true)
  assert.equal(result.data.cumulativeQuoteQuantity, "0.6")
  assert.equal(result.data.commissionAmount, "0.0006")
  assert.equal(result.data.tradeId, "98765")
  assert.equal("apiKey" in result.data, false)
  assert.equal(mapBrokerExecutionReportData({ evidence: { schemaVersion: 1, source: "wrong" } }).ok, false)
  assert.equal(mapBrokerExecutionReportData({ evidence: {
    schemaVersion: 1, source: "binance.spot.userData.executionReport", orderQuantity: "NaN",
  } }).ok, false)
})

test("strategy decision event retains reason and exact decision inputs", () => {
  const result = mapStrategyDecisionData({
    strategy: "CONSERVATIVE", symbol: "DOGEUSDT", referencePrice: "100",
    reason: "INITIAL_BUY",
    inputs: {
      lastBuyPrice: null, activeOrderCount: 0, activeBuyCount: 0, activeSellCount: 0,
      activeBaseQuantity: "0", freeQuoteBalance: "1000", freeBaseBalance: "0",
      committedQuote: "0", committedBase: "0", outstandingRecoveryAmount: "0",
    },
    actions: [{ side: "BUY", type: "LIMIT_MAKER", price: "99.95", quantity: "1" }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.reason, "INITIAL_BUY")
  assert.equal(result.data.inputs.freeQuoteBalance, "1000")
})


test("retains a safe structured broker error code", () => {
  const result = mapBrokerConnectionFailedData({
    broker: "binance",
    error: Object.assign(new Error("order rejected"), { code: -1013 }),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.error, { name: "Error", message: "order rejected", code: -1013 })
})
