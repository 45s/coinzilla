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

function validateOptions({
  broker,
  symbols,
  providerIdentity,
  environment,
  orderRepository,
  fillRepository,
  limit,
  requestDelayMs,
  sleep,
  now,
}) {
  if (typeof broker?.getCanonicalOrderHistory !== "function" ||
      typeof broker?.getFills !== "function") {
    throw new TypeError("Account history synchronization requires canonical order and fill history methods")
  }
  if (!Array.isArray(symbols) || symbols.length === 0 ||
      symbols.some((symbol) => typeof symbol !== "string" || !symbol.trim())) {
    throw new TypeError("Account history synchronization requires configured market symbols")
  }
  if (new Set(symbols).size !== symbols.length) {
    throw new Error("Account history synchronization symbols must be unique")
  }
  if (providerIdentity?.providerType !== "binance") {
    throw new TypeError("Account history synchronization currently supports Binance only")
  }
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    requireIdentifier({
      value: providerIdentity[field],
      field,
    })
  }
  if (!["testnet", "live"].includes(environment)) {
    throw new TypeError("Account history synchronization environment must be testnet or live")
  }
  if (typeof orderRepository?.upsertHistorical !== "function" ||
      typeof fillRepository?.upsert !== "function") {
    throw new TypeError("Account history synchronization requires relational order and fill repositories")
  }
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
  if (order.executedQuantity.amount === "0") {
    return
  }
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
  let orderId = 0
  let lastOrderId = -1
  while (true) {
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
    const page = validatePage({
      result,
      symbol,
      limit,
      historyType: "order",
    })
    for (const order of page) {
      lastOrderId = validateCanonicalOrder({
        order,
        symbol,
        lastOrderId,
        state,
      })
      state.ordersObserved += 1
      await persistCanonicalOrder({
        order,
        repositories,
        providerIdentity,
        environment,
        observedAt: new Date(now()).toISOString(),
        state,
      })
    }
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
  const clientOrderId = state.ordersByBrokerId.get(orderKey)
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
  let fromId = 0
  let lastTradeId = -1
  while (true) {
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
    const page = validatePage({
      result,
      symbol,
      limit,
      historyType: "trade",
    })
    for (const fill of page) {
      lastTradeId = validateCanonicalFill({
        fill,
        symbol,
        lastTradeId,
        state,
      })
      state.fillsObserved += 1
      await persistCanonicalFill({
        fill,
        repositories,
        providerIdentity,
        environment,
        observedAt: new Date(now()).toISOString(),
        state,
      })
    }
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
    marketsQueried: [],
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
export async function synchronizeAccountHistory({
  broker,
  symbols,
  providerIdentity,
  environment,
  orderRepository,
  fillRepository,
  limit = DEFAULT_PAGE_SIZE,
  requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  try {
    const input = {
      broker,
      symbols,
      providerIdentity,
      environment,
      orderRepository,
      fillRepository,
      limit,
      requestDelayMs,
      sleep,
      now,
    }
    validateOptions(input)
    const state = createInitialState()
    await synchronizeMarkets({
      input: {
        ...input,
        repositories: {
          orderRepository,
          fillRepository,
        },
      },
      state,
    })
    return toResult({
      data: Object.freeze({
        historyScope: "CONFIGURED_MARKETS",
        marketsQueried: Object.freeze(state.marketsQueried),
        orderPagesChecked: state.orderPagesChecked,
        fillPagesChecked: state.fillPagesChecked,
        ordersObserved: state.ordersObserved,
        ordersPersisted: state.ordersPersisted,
        fillsObserved: state.fillsObserved,
        fillsPersisted: state.fillsPersisted,
        requestCount: state.requestCount,
        historyPagesComplete: true,
        marketHistoryPagesComplete: true,
        marketUniverseComplete: false,
        retentionCoverageConfirmed: false,
        complete: false,
      }),
    })
  } catch (error) {
    return toResult({
      error,
    })
  }
}
