import { toResult } from "@coinzilla/utils"
import { AccountHistorySynchronizationError } from "./account-history-synchronization-error.js"
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_REQUEST_DELAY_MS,
} from "./constants.js"
import { createHistoryDiagnostics } from "./helpers/create-history-diagnostics.js"
import { validateOptions } from "./helpers/validate-input.js"
import { fetchFillHistoryForMarket } from "./sync-fills.js"
import { fetchOrderHistoryForMarket } from "./sync-orders.js"

const defaultSleep = ({ durationMs }) => new Promise((resolve) => {
  setTimeout(resolve, durationMs)
})

function createInput({
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
  return {
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
}

function normalizeError(error) {
  return error instanceof Error
    ? error
    : new Error(String(error))
}

function createFailureSnapshot({ error, symbol, state, fallbackStage }) {
  return Object.freeze({
    ...(typeof symbol === "string" ? {
      market: symbol,
    } : {}),
    historyType: state.currentHistoryType ?? "unknown",
    failureStage: state.currentOperation ?? fallbackStage,
    ...(typeof state.currentPageCursor === "string" ? {
      pageCursor: state.currentPageCursor,
    } : {}),
    ...(Number.isSafeInteger(state.currentRecordIndex) ? {
      recordIndex: state.currentRecordIndex,
    } : {}),
    ...(typeof state.currentBrokerOrderId === "string" ? {
      brokerOrderId: state.currentBrokerOrderId,
    } : {}),
    ...(typeof state.currentClientOrderId === "string" ? {
      clientOrderId: state.currentClientOrderId,
    } : {}),
    ...(typeof state.currentTradeId === "string" ? {
      tradeId: state.currentTradeId,
    } : {}),
    ...(typeof state.lastPersistedOrderId === "string" ? {
      lastPersistedOrderId: state.lastPersistedOrderId,
    } : {}),
    ...(typeof state.lastPersistedTradeId === "string" ? {
      lastPersistedTradeId: state.lastPersistedTradeId,
    } : {}),
    errorName: error.name,
    errorCode: typeof error.code === "string" ? error.code : null,
    message: error.message,
  })
}

function resetCurrentMarketContext(state) {
  state.currentHistoryType = null
  state.currentOperation = null
  state.currentPageCursor = null
  state.currentRecordIndex = null
  state.currentBrokerOrderId = null
  state.currentClientOrderId = null
  state.currentTradeId = null
  state.lastPersistedOrderId = null
  state.lastPersistedTradeId = null
}

function captureMarketFailure({ error, symbol, state }) {
  const failure = normalizeError(error)
  state.errors.push(failure)
  state.failures.push(createFailureSnapshot({
    error: failure,
    symbol,
    state,
    fallbackStage: "MARKET_SYNCHRONIZATION",
  }))
  state.marketsFailed.push(symbol)
}

async function synchronizeMarket({ input, state, symbol }) {
  resetCurrentMarketContext(state)
  state.currentMarket = symbol
  state.marketsAttempted.push(symbol)
  try {
    await fetchOrderHistoryForMarket({
      ...input,
      symbol,
      state,
    })
    state.orderMarketsQueried.push(symbol)
    await fetchFillHistoryForMarket({
      ...input,
      symbol,
      state,
    })
    state.fillMarketsQueried.push(symbol)
    state.marketsQueried.push(symbol)
  } catch (error) {
    captureMarketFailure({
      error,
      symbol,
      state,
    })
  } finally {
    state.currentMarket = null
    resetCurrentMarketContext(state)
  }
}

async function synchronizeMarkets({ input, state }) {
  for (const symbol of input.symbols) {
    await synchronizeMarket({
      input,
      state,
      symbol,
    })
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
    orderMarketsQueried: [],
    fillMarketsQueried: [],
    marketsQueried: [],
    marketsFailed: [],
    currentMarket: null,
    currentHistoryType: null,
    currentOperation: null,
    currentPageCursor: null,
    currentRecordIndex: null,
    currentBrokerOrderId: null,
    currentClientOrderId: null,
    currentTradeId: null,
    lastPersistedOrderId: null,
    lastPersistedTradeId: null,
    failures: [],
    errors: [],
    orderIds: new Set(),
    fillIds: new Set(),
    ordersByBrokerId: new Map(),
  }
}

function createRepositories({ orderRepository, fillRepository, cursorRepository }) {
  return {
    orderRepository,
    fillRepository,
    cursorRepository,
  }
}

function createUnexpectedFailureResult({ error, state, input }) {
  const failure = normalizeError(error)
  state.failures.push(createFailureSnapshot({
    error: failure,
    symbol: state.currentMarket,
    state,
    fallbackStage: "INPUT_VALIDATION",
  }))
  if (typeof state.currentMarket === "string" && !state.marketsFailed.includes(state.currentMarket)) {
    state.marketsFailed.push(state.currentMarket)
  }
  if (state.errors.length > 0 && Array.isArray(input?.symbols) && input.symbols.length > 0) {
    state.errors.push(failure)
    const diagnostics = createHistoryDiagnostics({
      state,
      historyPagesComplete: false,
    })
    const aggregateError = new AccountHistorySynchronizationError({
      errors: state.errors,
      marketCount: input.symbols.length,
    })
    aggregateError.historyDiagnostics = diagnostics
    return toResult({
      error: aggregateError,
    })
  }
  failure.historyDiagnostics = createHistoryDiagnostics({
    state,
    historyPagesComplete: false,
  })
  return toResult({
    error: failure,
  })
}

function createMarketFailureResult({ state, input, diagnostics }) {
  const error = new AccountHistorySynchronizationError({
    errors: state.errors,
    marketCount: input.symbols.length,
  })
  error.historyDiagnostics = diagnostics
  return toResult({
    error,
  })
}

/**
 * Synchronize all exchange-available order and trade history for the supplied
 * Binance markets. The result never certifies the historical market universe
 * or the exchange's retention horizon.
 */
export async function synchronizeAccountHistory(options = {}) {
  const state = createInitialState()
  const input = createInput(options)
  try {
    validateOptions(input)
    await synchronizeMarkets({
      input: {
        ...input,
        repositories: createRepositories(input),
      },
      state,
    })
  } catch (error) {
    return createUnexpectedFailureResult({
      error,
      state,
      input,
    })
  }

  const diagnostics = createHistoryDiagnostics({
    state,
    historyPagesComplete: state.failures.length === 0,
  })
  if (state.errors.length > 0) {
    return createMarketFailureResult({
      state,
      input,
      diagnostics,
    })
  }
  return toResult({
    data: diagnostics,
  })
}
