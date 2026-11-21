import { Fill } from "@coinzilla/entities"
import { requireNumericCursor, validatePage } from "./helpers/validate-input.js"
import {
  createEnrichedFill,
  createSourceEvent,
  mapCanonicalFill,
} from "./helpers/map-history-records.js"
import { waitBeforeRequest } from "./wait-before-request.js"

function validateCanonicalFill({ fill, symbol, lastTradeId, state }) {
  if (!(fill instanceof Fill) || fill.market.symbol !== symbol || fill.market.venue !== "binance") {
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
  state.lastPersistedTradeId = fill.tradeId
}

async function resolveTradeHistoryCursor({ repositories, providerIdentity, environment, symbol, state }) {
  state.currentHistoryType = "trades"
  state.currentOperation = "TRADE_CURSOR_READ"
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
  state.currentHistoryType = "trades"
  state.currentOperation = "TRADE_PAGE_FETCH"
  state.currentPageCursor = String(fromId)
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
  state.fillPagesChecked += 1
  const result = await broker.getFills({
    symbol,
    fromId,
    limit,
  })
  return validatePage({
    result,
    symbol,
    limit,
    historyType: "trade",
  })
}

function validateFillPage({ page, symbol, lastTradeId, state }) {
  state.currentOperation = "TRADE_PAGE_VALIDATE"
  state.fillsObserved += page.length
  let nextTradeId = lastTradeId
  const fills = []
  for (const [index, fill] of page.entries()) {
    state.currentRecordIndex = index + 1
    state.currentTradeId = typeof fill?.tradeId === "string" ? fill.tradeId : null
    state.currentBrokerOrderId = typeof fill?.brokerOrderId === "string" ? fill.brokerOrderId : null
    state.currentClientOrderId = typeof fill?.clientOrderId === "string" ? fill.clientOrderId : null
    nextTradeId = validateCanonicalFill({
      fill,
      symbol,
      lastTradeId: nextTradeId,
      state,
    })
    fills.push(fill)
  }
  return {
    fills,
    lastTradeId: nextTradeId,
  }
}

async function persistFillPage({ fills, repositories, providerIdentity, environment, now, state }) {
  for (const [index, fill] of fills.entries()) {
    state.currentOperation = "FILL_RECORD_PERSIST"
    state.currentRecordIndex = index + 1
    state.currentTradeId = fill.tradeId
    state.currentBrokerOrderId = fill.brokerOrderId
    state.currentClientOrderId = typeof fill.clientOrderId === "string" ? fill.clientOrderId : null
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

async function persistAndAdvanceTradePage({
  page,
  validated,
  repositories,
  providerIdentity,
  environment,
  symbol,
  now,
  state,
}) {
  await persistFillPage({
    fills: validated.fills,
    repositories,
    providerIdentity,
    environment,
    now,
    state,
  })
  const { lastTradeId } = validated
  state.currentOperation = "TRADE_CURSOR_SAVE"
  state.currentRecordIndex = null
  state.currentBrokerOrderId = null
  state.currentClientOrderId = null
  state.currentTradeId = null
  await saveTradePageCursor({
    page,
    lastTradeId,
    repositories,
    providerIdentity,
    environment,
    symbol,
    now,
  })
  return lastTradeId
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
    state,
  })
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
    lastTradeId = await persistAndAdvanceTradePage({
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
    if (lastTradeId >= Number.MAX_SAFE_INTEGER) {
      state.currentOperation = "TRADE_CURSOR_ADVANCE"
      throw new RangeError(`Binance trade history cannot advance its cursor for ${symbol}`)
    }
    fromId = lastTradeId + 1
  }
}


export { fetchFillHistoryForMarket }
