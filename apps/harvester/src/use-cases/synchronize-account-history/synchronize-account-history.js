import { toResult } from "@coinzilla/utils"
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_REQUEST_DELAY_MS,
} from "./constants.js"
import { createHistoryDiagnostics } from "./helpers/create-history-diagnostics.js"
import { validateOptions } from "./helpers/validate-input.js"
import { fetchFillHistoryForMarket } from "./synchronize-fills.js"
import { fetchOrderHistoryForMarket } from "./synchronize-orders.js"

const defaultSleep = ({ durationMs }) => new Promise((resolve) => {
  setTimeout(resolve, durationMs)
})

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
