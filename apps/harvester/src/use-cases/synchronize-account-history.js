import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { createOrderHistoryRecord } from "../domain/order-history/order-history-record.js"

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_REQUEST_DELAY_MS = 200
const HISTORY_SOURCE = "binance.exchange-history"

const defaultSleep = ({ durationMs }) => new Promise((resolve) => {
  setTimeout(resolve, durationMs)
})

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`Account history ${field} must be a stable provider identifier`)
  }
  return value
}

function validateBroker({ broker } = {}) {
  if (typeof broker?.getCanonicalOrderHistory !== "function" ||
      typeof broker?.getFills !== "function") {
    throw new TypeError("Account history synchronization requires canonical order and fill history methods")
  }
}

function validateSymbols({ symbols } = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0 ||
      symbols.some((symbol) => typeof symbol !== "string" || !symbol.trim())) {
    throw new TypeError("Account history synchronization requires configured market symbols")
  }
  if (new Set(symbols).size !== symbols.length) {
    throw new Error("Account history synchronization symbols must be unique")
  }
}

function validateProviderIdentity({ providerIdentity } = {}) {
  if (providerIdentity?.providerType !== "binance") {
    throw new TypeError("Account history synchronization currently supports Binance only")
  }
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    requireIdentifier({
      value: providerIdentity[field],
      field,
    })
  }
}

function hasOrderRepository({ orderRepository } = {}) {
  return typeof orderRepository?.upsertHistorical === "function" &&
    typeof orderRepository?.findByExchangeOrderIdentity === "function" &&
    typeof orderRepository?.getOldestPendingOrderId === "function"
}

function hasFillRepository({ fillRepository } = {}) {
  return typeof fillRepository?.upsert === "function"
}

function hasCursorRepository({ cursorRepository } = {}) {
  return typeof cursorRepository?.get === "function" &&
    typeof cursorRepository?.saveOrderCursor === "function" &&
    typeof cursorRepository?.saveTradeCursor === "function"
}

function validateRepositories(input) {
  if (!hasOrderRepository(input) || !hasFillRepository(input) || !hasCursorRepository(input)) {
    throw new TypeError("Account history synchronization requires relational history and cursor repositories")
  }
}

function validatePagination({ limit, requestDelayMs, sleep, now } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_PAGE_SIZE) {
    throw new TypeError("Account history page size must be between 1 and 1000")
  }
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0) {
    throw new TypeError("Account history request delay must be a non-negative safe integer")
  }
  if (typeof sleep !== "function" || typeof now !== "function") {
    throw new TypeError("Account history synchronization requires sleep and clock functions")
  }
}

function validateOptions(input) {
  validateBroker(input)
  validateSymbols(input)
  validateProviderIdentity(input)
  if (!["testnet", "live"].includes(input.environment)) {
    throw new TypeError("Account history synchronization environment must be testnet or live")
  }
  validateRepositories(input)
  validatePagination(input)
}

function requireNumericCursor({ value, field, symbol }) {
  const text = String(value)
  if (!/^\d+$/.test(text)) {
    throw new TypeError(`Binance ${field} is invalid for ${symbol}`)
  }
  const cursor = Number(text)
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new RangeError(`Binance ${field} exceeds the safe pagination range for ${symbol}`)
  }
  return cursor
}

function validatePage({ result, symbol, limit, historyType }) {
  if (result?.ok !== true || !Array.isArray(result.data)) {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(
      `Unable to fetch Binance ${historyType} history for ${symbol}${details ? `: ${details}` : ""}`,
    )
  }
  if (result.data.length > limit) {
    throw new Error(`Binance ${historyType} history exceeded the requested page size for ${symbol}`)
  }
  return result.data
}

async function waitBeforeRequest({ state, requestDelayMs, sleep }) {
  if (state.requestCount > 0 && requestDelayMs > 0) {
    await sleep({
      durationMs: requestDelayMs,
    })
  }
}

function createSourceEvent({ id, name, observedAt }) {
  return {
    id,
    name,
    source: HISTORY_SOURCE,
    timestamp: observedAt,
  }
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
    sourceEvent: createSourceEvent({
      id: eventId,
      name: "exchange.history_order_observed",
      observedAt,
    }),
    environment,
    includeUnfilled: true,
  })
}

function createOrderIdentityKey({ order }) {
  return `${order.market.id}:${order.brokerOrderId}`
}

function validateCanonicalOrder({ order, symbol, lastOrderId, state }) {
  if (!(order instanceof CanonicalOrder) || order.market.symbol !== symbol) {
    throw new TypeError(`Binance order history returned a non-canonical or wrong-market order for ${symbol}`)
  }
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
}

async function resolveOrderHistoryCursor({ repositories, providerIdentity, environment, symbol }) {
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
  await waitBeforeRequest({
    state,
    requestDelayMs,
    sleep,
  })
  const result = await broker.getCanonicalOrderHistory({
    symbol,
    orderId,
    limit,
  })
  state.requestCount += 1
  state.orderPagesChecked += 1
  return validatePage({
    result,
    symbol,
    limit,
    historyType: "order",
  })
}

function validateOrderPage({ page, symbol, lastOrderId, state }) {
  let nextOrderId = lastOrderId
  const orders = page.map((order) => {
    nextOrderId = validateCanonicalOrder({
      order,
      symbol,
      lastOrderId: nextOrderId,
      state,
    })
    return order
  })
  state.ordersObserved += orders.length
  return {
    orders,
    lastOrderId: nextOrderId,
  }
}

async function persistOrderPage({ orders, repositories, providerIdentity, environment, now, state }) {
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
  })
  while (true) {
    const page = await requestOrderPage({ broker, symbol, orderId, limit, requestDelayMs, sleep, state })
    const validated = validateOrderPage({ page, symbol, lastOrderId, state })
    await persistOrderPage({
      orders: validated.orders,
      repositories,
      providerIdentity,
      environment,
      now,
      state,
    })
    ({ lastOrderId } = validated)
    await saveOrderPageCursor({
      page,
      lastOrderId,
      repositories,
      providerIdentity,
      environment,
      symbol,
      now,
    })
    if (page.length < limit) {
      return
    }
    if (lastOrderId >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`Binance order history cannot advance its cursor for ${symbol}`)
    }
    orderId = lastOrderId + 1
  }
}

function createEnrichedFill({ fill, clientOrderId, providerIdentity }) {
  if (
    fill.providerInstanceId !== undefined &&
    (fill.providerInstanceId !== providerIdentity.providerInstanceId ||
      fill.providerType !== providerIdentity.providerType ||
      fill.accountId !== providerIdentity.accountId)
  ) {
    throw new Error(`Binance fill provider identity conflicts for ${fill.market.symbol}:${fill.tradeId}`)
  }
  if (fill.clientOrderId !== undefined && clientOrderId !== undefined &&
      fill.clientOrderId !== clientOrderId) {
    throw new Error(`Binance fill client-order identity conflicts for ${fill.market.symbol}:${fill.tradeId}`)
  }
  return new Fill({
    tradeId: fill.tradeId,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId ?? clientOrderId,
    ...providerIdentity,
    market: fill.market,
    side: fill.side,
    price: fill.price,
    quantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    liquidityRole: fill.liquidityRole,
    executedAt: fill.executedAt,
    commissions: fill.commissions,
    commissionStatus: fill.commissionStatus,
  })
}

function mapCanonicalFill({ fill }) {
  return {
    fillId: fill.id,
    tradeId: fill.tradeId,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId,
    providerInstanceId: fill.providerInstanceId,
    providerType: fill.providerType,
    accountId: fill.accountId,
    symbol: fill.market.symbol,
    side: fill.side,
    price: fill.price.amount,
    quantity: fill.quantity.amount,
    quoteQuantity: fill.quoteQuantity.amount,
    liquidityRole: fill.liquidityRole,
    commissionStatus: fill.commissionStatus,
    executedAt: fill.executedAt,
    commissions: fill.commissions.map((commission) => ({
      amount: commission.amount.amount,
      assetId: commission.amount.asset.id,
      asset: commission.amount.asset.code,
      quoteValue: commission.quoteValue
        ? {
            amount: commission.quoteValue.amount,
            assetId: commission.quoteValue.asset.id,
            asset: commission.quoteValue.asset.code,
          }
        : null,
    })),
  }
}

function validateCanonicalFill({ fill, symbol, lastTradeId, state }) {
  if (!(fill instanceof Fill) || fill.market.symbol !== symbol) {
    throw new TypeError(`Binance trade history returned a non-canonical or wrong-market fill for ${symbol}`)
  }
  const tradeId = requireNumericCursor({
    value: fill.tradeId,
    field: "trade ID",
    symbol,
  })
  if (tradeId <= lastTradeId) {
    throw new Error(`Binance trade history cursor is not strictly increasing for ${symbol}`)
  }
  if (!Number.isSafeInteger(fill.executedAt) || fill.executedAt < 0) {
    throw new TypeError(`Binance trade history is missing a valid execution timestamp for ${symbol}`)
  }
  const key = `${fill.market.id}:${fill.tradeId}`
  if (state.fillIds.has(key)) {
    throw new Error(`Binance trade history contains duplicate execution identity ${key}`)
  }
  state.fillIds.add(key)
  return tradeId
}

async function persistCanonicalFill({ fill, repositories, providerIdentity, environment, observedAt, state }) {
  const orderKey = `${fill.market.id}:${fill.brokerOrderId}`
  let clientOrderId = state.ordersByBrokerId.get(orderKey)
  if (clientOrderId === undefined) {
    clientOrderId = await repositories.orderRepository.findByExchangeOrderIdentity({
      providerIdentity,
      environment,
      marketId: fill.market.id,
      brokerOrderId: fill.brokerOrderId,
    })
  }
  const enrichedFill = createEnrichedFill({
    fill,
    clientOrderId,
    providerIdentity,
  })
  const sourceEvent = createSourceEvent({
    id: `exchange-history-fill:${providerIdentity.providerInstanceId}:${enrichedFill.market.id}:${enrichedFill.tradeId}`,
    name: "execution.fill_history_reconciled",
    observedAt,
  })
  await repositories.fillRepository.upsert({
    fill: mapCanonicalFill({
      fill: enrichedFill,
    }),
    sourceEvent,
    environment,
    ingestionSource: "exchange_history",
  })
  state.fillsPersisted += 1
}

async function resolveTradeHistoryCursor({ repositories, providerIdentity, environment, symbol }) {
  const cursor = await repositories.cursorRepository.get({
    providerIdentity,
    environment,
    symbol,
  })
  const lastTradeId = cursor.lastTradeId === null || cursor.lastTradeId === undefined
    ? -1
    : requireNumericCursor({
        value: cursor.lastTradeId,
        field: "stored trade ID",
        symbol,
      })
  if (lastTradeId >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Stored Binance trade history cursor cannot advance for ${symbol}`)
  }
  return {
    fromId: lastTradeId + 1,
    lastTradeId,
  }
}

async function requestFillPage({ broker, symbol, fromId, limit, requestDelayMs, sleep, state }) {
  await waitBeforeRequest({
    state,
    requestDelayMs,
    sleep,
  })
  const result = await broker.getFills({
    symbol,
    fromId,
    limit,
  })
  state.requestCount += 1
  state.fillPagesChecked += 1
  return validatePage({
    result,
    symbol,
    limit,
    historyType: "trade",
  })
}

function validateFillPage({ page, symbol, lastTradeId, state }) {
  let nextTradeId = lastTradeId
  const fills = page.map((fill) => {
    nextTradeId = validateCanonicalFill({
      fill,
      symbol,
      lastTradeId: nextTradeId,
      state,
    })
    return fill
  })
  state.fillsObserved += fills.length
  return {
    fills,
    lastTradeId: nextTradeId,
  }
}

async function persistFillPage({ fills, repositories, providerIdentity, environment, now, state }) {
  for (const fill of fills) {
    await persistCanonicalFill({
      fill,
      repositories,
      providerIdentity,
      environment,
      observedAt: new Date(now()).toISOString(),
      state,
    })
  }
}

async function saveTradePageCursor({
  page,
  lastTradeId,
  repositories,
  providerIdentity,
  environment,
  symbol,
  now,
}) {
  if (page.length === 0) {
    return
  }
  await repositories.cursorRepository.saveTradeCursor({
    providerIdentity,
    environment,
    symbol,
    lastTradeId: String(lastTradeId),
    updatedAt: new Date(now()).toISOString(),
  })
}

async function fetchFillHistoryForMarket({
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
  let { fromId, lastTradeId } = await resolveTradeHistoryCursor({
    repositories,
    providerIdentity,
    environment,
    symbol,
  })
  while (true) {
    const page = await requestFillPage({ broker, symbol, fromId, limit, requestDelayMs, sleep, state })
    const validated = validateFillPage({ page, symbol, lastTradeId, state })
    await persistFillPage({
      fills: validated.fills,
      repositories,
      providerIdentity,
      environment,
      now,
      state,
    })
    ({ lastTradeId } = validated)
    await saveTradePageCursor({
      page,
      lastTradeId,
      repositories,
      providerIdentity,
      environment,
      symbol,
      now,
    })
    if (page.length < limit) {
      return
    }
    if (lastTradeId >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`Binance trade history cannot advance its cursor for ${symbol}`)
    }
    fromId = lastTradeId + 1
  }
}

async function synchronizeMarkets({ input, state }) {
  for (const symbol of input.symbols) {
    state.currentMarket = symbol
    state.marketsAttempted.push(symbol)
    await fetchOrderHistoryForMarket({
      ...input,
      symbol,
      state,
    })
    await fetchFillHistoryForMarket({
      ...input,
      symbol,
      state,
    })
    state.marketsQueried.push(symbol)
    state.currentMarket = null
  }
}

function createInitialState() {
  return {
    requestCount: 0,
    orderPagesChecked: 0,
    fillPagesChecked: 0,
    ordersObserved: 0,
    ordersPersisted: 0,
    fillsObserved: 0,
    fillsPersisted: 0,
    marketsAttempted: [],
    marketsQueried: [],
    currentMarket: null,
    orderIds: new Set(),
    fillIds: new Set(),
    ordersByBrokerId: new Map(),
  }
}

/**
 * Synchronize all exchange-available order and trade history for the supplied
 * Binance markets. The result never certifies the historical market universe
 * or the exchange's retention horizon.
 */
function createHistoryDiagnostics({ state, historyPagesComplete, errorMessage } = {}) {
  return Object.freeze({
    historyScope: "CONFIGURED_MARKETS",
    marketsAttempted: Object.freeze([...state.marketsAttempted]),
    marketsQueried: Object.freeze([...state.marketsQueried]),
    currentMarket: state.currentMarket,
    orderPagesChecked: state.orderPagesChecked,
    fillPagesChecked: state.fillPagesChecked,
    ordersObserved: state.ordersObserved,
    ordersPersisted: state.ordersPersisted,
    fillsObserved: state.fillsObserved,
    fillsPersisted: state.fillsPersisted,
    requestCount: state.requestCount,
    historyPagesComplete,
    marketHistoryPagesComplete: historyPagesComplete,
    marketUniverseComplete: false,
    retentionCoverageConfirmed: false,
    complete: false,
    errorMessage,
  })
}

export async function synchronizeAccountHistory({
  broker,
  symbols,
  providerIdentity,
  environment,
  orderRepository,
  fillRepository,
  cursorRepository,
  limit = DEFAULT_PAGE_SIZE,
  requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  const state = createInitialState()
  try {
    const input = {
      broker,
      symbols,
      providerIdentity,
      environment,
      orderRepository,
      fillRepository,
      cursorRepository,
      limit,
      requestDelayMs,
      sleep,
      now,
    }
    validateOptions(input)
    await synchronizeMarkets({
      input: {
        ...input,
        repositories: {
          orderRepository,
          fillRepository,
          cursorRepository,
        },
      },
      state,
    })
    return toResult({
      data: createHistoryDiagnostics({
        state,
        historyPagesComplete: true,
      }),
    })
  } catch (error) {
    const failure = error instanceof Error
      ? error
      : new Error(String(error))
    failure.historyDiagnostics = createHistoryDiagnostics({
      state,
      historyPagesComplete: false,
      errorMessage: failure.message,
    })
    return toResult({
      error: failure,
    })
  }
}
