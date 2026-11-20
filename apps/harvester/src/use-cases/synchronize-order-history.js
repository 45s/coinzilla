import {
  DEFAULT_PAGE_SIZE,
  fetchAndPersistOrderByExchangeId,
  fetchOrderWindow,
  MAX_ORDER_HISTORY_WINDOW_MS,
} from "./synchronize-order-history-pages.js"
import {
  requireNumericCursor,
  waitBeforeHistoryRequest,
} from "./history-sync-support.js"

const INITIAL_ORDER_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000
const ORDER_HISTORY_OVERLAP_MS = 24 * 60 * 60 * 1000

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
    const windowEnd = Math.min(windowStart + MAX_ORDER_HISTORY_WINDOW_MS, nowMs)
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
