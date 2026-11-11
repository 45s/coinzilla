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
  mapMarketTradingRulesCapturedData,
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
  mapConfigValidatedData,
  mapHarvesterProcessStartedData,
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
  mapRecoveryCycleNotCompletedData,
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
    PROCESS_STARTED: "harvester.process_started",
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
    MARKET_TRADING_RULES_CAPTURED: "market.trading_rules_captured",
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
    RECOVERY_CYCLE_NOT_COMPLETED: "recovery.cycle_not_completed",
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
  const feeAsset = new Asset({ id: "asset:BNB", code: "BNB" })
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
    commissions: [
      new Commission({
        amount: new Money({ amount: "0.0005", asset: baseAsset }),
      }),
      new Commission({
        amount: new Money({ amount: "0.0001", asset: feeAsset }),
        quoteValue: new Money({ amount: "0.123456789012345678", asset: quoteAsset }),
      }),
    ],
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
      commissions: [
        {
          amount: "0.0005",
          assetId: "asset:DOGE",
          asset: "DOGE",
        },
        {
          amount: "0.0001",
          assetId: "asset:BNB",
          asset: "BNB",
          quoteValue: {
            amount: "0.123456789012345678",
            assetId: "asset:USDT",
            asset: "USDT",
          },
        },
      ],
      commissionStatus: "COMPLETE",
    },
  })
  assert.equal(mapFillAppliedData({ fill: {} }).ok, false)

  const missingThirdAssetValuation = mapFillAppliedData({
    fill: new Fill({
      tradeId: "trade-43",
      brokerOrderId: "broker-order-43",
      clientOrderId: "harvester-order-43",
      market,
      side: "BUY",
      price: new Money({ amount: "100", asset: quoteAsset }),
      quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
      quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
      liquidityRole: "MAKER",
      executedAt: 124,
      commissions: [new Commission({ amount: new Money({ amount: "0.0001", asset: feeAsset }) })],
      commissionStatus: "COMPLETE",
    }),
  })
  assert.equal(missingThirdAssetValuation.ok, false)
  assert.match(missingThirdAssetValuation.errors[0].message, /requires historical quote valuation/)

  const contradictoryAssetIdentity = mapFillAppliedData({
    fill: new Fill({
      tradeId: "trade-44",
      brokerOrderId: "broker-order-44",
      clientOrderId: "harvester-order-44",
      market,
      side: "BUY",
      price: new Money({ amount: "100", asset: quoteAsset }),
      quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
      quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
      liquidityRole: "MAKER",
      executedAt: 125,
      commissions: [new Commission({
        amount: new Money({ amount: "0.0001", asset: new Asset({ id: baseAsset.id, code: "WRONG" }) }),
        quoteValue: new Money({ amount: "0.01", asset: quoteAsset }),
      })],
      commissionStatus: "COMPLETE",
    }),
  })
  assert.equal(contradictoryAssetIdentity.ok, false)
  assert.match(contradictoryAssetIdentity.errors[0].message, /asset ID and code do not match/)

  const invalidQuoteValuation = (quoteValue) => mapFillAppliedData({
    fill: new Fill({
      tradeId: "trade-45",
      brokerOrderId: "broker-order-45",
      clientOrderId: "harvester-order-45",
      market,
      side: "BUY",
      price: new Money({ amount: "100", asset: quoteAsset }),
      quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
      quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
      liquidityRole: "MAKER",
      executedAt: 126,
      commissions: [new Commission({
        amount: new Money({ amount: "0.0001", asset: feeAsset }),
        quoteValue,
      })],
      commissionStatus: "COMPLETE",
    }),
  })
  assert.equal(invalidQuoteValuation(new Money({ amount: "0", asset: quoteAsset })).ok, false)
  assert.equal(invalidQuoteValuation(new Money({
    amount: "0.01",
    asset: new Asset({ id: "asset:USDC", code: "USDC" }),
  })).ok, false)

  const zeroThirdAssetFee = mapFillAppliedData({
    fill: new Fill({
      tradeId: "trade-46",
      brokerOrderId: "broker-order-46",
      clientOrderId: "harvester-order-46",
      market,
      side: "BUY",
      price: new Money({ amount: "100", asset: quoteAsset }),
      quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
      quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
      liquidityRole: "MAKER",
      executedAt: 127,
      commissions: [new Commission({ amount: new Money({ amount: "0", asset: feeAsset }) })],
      commissionStatus: "COMPLETE",
    }),
  })
  assert.equal(zeroThirdAssetFee.ok, true)
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


test("maps exact dust quantity and limiting filter into the durable completion event", () => {
  const result = mapRecoveryCycleCompletedData({
    symbol: "DOGEUSDT", marketId: "market:binance:DOGEUSDT", freeQuantity: "1.8", keepQuantity: "1", minProfit: "0.01", realizedNetProfit: "0.01",
    dust: { status: "EXCHANGE_CONSTRAINED_DUST", quantity: "0.8", reason: "MIN_NOTIONAL",
      minimumQuantity: "1", minimumNotional: "5", evaluatedQuantity: "1", evaluatedNotional: "0.07185" },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.dust, { status: "EXCHANGE_CONSTRAINED_DUST", quantity: "0.8", reason: "MIN_NOTIONAL",
    minimumQuantity: "1", minimumNotional: "5", evaluatedQuantity: "1", evaluatedNotional: "0.07185" })
})

test("maps quantity-step dust with its rounded candidate", () => {
  const result = mapRecoveryCycleCompletedData({
    symbol: "DOGEUSDT", marketId: "market:binance:DOGEUSDT", freeQuantity: "1.04", keepQuantity: "1", minProfit: "0.01", realizedNetProfit: "0.01",
    dust: { status: "EXCHANGE_CONSTRAINED_DUST", quantity: "0.04", reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.1", evaluatedQuantity: "0" },
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.dust.evaluatedQuantity, "0")
})

test("rejects a durable dust record without limiting-filter values", () => {
  const result = mapRecoveryCycleCompletedData({
    symbol: "DOGEUSDT", marketId: "market:binance:DOGEUSDT", freeQuantity: "1.8", keepQuantity: "1", minProfit: "0.01", realizedNetProfit: "0.01",
    dust: { status: "EXCHANGE_CONSTRAINED_DUST", quantity: "0.8", reason: "MIN_NOTIONAL" },
  })
  assert.equal(result.ok, false)
})

test("rejects completion events when retained quantity or profit proof is inconsistent", () => {
  const base = {
    symbol: "DOGEUSDT",
    marketId: "market:binance:DOGEUSDT",
    freeQuantity: "1.04",
    keepQuantity: "1",
    minProfit: "0.02",
    realizedNetProfit: "0.02",
    dust: { status: "EXCHANGE_CONSTRAINED_DUST", quantity: "0.04", reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.1", evaluatedQuantity: "0" },
  }
  assert.equal(mapRecoveryCycleCompletedData({ ...base, freeQuantity: "1.03" }).ok, false)
  assert.equal(mapRecoveryCycleCompletedData({ ...base, realizedNetProfit: "0.019" }).ok, false)
  assert.equal(mapRecoveryCycleCompletedData({ ...base, minProfit: "0.009" }).ok, false)
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
    keepQuantity: "0.1",
    minProfit: "0.01",
    realizedNetProfit: "1.2345",
    apiKey: "not-copied",
  }), {
    ok: true,
    data: {
      symbol: "DOGEUSDT",
      marketId: market.id,
      freeQuantity: "0.1",
      keepQuantity: "0.1",
      minProfit: "0.01",
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


test("maps complete account-wide open orders and classifies unowned orders without adopting them", () => {
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
    executionId: 987654, orderCreationTime: 1729999999000,
    orderQuantity: "10", lastExecutedQuantity: "4", cumulativeExecutedQuantity: "4",
    commissionAmount: "0.0006", commissionAsset: "USDT", tradeId: 98765,
    cumulativeQuoteQuantity: "0.6", isMaker: true, apiKey: "not-copied",
  } })
  assert.equal(result.ok, true)
  assert.equal(result.data.cumulativeQuoteQuantity, "0.6")
  assert.equal(result.data.commissionAmount, "0.0006")
  assert.equal(result.data.tradeId, "98765")
  assert.equal(result.data.executionId, "987654")
  assert.equal(result.data.orderCreationTime, 1729999999000)
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
      activeBaseQuantity: "0", activeBaseBalance: "0",
      freeQuoteBalance: "1000", freeBaseBalance: "0", quoteCashFlow: "0",
      committedQuote: "0", committedQuoteBalance: "0", committedBase: "0",
      committedBaseBalance: "0", outstandingRecoveryAmount: "0", investmentLimit: "1000",
      orderQuantity: "1", keepQuantity: "0.1", priceStepPercent: "0.05",
      makerPercent: "0", takerPercent: "0.075", minProfit: "0.01",
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


test("maps the exact validated exchange trading rules as a bounded plain DTO", () => {
  const result = mapMarketTradingRulesCapturedData({
    metadata: {
      market: {
        venue: "binance", symbol: "DOGEUSDT",
        baseAsset: { code: "DOGE" }, quoteAsset: { code: "USDT" },
      },
      orderType: "LIMIT_MAKER",
      supportedOrderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
      tradingRules: { constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.00001", asset: { code: "USDT" } } },
        { type: "MAX_NOTIONAL", status: "UNSUPPORTED" },
      ] },
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.constraints[0].amount, "0.00001")
  assert.equal(result.data.constraints[1].status, "UNSUPPORTED")
})


const validProcessIdentity = {
  application: "harvester",
  version: "1.0.001",
  runtimeSessionId: "runtime-session-123",
  processId: 12345,
  startedAt: "2026-11-09T10:15:30.000Z",
  source: {
    branch: "develop",
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shortCommit: "aaaaaaaa",
    commitMessage: "release",
    commitDate: "2026-11-09T09:00:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
  },
}

test("maps process-start identity to a sanitized allowlisted Journal DTO", () => {
  const result = mapHarvesterProcessStartedData({
    ...validProcessIdentity,
    source: {
      ...validProcessIdentity.source,
      commitMessage: 'release apiKey="private-value"',
      privateCredential: "must-not-be-copied",
    },
    apiSecret: "must-not-be-copied",
  })

  assert.deepEqual(result, {
    ok: true,
    data: {
      application: "harvester",
      version: "1.0.001",
      runtimeSessionId: "runtime-session-123",
      processId: 12345,
      startedAt: "2026-11-09T10:15:30.000Z",
      source: {
        branch: "develop",
        commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        shortCommit: "aaaaaaaa",
        commitMessage: "release apiKey=[REDACTED]",
        commitDate: "2026-11-09T09:00:00.000Z",
        workingTree: "clean",
        metadataSource: "git",
      },
    },
  }, "process-start evidence must preserve safe provenance fields and discard unapproved fields and embedded credentials")
})

test("keeps missing build provenance explicit and rejects malformed process identity", () => {
  const unavailableSource = {
    branch: null,
    commit: null,
    shortCommit: null,
    commitMessage: null,
    commitDate: null,
    workingTree: "unknown",
    metadataSource: "unavailable",
  }
  const unavailable = mapHarvesterProcessStartedData({
    ...validProcessIdentity,
    source: unavailableSource,
  })

  assert.equal(unavailable.ok, true, "a process-start event must remain valid when Git provenance is unavailable")
  assert.deepEqual(unavailable.data.source, unavailableSource, "unavailable provenance must be represented with explicit null and unknown values")
  assert.equal(mapHarvesterProcessStartedData({ ...validProcessIdentity, processId: "12345" }).ok, false, "process IDs must be numeric safe integers")
  assert.equal(mapHarvesterProcessStartedData({ ...validProcessIdentity, startedAt: "not-a-timestamp" }).ok, false, "process-start timestamps must be valid ISO date strings")
  assert.equal(mapHarvesterProcessStartedData({ ...validProcessIdentity, startedAt: "2026-11-09" }).ok, false, "process-start timestamps must be canonical UTC ISO values, not date-only strings")
  assert.equal(mapHarvesterProcessStartedData({ ...validProcessIdentity, source: { ...validProcessIdentity.source, commit: "not-a-sha" } }).ok, false, "Git commit identities must be validated before Journal publication")
  assert.equal(mapHarvesterProcessStartedData({ ...validProcessIdentity, source: { ...validProcessIdentity.source, metadataSource: "guessed" } }).ok, false, "provenance source must use one of the documented capture outcomes")
})


test("rejects lossy numeric timestamps at the Journal DTO boundary", () => {
  const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
  const makeOrder = (updatedAt) => new CanonicalOrder({
    clientOrderId: "harvester-client-timestamp",
    brokerOrderId: "broker-order-timestamp",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99.95", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt,
  })
  const makeFill = (executedAt) => new Fill({
    tradeId: "trade-timestamp",
    brokerOrderId: "broker-order-timestamp",
    clientOrderId: "harvester-client-timestamp",
    market,
    side: "BUY",
    price: new Money({ amount: "99.95", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "99.95", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt,
    commissions: [],
    commissionStatus: "COMPLETE",
  })

  const invalidTransactionTimes = [
    NaN,
    Infinity,
    -Infinity,
    -0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]

  for (const transactionTime of invalidTransactionTimes) {
    const result = mapOrderUpdatedData({
      order: makeOrder(0),
      evidence: { transactionTime },
    })
    assert.equal(
      result.ok,
      false,
      `broker transactionTime ${String(transactionTime)} must not be emitted as a Journal-bound numeric field.`,
    )
  }

  assert.equal(
    mapOrderUpdatedData({ order: makeOrder(-0) }).ok,
    false,
    "Canonical order updatedAt must reject negative zero even when the shared entity constructor accepts it.",
  )
  assert.equal(
    mapFillAppliedData({ fill: makeFill(-0) }).ok,
    false,
    "Canonical fill executedAt must reject negative zero before the fill DTO is published.",
  )

  for (const field of ["eventTime", "transactionTime", "orderCreationTime", "workingTime"]) {
    for (const value of invalidTransactionTimes) {
      const result = mapBrokerExecutionReportData({
        evidence: {
          schemaVersion: 1,
          source: "binance.spot.userData.executionReport",
          [field]: value,
        },
      })
      assert.equal(
        result.ok,
        false,
        `Broker execution-report ${field} must reject ${String(value)} before publication.`,
      )
    }
  }

  assert.equal(
    mapAccountSnapshotCapturedData({
      phase: "OPENING",
      snapshot: { sourceTime: -0, balances: [] },
    }).ok,
    false,
    "Account snapshot sourceTime must reject negative zero.",
  )
  assert.equal(
    mapAccountSnapshotCapturedData({
      phase: "OPENING",
      snapshot: { sourceTime: -1, balances: [] },
    }).ok,
    false,
    "Account snapshot sourceTime must reject negative timestamps.",
  )
  for (const invalidTimestamp of invalidTransactionTimes) {
    assert.equal(
      mapAccountSnapshotCapturedData({
        phase: "OPENING",
        snapshot: { sourceTime: invalidTimestamp, balances: [] },
      }).ok,
      false,
      `Account snapshot sourceTime must reject ${String(invalidTimestamp)}.`,
    )
    assert.equal(
      mapAccountOpenOrdersCapturedData({
        phase: "OPENING",
        observedAt: invalidTimestamp,
        orders: [],
        readiness: "READY",
      }).ok,
      false,
      `Account open-orders observedAt must reject ${String(invalidTimestamp)}.`,
    )
  }
})

test("preserves valid zero timestamps and omits negative-zero optional diagnostics", () => {
  const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
  const order = new CanonicalOrder({
    clientOrderId: "harvester-client-zero",
    brokerOrderId: "broker-order-zero",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99.95", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN",
    createdAt: 0,
    acknowledgedAt: 0,
    updatedAt: 0,
  })
  const orderResult = mapOrderUpdatedData({
    order,
    evidence: { transactionTime: 0 },
  })
  assert.equal(orderResult.ok, true, "Positive zero is a valid non-negative safe-integer timestamp.")
  assert.equal(orderResult.data.updatedAt, 0, "The valid order timestamp must remain zero.")
  assert.equal(orderResult.data.brokerTransactionTime, 0, "The valid broker transaction timestamp must remain zero.")

  assert.equal(
    mapAccountSnapshotCapturedData({
      phase: "OPENING",
      snapshot: { sourceTime: 0, balances: [] },
    }).ok,
    true,
    "Account snapshot sourceTime zero must remain valid.",
  )
  assert.equal(
    mapAccountOpenOrdersCapturedData({
      phase: "OPENING",
      observedAt: 0,
      orders: [],
      readiness: "READY",
    }).ok,
    true,
    "Account open-orders observedAt zero must remain valid.",
  )
  assert.equal(
    mapBrokerExecutionReportData({
      evidence: {
        schemaVersion: 1,
        source: "binance.spot.userData.executionReport",
        eventTime: 0,
        transactionTime: 0,
        orderCreationTime: 0,
        workingTime: 0,
      },
    }).ok,
    true,
    "Broker execution-report timestamps at zero must remain valid.",
  )
  assert.equal(
    mapBrokerStatusChangedData({
      broker: "binance",
      stream: "user-data",
      status: "CONNECTED",
      recoveryRequired: false,
      attempt: 0,
      code: 0,
    }).ok,
    true,
    "Valid zero attempt and status-code values must remain valid.",
  )
  const connectionFailure = mapBrokerConnectionFailedData({
    broker: "binance",
    error: Object.assign(new Error("offline"), { code: -0 }),
  })
  assert.equal(connectionFailure.ok, true, "An optional negative-zero error code must not invalidate the safe error DTO.")
  assert.equal(
    Object.hasOwn(connectionFailure.data.error, "code"),
    false,
    "A negative-zero optional error code must be omitted rather than serialized lossily.",
  )

  const decision = mapStrategyDecisionData({
    strategy: "CONSERVATIVE",
    symbol: "DOGEUSDT",
    referencePrice: "100",
    reason: "INITIAL_BUY",
    inputs: {
      activeOrderCount: -0,
      activeBaseQuantity: -0,
      activeBuyCount: 0,
      activeSellCount: 0,
      freeQuoteBalance: "1000",
    },
    actions: [{ side: "BUY", type: "LIMIT_MAKER", price: "99.95", quantity: "1" }],
  })
  assert.equal(decision.ok, true, "An optional negative-zero count must not invalidate the decision event.")
  assert.equal(
    Object.hasOwn(decision.data.inputs, "activeOrderCount"),
    false,
    "A negative-zero optional count must be omitted instead of reaching the Journal.",
  )
  assert.equal(
    Object.hasOwn(decision.data.inputs, "activeBaseQuantity"),
    false,
    "A negative-zero optional decimal input must be omitted instead of being coerced to the string zero.",
  )
  assert.equal(
    decision.data.inputs.activeBuyCount,
    0,
    "A valid zero count must remain present in the decision DTO.",
  )

  assert.equal(
    mapBrokerStatusChangedData({
      broker: "binance",
      stream: "user-data",
      status: "CONNECTED",
      recoveryRequired: false,
      attempt: -0,
    }).ok,
    false,
    "A negative-zero attempt count must be rejected.",
  )
  assert.equal(
    mapBrokerStatusChangedData({
      broker: "binance",
      stream: "user-data",
      status: "CONNECTED",
      recoveryRequired: false,
      code: -0,
    }).ok,
    false,
    "A negative-zero numeric status code must be rejected.",
  )
})

test("maps explicit residual sell-through and blocked recovery-cycle outcomes", () => {
  const base = {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    sellOrderClientId: "harvester-sell-1",
    sellOrderBrokerOrderId: "9002",
    realizedNetProfit: "-8.9",
    activeQuantity: "0.0996",
    keepQuantity: "0.01",
    minProfit: "0.01",
  }
  const continuing = mapRecoveryCycleNotCompletedData({
    ...base,
    outcome: "CONTINUE_SELL_THROUGH",
    reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
  })
  assert.equal(continuing.ok, true)
  assert.equal(continuing.data.outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(continuing.data.sellOrderClientId, "harvester-sell-1")

  const blocked = mapRecoveryCycleNotCompletedData({
    ...base,
    outcome: "BLOCKED",
    reason: "RECOVERY_SELL_FAILED_MIN_PROFIT",
  })
  assert.equal(blocked.ok, true)
  assert.equal(blocked.data.outcome, "BLOCKED")

  assert.equal(mapRecoveryCycleNotCompletedData({ ...base, outcome: "CONTINUE_SELL_THROUGH", reason: "RECOVERY_SELL_FAILED_MIN_PROFIT" }).ok, false)
  assert.equal(mapRecoveryCycleNotCompletedData({ ...base, outcome: "CONTINUE_SELL_THROUGH", reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY", activeQuantity: "0.01" }).ok, false)
  assert.equal(mapRecoveryCycleNotCompletedData({ ...base, outcome: "BLOCKED", reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH" }).ok, false)
})
