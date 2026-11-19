export const ORDER_HISTORY_MARKET = Object.freeze({
  id: "binance:BTCUSDT",
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: Object.freeze({
    id: "asset:BTC",
    code: "BTC",
  }),
  quoteAsset: Object.freeze({
    id: "asset:USDT",
    code: "USDT",
  }),
})

export function createOrderHistoryEventData(overrides = {}) {
  return {
    clientOrderId: "harvester-BTCUSDT-001",
    brokerOrderId: "broker-order-001",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    market: ORDER_HISTORY_MARKET,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "65000.0000",
    quantity: "1.0000",
    originalQuantity: "1.0000",
    executedQuantity: "0.2500",
    remainingQuantity: "0.7500",
    status: "PARTIALLY_FILLED",
    ownership: {
      strategyId: "CG_coinGrabber",
      positionId: "position-001",
      purpose: "INITIAL_BUY",
      cycleId: "cycle-001",
    },
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    cumulativeQuoteQuantity: "16250.000000",
    brokerTransactionTime: 102,
    executionType: "TRADE",
    ...overrides,
  }
}

export function createOrderHistoryEvent({
  name = "order.updated",
  dataOverrides = {},
  id = "event-001",
  timestamp = "2026-11-19T00:00:00.000Z",
} = {}) {
  return {
    id,
    timestamp,
    name,
    source: "harvester",
    data: createOrderHistoryEventData(dataOverrides),
  }
}

export function createOrderHistoryRecordFixture(overrides = {}) {
  const {
    id: explicitId,
    environment = "testnet",
    firstSeenAt = "2026-11-19T00:00:00.000Z",
    lastSeenAt = firstSeenAt,
    firstSourceEventId = "event-001",
    lastSourceEventId = firstSourceEventId,
    lastSourceEventName = "order.updated",
    lastSourceEventSource = "harvester",
    lastSourceEventTimestamp = lastSeenAt,
    lastExecutionType = "TRADE",
    ...order
  } = overrides
  const id = explicitId ?? JSON.stringify([
    environment,
    order.providerInstanceId ?? "binanceTestnet",
    order.providerType ?? "binance",
    order.accountId ?? "binance-primary",
    order.clientOrderId ?? "harvester-BTCUSDT-001",
  ])
  return {
    id,
    schemaVersion: 1,
    recordKind: "harvester.order-history",
    environment,
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    clientOrderId: "harvester-BTCUSDT-001",
    brokerOrderId: "broker-order-001",
    market: ORDER_HISTORY_MARKET,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "65000.0000",
    originalQuantity: "1.0000",
    executedQuantity: "0.2500",
    remainingQuantity: "0.7500",
    status: "PARTIALLY_FILLED",
    ownership: {
      strategyId: "CG_coinGrabber",
      positionId: "position-001",
      purpose: "INITIAL_BUY",
      cycleId: "cycle-001",
    },
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    cumulativeQuoteQuantity: "16250.000000",
    brokerTransactionTime: 102,
    firstSeenAt,
    lastSeenAt,
    firstSourceEventId,
    lastSourceEventId,
    lastSourceEventName,
    lastSourceEventSource,
    lastSourceEventTimestamp,
    lastExecutionType,
    ...order,
  }
}
