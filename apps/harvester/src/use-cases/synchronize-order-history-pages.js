import { CanonicalOrder } from "@coinzilla/entities"
import { createOrderHistoryRecord } from "../domain/order-history/order-history-record.js"
import {
  createHistorySourceEvent,
  isArchivedOrderHistoryResult,
  requireNumericCursor,
  validateHistoryPage,
  waitBeforeHistoryRequest,
} from "./history-sync-support.js"

export const DEFAULT_PAGE_SIZE = 1000
export const MAX_ORDER_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000

function createOrderIdentityKey({ order }) {
  return `${order.market.id}:${order.brokerOrderId}`
}

function validateCanonicalOrder({
  order,
  symbol,
  expectedOrderId,
  timeWindow,
  orderState,
  pageIdentities,
}) {
  if (!(order instanceof CanonicalOrder) || order.market.symbol !== symbol) {
    throw new TypeError(`Binance order history returned a non-canonical or wrong-market order for ${symbol}`)
  }
  const orderId = requireNumericCursor({
    value: order.brokerOrderId,
    field: "order ID",
    symbol,
  })
  if (expectedOrderId !== undefined && String(order.brokerOrderId) !== String(expectedOrderId)) {
    throw new Error(`Binance exact order-history lookup returned the wrong order for ${symbol}`)
  }
  if (!Number.isSafeInteger(order.updatedAt) || order.updatedAt < 0) {
    throw new TypeError(`Binance order history is missing a valid update timestamp for ${symbol}`)
  }
  if (timeWindow &&
      (!Number.isSafeInteger(order.createdAt) ||
        order.createdAt < timeWindow.startTime ||
        order.createdAt > timeWindow.endTime)) {
    throw new Error(`Binance order history returned an order outside its requested creation-time window for ${symbol}`)
  }
  const key = createOrderIdentityKey({
    order,
  })
  if (pageIdentities.has(key)) {
    throw new Error(`Binance order history contains duplicate order identity ${key}`)
  }
  pageIdentities.add(key)
  if (orderState) {
    orderState.maxOrderId = Math.max(orderState.maxOrderId, orderId)
  }
  return order
}

function mapCanonicalOrder({ order, providerIdentity, environment, observedAt }) {
  const updatedAt = order.updatedAt ?? order.createdAt ?? 0
  const eventId = [
    "exchange-history-order",
    providerIdentity.providerInstanceId,
    order.market.symbol,
    order.brokerOrderId,
    updatedAt,
    order.status,
    order.executedQuantity.amount,
  ].join(":")
  return createOrderHistoryRecord({
    order: {
      providerInstanceId: providerIdentity.providerInstanceId,
      providerType: providerIdentity.providerType,
      accountId: providerIdentity.accountId,
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      symbol: order.market.symbol,
      side: order.side,
      type: order.type,
      price: order.limitPrice?.amount,
      originalQuantity: order.originalQuantity.amount,
      executedQuantity: order.executedQuantity.amount,
      remainingQuantity: order.remainingQuantity.amount,
      status: order.status,
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: order.updatedAt,
      completedAt: order.completedAt,
    },
    sourceEvent: createHistorySourceEvent({
      id: eventId,
      name: "exchange.history_order_observed",
      observedAt,
    }),
    environment,
    includeUnfilled: true,
  })
}

async function persistCanonicalOrder({
  order,
  repositories,
  providerIdentity,
  environment,
  observedAt,
  state,
}) {
  const record = mapCanonicalOrder({
    order,
    providerIdentity,
    environment,
    observedAt,
  })
  if (record === null) {
    return
  }
  await repositories.orderRepository.upsertHistorical(record)
  state.ordersPersisted += 1
  state.ordersByBrokerId.set(createOrderIdentityKey({
    order,
  }), order.clientOrderId)
}

async function requestOrderPage({
  broker,
  symbol,
  query,
  limit,
  requestDelayMs,
  sleep,
  state,
}) {
  await waitBeforeHistoryRequest({
    state,
    requestDelayMs,
    sleep,
  })
  const result = await broker.getCanonicalOrderHistory({
    symbol,
    ...query,
    limit,
  })
  state.requestCount += 1
  state.orderPagesChecked += 1
  return result
}

function validateOrderPage({
  page,
  symbol,
  expectedOrderId,
  timeWindow,
  orderState,
  state,
}) {
  const pageIdentities = new Set()
  const orders = page.map((order) => validateCanonicalOrder({
    order,
    symbol,
    expectedOrderId,
    timeWindow,
    orderState,
    pageIdentities,
  }))
  state.ordersObserved += orders.length
  return orders
}

async function persistOrderPage({
  orders,
  repositories,
  providerIdentity,
  environment,
  now,
  state,
}) {
  for (const order of orders) {
    await persistCanonicalOrder({
      order,
      repositories,
      providerIdentity,
      environment,
      observedAt: new Date(now()).toISOString(),
      state,
    })
  }
}

function parseOrderSyncCursor({ value, symbol }) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string") {
    throw new TypeError(`Stored Binance order-history time cursor is invalid for ${symbol}`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`Stored Binance order-history time cursor is invalid for ${symbol}`)
  }
  return timestamp
}

export async function fetchOrderWindow({
  broker,
  symbol,
  startTime,
  endTime,
  repositories,
  providerIdentity,
  environment,
  limit,
  requestDelayMs,
  sleep,
  now,
  orderState,
  state,
}) {
  const page = await requestOrderPage({
    broker,
    symbol,
    query: {
      startTime,
      endTime,
    },
    limit,
    requestDelayMs,
    sleep,
    state,
  })
  const timeWindow = {
    startTime,
    endTime,
  }
  const orders = validateHistoryPage({
    result: page,
    symbol,
    limit,
    historyType: "order",
  })
  if (orders.length === limit) {
    if (startTime >= endTime) {
      throw new RangeError(
        `Binance order history cannot prove a complete page at millisecond resolution for ${symbol}`,
      )
    }
    const midpoint = Math.floor((startTime + endTime) / 2)
    await fetchOrderWindow({
      broker,
      symbol,
      startTime,
      endTime: midpoint,
      repositories,
      providerIdentity,
      environment,
      limit,
      requestDelayMs,
      sleep,
      now,
      orderState,
      state,
    })
    await fetchOrderWindow({
      broker,
      symbol,
      startTime: midpoint + 1,
      endTime,
      repositories,
      providerIdentity,
      environment,
      limit,
      requestDelayMs,
      sleep,
      now,
      orderState,
      state,
    })
    return
  }
  const validated = validateOrderPage({
    page: orders,
    symbol,
    timeWindow,
    orderState,
    state,
  })
  await persistOrderPage({
    orders: validated,
    repositories,
    providerIdentity,
    environment,
    now,
    state,
  })
}

export async function fetchAndPersistOrderByExchangeId({
  broker,
  symbol,
  brokerOrderId,
  repositories,
  providerIdentity,
  environment,
  requestDelayMs,
  sleep,
  now,
  state,
  orderState,
}) {
  const result = await requestOrderPage({
    broker,
    symbol,
    query: {
      orderId: brokerOrderId,
    },
    limit: 1,
    requestDelayMs,
    sleep,
    state,
  })
  if (isArchivedOrderHistoryResult({
    result,
  })) {
    state.archivedOrderLookups += 1
    state.refreshedOrderIds.add(`${symbol}:${brokerOrderId}`)
    return {
      order: null,
      unavailable: true,
    }
  }
  const page = validateHistoryPage({
    result,
    symbol,
    limit: 1,
    historyType: "order",
  })
  if (page.length === 0) {
    state.refreshedOrderIds.add(`${symbol}:${brokerOrderId}`)
    return {
      order: null,
      unavailable: false,
    }
  }
  const [order] = validateOrderPage({
    page,
    symbol,
    expectedOrderId: brokerOrderId,
    orderState,
    state,
  })
  await persistCanonicalOrder({
    order,
    repositories,
    providerIdentity,
    environment,
    observedAt: new Date(now()).toISOString(),
    state,
  })
  state.refreshedOrderIds.add(`${symbol}:${brokerOrderId}`)
  return {
    order,
    unavailable: false,
  }
}

