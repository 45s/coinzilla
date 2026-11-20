import { CanonicalOrder } from "@coinzilla/entities"
import { createOrderHistoryRecord } from "../domain/order-history/order-history-record.js"
import {
  createHistorySourceEvent,
  isArchivedOrderHistoryResult,
  requireNumericCursor,
  validateHistoryPage,
  waitBeforeHistoryRequest,
} from "./history-sync-support.js"

const DEFAULT_PAGE_SIZE = 1000
const DAY_MS = 24 * 60 * 60 * 1000
const INITIAL_ORDER_LOOKBACK_MS = 90 * DAY_MS
const ORDER_HISTORY_OVERLAP_MS = DAY_MS

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

async function fetchOrderWindow({
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

async function fetchCurrentOpenOrders({
  broker,
  symbol,
  repositories,
  providerIdentity,
  environment,
  requestDelayMs,
  sleep,
  now,
  state,
  orderState,
}) {
  await waitBeforeHistoryRequest({
    state,
    requestDelayMs,
    sleep,
  })
  const result = await broker.getOpenOrders({
    symbol,
  })
  state.requestCount += 1
  state.openOrderSnapshotsChecked += 1
  if (result?.ok !== true || !Array.isArray(result.data)) {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(
      `Unable to fetch Binance open orders for ${symbol}${details ? `: ${details}` : ""}`,
    )
  }
  const seenOrderIds = new Set()
  for (const openOrder of result.data) {
    if (openOrder?.symbol !== symbol || openOrder.id === undefined || openOrder.id === null) {
      throw new TypeError(`Binance open-orders response contains an invalid order for ${symbol}`)
    }
    const brokerOrderId = String(openOrder.id)
    requireNumericCursor({
      value: brokerOrderId,
      field: "open order ID",
      symbol,
    })
    if (seenOrderIds.has(brokerOrderId)) {
      throw new Error(`Binance open-orders response contains duplicate order ID ${brokerOrderId} for ${symbol}`)
    }
    seenOrderIds.add(brokerOrderId)
    state.openOrdersObserved += 1
    const lookup = await fetchAndPersistOrderByExchangeId({
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
    })
    if (lookup.order === null) {
      throw new Error(`Binance could not load canonical open order ${brokerOrderId} for ${symbol}`)
    }
  }
}

async function refreshStoredPendingOrders({
  broker,
  symbol,
  repositories,
  providerIdentity,
  environment,
  requestDelayMs,
  sleep,
  now,
  state,
  orderState,
}) {
  const pendingOrderIds = await repositories.orderRepository.listPendingOrderIds({
    providerIdentity,
    environment,
    symbol,
  })
  if (!Array.isArray(pendingOrderIds)) {
    throw new TypeError(`Pending Binance order lookup returned an invalid result for ${symbol}`)
  }
  const seenOrderIds = new Set()
  for (const brokerOrderId of pendingOrderIds) {
    requireNumericCursor({
      value: brokerOrderId,
      field: "pending order ID",
      symbol,
    })
    if (seenOrderIds.has(brokerOrderId)) {
      throw new Error(`Pending Binance order lookup returned duplicate order ID ${brokerOrderId} for ${symbol}`)
    }
    seenOrderIds.add(brokerOrderId)
    if (state.refreshedOrderIds.has(`${symbol}:${brokerOrderId}`)) {
      continue
    }
    const lookup = await fetchAndPersistOrderByExchangeId({
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
    })
    if (lookup.order === null && !lookup.unavailable) {
      throw new Error(`Binance could not refresh pending order ${brokerOrderId} for ${symbol}`)
    }
    if (lookup.unavailable) {
      state.pendingOrdersUnavailable += 1
    }
  }
}

async function saveOrderHistoryCursor({
  repositories,
  providerIdentity,
  environment,
  symbol,
  lastOrderId,
  lastOrderSyncAt,
  now,
}) {
  await repositories.cursorRepository.saveOrderCursor({
    providerIdentity,
    environment,
    symbol,
    lastOrderId: lastOrderId < 0 ? null : String(lastOrderId),
    lastOrderSyncAt: new Date(lastOrderSyncAt).toISOString(),
    updatedAt: new Date(now()).toISOString(),
  })
}

export async function synchronizeOrderHistoryForMarket({
  broker,
  symbol,
  repositories,
  providerIdentity,
  environment,
  limit = DEFAULT_PAGE_SIZE,
  requestDelayMs,
  sleep,
  now,
  state,
}) {
  const cursor = await repositories.cursorRepository.get({
    providerIdentity,
    environment,
    symbol,
  })
  const lastOrderId = cursor.lastOrderId === null || cursor.lastOrderId === undefined
    ? -1
    : requireNumericCursor({
        value: cursor.lastOrderId,
        field: "stored order ID",
        symbol,
      })
  if (lastOrderId >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Stored Binance order history cursor cannot advance for ${symbol}`)
  }
  const nowMs = now()
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("Account history clock must return a non-negative safe integer timestamp")
  }
  const previousSyncAt = parseOrderSyncCursor({
    value: cursor.lastOrderSyncAt,
    symbol,
  })
  const startTime = previousSyncAt === null
    ? Math.max(0, nowMs - INITIAL_ORDER_LOOKBACK_MS)
    : Math.max(0, previousSyncAt - ORDER_HISTORY_OVERLAP_MS)
  if (startTime > nowMs) {
    throw new RangeError(`Binance order-history time cursor is ahead of the local clock for ${symbol}`)
  }
  const orderState = {
    maxOrderId: lastOrderId,
  }
  await fetchCurrentOpenOrders({
    broker,
    symbol,
    repositories,
    providerIdentity,
    environment,
    requestDelayMs,
    sleep,
    now,
    state,
    orderState,
  })
  await refreshStoredPendingOrders({
    broker,
    symbol,
    repositories,
    providerIdentity,
    environment,
    requestDelayMs,
    sleep,
    now,
    state,
    orderState,
  })
  let windowStart = startTime
  while (windowStart <= nowMs) {
    const windowEnd = Math.min(windowStart + DAY_MS, nowMs)
    await fetchOrderWindow({
      broker,
      symbol,
      startTime: windowStart,
      endTime: windowEnd,
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
    windowStart = windowEnd + 1
  }
  await saveOrderHistoryCursor({
    repositories,
    providerIdentity,
    environment,
    symbol,
    lastOrderId: orderState.maxOrderId,
    lastOrderSyncAt: nowMs,
    now,
  })
}
