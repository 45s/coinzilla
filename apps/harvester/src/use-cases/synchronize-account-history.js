import { toResult } from "@coinzilla/utils"
import { synchronizeFillHistoryForMarket } from "./synchronize-fill-history.js"
import { synchronizeOrderHistoryForMarket } from "./synchronize-order-history.js"

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_REQUEST_DELAY_MS = 200

const defaultSleep = ({ durationMs }) => new Promise((resolve) => {
  setTimeout(resolve, durationMs)
})

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`Account history ${field} must be a stable provider identifier`)
  }
  return value
}

function validateOptions(input) {
  if (typeof input.broker?.getCanonicalOrderHistory !== "function" ||
      typeof input.broker?.getFills !== "function") {
    throw new TypeError("Account history synchronization requires canonical order and fill history methods")
  }
  if (!Array.isArray(input.symbols) || input.symbols.length === 0 ||
      input.symbols.some((symbol) => typeof symbol !== "string" || !symbol.trim())) {
    throw new TypeError("Account history synchronization requires configured market symbols")
  }
  if (new Set(input.symbols).size !== input.symbols.length) {
    throw new Error("Account history synchronization symbols must be unique")
  }
  if (input.providerIdentity?.providerType !== "binance") {
    throw new TypeError("Account history synchronization currently supports Binance only")
  }
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    requireIdentifier({
      value: input.providerIdentity[field],
      field,
    })
  }
  if (!["testnet", "live"].includes(input.environment)) {
    throw new TypeError("Account history synchronization environment must be testnet or live")
  }
  if (
    typeof input.orderRepository?.upsertHistorical !== "function" ||
    typeof input.orderRepository?.findByExchangeOrderIdentity !== "function" ||
    typeof input.orderRepository?.listPendingOrderIds !== "function" ||
    typeof input.fillRepository?.upsert !== "function" ||
    typeof input.cursorRepository?.get !== "function" ||
    typeof input.cursorRepository?.saveOrderCursor !== "function" ||
    typeof input.cursorRepository?.saveTradeCursor !== "function"
  ) {
    throw new TypeError("Account history synchronization requires relational history and cursor repositories")
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > DEFAULT_PAGE_SIZE) {
    throw new TypeError("Account history page size must be between 1 and 1000")
  }
  if (!Number.isSafeInteger(input.requestDelayMs) || input.requestDelayMs < 0) {
    throw new TypeError("Account history request delay must be a non-negative safe integer")
  }
  if (typeof input.sleep !== "function" || typeof input.now !== "function") {
    throw new TypeError("Account history synchronization requires sleep and clock functions")
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
    pendingOrdersUnavailable: 0,
    archivedOrderLookups: 0,
    marketsAttempted: [],
    marketsQueried: [],
    currentMarket: null,
    ordersWithoutHistory: new Set(),
    fillIds: new Set(),
    ordersByBrokerId: new Map(),
  }
}

async function synchronizeMarkets({ input, state }) {
  for (const symbol of input.symbols) {
    state.currentMarket = symbol
    state.marketsAttempted.push(symbol)
    await synchronizeOrderHistoryForMarket({
      ...input,
      symbol,
      state,
    })
    await synchronizeFillHistoryForMarket({
      ...input,
      symbol,
      state,
    })
    state.marketsQueried.push(symbol)
    state.currentMarket = null
  }
}

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
    pendingOrdersUnavailable: state.pendingOrdersUnavailable,
    archivedOrderLookups: state.archivedOrderLookups,
    requestCount: state.requestCount,
    historyPagesComplete,
    marketHistoryPagesComplete: historyPagesComplete,
    marketUniverseComplete: false,
    retentionCoverageConfirmed: false,
    complete: false,
    errorMessage,
  })
}

/**
 * Synchronize Binance order and trade history for configured markets.
 * This is a read-only projection and never certifies account-wide or
 * exchange-retention completeness.
 */
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
      repositories: {
        orderRepository,
        fillRepository,
        cursorRepository,
      },
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
      input,
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
