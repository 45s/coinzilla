import { Fill } from "@coinzilla/entities"
import { fetchAndPersistOrderByExchangeId } from "./synchronize-order-history.js"
import {
  createHistorySourceEvent,
  requireNumericCursor,
  validateHistoryPage,
  waitBeforeHistoryRequest,
} from "./history-sync-support.js"

const DEFAULT_PAGE_SIZE = 1000

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

async function persistCanonicalFill({
  fill,
  repositories,
  providerIdentity,
  environment,
  observedAt,
  broker,
  requestDelayMs,
  sleep,
  now,
  state,
}) {
  const orderKey = `${fill.market.id}:${fill.brokerOrderId}`
  let clientOrderId = state.ordersByBrokerId.get(orderKey)
  if (clientOrderId === undefined) {
    clientOrderId = await repositories.orderRepository.findByExchangeOrderIdentity({
      providerIdentity,
      environment,
      marketId: fill.market.id,
      brokerOrderId: fill.brokerOrderId,
    })
    const symbolOrderKey = `${fill.market.symbol}:${fill.brokerOrderId}`
    if (clientOrderId === null && state.refreshedOrderIds.has(symbolOrderKey)) {
      state.ordersWithoutHistory.add(orderKey)
    }
    if (clientOrderId === null && !state.ordersWithoutHistory.has(orderKey)) {
      const lookup = await fetchAndPersistOrderByExchangeId({
        broker,
        symbol: fill.market.symbol,
        brokerOrderId: fill.brokerOrderId,
        repositories,
        providerIdentity,
        environment,
        requestDelayMs,
        sleep,
        now,
        state,
      })
      clientOrderId = lookup.order?.clientOrderId
      if (lookup.order === null) {
        state.ordersWithoutHistory.add(orderKey)
      }
    }
    if (clientOrderId !== null && clientOrderId !== undefined) {
      state.ordersByBrokerId.set(orderKey, clientOrderId)
    }
  }
  const enrichedFill = createEnrichedFill({
    fill,
    clientOrderId,
    providerIdentity,
  })
  const sourceEvent = createHistorySourceEvent({
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

async function resolveTradeHistoryCursor({
  repositories,
  providerIdentity,
  environment,
  symbol,
}) {
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

async function requestFillPage({
  broker,
  symbol,
  fromId,
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
  const result = await broker.getFills({
    symbol,
    fromId,
    limit,
  })
  state.requestCount += 1
  state.fillPagesChecked += 1
  return validateHistoryPage({
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

async function persistFillPage({
  fills,
  broker,
  repositories,
  providerIdentity,
  environment,
  requestDelayMs,
  sleep,
  now,
  state,
}) {
  for (const fill of fills) {
    await persistCanonicalFill({
      fill,
      broker,
      repositories,
      providerIdentity,
      environment,
      observedAt: new Date(now()).toISOString(),
      requestDelayMs,
      sleep,
      now,
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

export async function synchronizeFillHistoryForMarket({
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
  const { fromId: initialFromId, lastTradeId: initialTradeId } = await resolveTradeHistoryCursor({
    repositories,
    providerIdentity,
    environment,
    symbol,
  })
  let fromId = initialFromId
  let lastTradeId = initialTradeId
  while (true) {
    const page = await requestFillPage({
      broker,
      symbol,
      fromId,
      limit,
      requestDelayMs,
      sleep,
      state,
    })
    const validated = validateFillPage({
      page,
      symbol,
      lastTradeId,
      state,
    })
    await persistFillPage({
      fills: validated.fills,
      broker,
      repositories,
      providerIdentity,
      environment,
      requestDelayMs,
      sleep,
      now,
      state,
    })
    lastTradeId = validated.lastTradeId
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
