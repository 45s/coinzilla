import { CanonicalOrder } from "@coinzilla/entities"
import { requireNumericCursor, validatePage } from "./helpers/validate-input.js"
import {
  createOrderIdentityKey,
  mapCanonicalOrder,
  validateCanonicalOrderProviderIdentity,
} from "./helpers/map-history-records.js"
import { waitBeforeRequest } from "./wait-before-request.js"

function validateCanonicalOrder({ order, symbol, lastOrderId, state, providerIdentity }) {
  if (!(order instanceof CanonicalOrder) || order.market.symbol !== symbol || order.market.venue !== "binance") {
    throw new TypeError(`Binance order history returned a non-canonical or wrong-market order for ${symbol}`)
  }
  validateCanonicalOrderProviderIdentity({
    order,
    providerIdentity,
    symbol,
  })
  const orderId = requireNumericCursor({
    value: order.brokerOrderId,
    field: "order ID",
    symbol,
  })
  if (orderId <= lastOrderId) {
    throw new Error(`Binance order history cursor is not strictly increasing for ${symbol}`)
  }
  const key = createOrderIdentityKey({
    order,
  })
  if (state.orderIds.has(key)) {
    throw new Error(`Binance order history contains duplicate order identity ${key}`)
  }
  state.orderIds.add(key)
  state.ordersByBrokerId.set(key, order.clientOrderId)
  return orderId
}

async function persistCanonicalOrder({ order, repositories, providerIdentity, environment, observedAt, state }) {
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
  state.lastPersistedOrderId = order.brokerOrderId
}

async function resolveOrderHistoryCursor({ repositories, providerIdentity, environment, symbol, state }) {
  state.currentHistoryType = "orders"
  state.currentOperation = "ORDER_CURSOR_READ"
  state.currentPageCursor = null
  state.currentRecordIndex = null
  state.currentBrokerOrderId = null
  state.currentClientOrderId = null
  state.currentTradeId = null
  const cursor = await repositories.cursorRepository.get({
    providerIdentity,
    environment,
    symbol,
  })
  const storedOrderId = cursor.lastOrderId === null || cursor.lastOrderId === undefined
    ? -1
    : requireNumericCursor({
        value: cursor.lastOrderId,
        field: "stored order ID",
        symbol,
      })
  if (storedOrderId >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Stored Binance order history cursor cannot advance for ${symbol}`)
  }
  const oldestPendingOrderId = await repositories.orderRepository.getOldestPendingOrderId({
    providerIdentity,
    environment,
    symbol,
  })
  const pendingOrderCursor = oldestPendingOrderId === null
    ? storedOrderId + 1
    : requireNumericCursor({
        value: oldestPendingOrderId,
        field: "pending order ID",
        symbol,
      })
  const orderId = Math.min(storedOrderId + 1, pendingOrderCursor)
  return {
    orderId,
    lastOrderId: orderId - 1,
  }
}

async function requestOrderPage({ broker, symbol, orderId, limit, requestDelayMs, sleep, state }) {
  state.currentHistoryType = "orders"
  state.currentOperation = "ORDER_PAGE_FETCH"
  state.currentPageCursor = String(orderId)
  state.currentRecordIndex = null
  state.currentBrokerOrderId = null
  state.currentClientOrderId = null
  state.currentTradeId = null
  await waitBeforeRequest({
    state,
    requestDelayMs,
    sleep,
  })
  state.requestCount += 1
  state.orderPagesChecked += 1
  const result = await broker.getCanonicalOrderHistory({
    symbol,
    orderId,
    limit,
    includeFollowingOrders: true,
  })
  return validatePage({
    result,
    symbol,
    limit,
    historyType: "order",
  })
}

function validateOrderPage({ page, symbol, lastOrderId, state, providerIdentity }) {
  state.currentOperation = "ORDER_PAGE_VALIDATE"
  state.ordersObserved += page.length
  let nextOrderId = lastOrderId
  const orders = []
  for (const [index, order] of page.entries()) {
    state.currentRecordIndex = index + 1
    state.currentBrokerOrderId = typeof order?.brokerOrderId === "string" ? order.brokerOrderId : null
    state.currentClientOrderId = typeof order?.clientOrderId === "string" ? order.clientOrderId : null
    state.currentTradeId = null
    nextOrderId = validateCanonicalOrder({
      order,
      symbol,
      lastOrderId: nextOrderId,
      state,
      providerIdentity,
    })
    orders.push(order)
  }
  return {
    orders,
    lastOrderId: nextOrderId,
  }
}

async function persistOrderPage({ orders, repositories, providerIdentity, environment, now, state }) {
  for (const [index, order] of orders.entries()) {
    state.currentOperation = "ORDER_RECORD_PERSIST"
    state.currentRecordIndex = index + 1
    state.currentBrokerOrderId = order.brokerOrderId
    state.currentClientOrderId = order.clientOrderId
    state.currentTradeId = null
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

async function saveOrderPageCursor({
  page,
  lastOrderId,
  repositories,
  providerIdentity,
  environment,
  symbol,
  now,
}) {
  if (page.length === 0) {
    return
  }
  await repositories.cursorRepository.saveOrderCursor({
    providerIdentity,
    environment,
    symbol,
    lastOrderId: String(lastOrderId),
    updatedAt: new Date(now()).toISOString(),
  })
}

async function persistAndAdvanceOrderPage({
  page,
  validated,
  repositories,
  providerIdentity,
  environment,
  symbol,
  now,
  state,
}) {
  await persistOrderPage({
    orders: validated.orders,
    repositories,
    providerIdentity,
    environment,
    now,
    state,
  })
  const { lastOrderId } = validated
  state.currentOperation = "ORDER_CURSOR_SAVE"
  state.currentRecordIndex = null
  state.currentBrokerOrderId = null
  state.currentClientOrderId = null
  state.currentTradeId = null
  await saveOrderPageCursor({
    page,
    lastOrderId,
    repositories,
    providerIdentity,
    environment,
    symbol,
    now,
  })
  return lastOrderId
}

async function fetchOrderHistoryForMarket({
  broker,
  symbol,
  repositories,
  providerIdentity,
  environment,
  limit,
  requestDelayMs,
  sleep,
  now,
  state,
}) {
  let { orderId, lastOrderId } = await resolveOrderHistoryCursor({
    repositories,
    providerIdentity,
    environment,
    symbol,
    state,
  })
  while (true) {
    const page = await requestOrderPage({
      broker,
      symbol,
      orderId,
      limit,
      requestDelayMs,
      sleep,
      state,
    })
    const validated = validateOrderPage({
      page,
      symbol,
      lastOrderId,
      state,
      providerIdentity,
    })
    lastOrderId = await persistAndAdvanceOrderPage({
      page,
      validated,
      repositories,
      providerIdentity,
      environment,
      symbol,
      now,
      state,
    })
    if (page.length < limit) {
      return
    }
    if (lastOrderId >= Number.MAX_SAFE_INTEGER) {
      state.currentOperation = "ORDER_CURSOR_ADVANCE"
      throw new RangeError(`Binance order history cannot advance its cursor for ${symbol}`)
    }
    orderId = lastOrderId + 1
  }
}


export { fetchOrderHistoryForMarket }
