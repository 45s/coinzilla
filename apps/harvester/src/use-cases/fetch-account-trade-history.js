import { Fill, Market } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_REQUEST_DELAY_MS = 200

const defaultSleep = ({ durationMs }) => new Promise((resolve) => {
  setTimeout(resolve, durationMs)
})

function requireSafeTradeId({ fill, symbol }) {
  const tradeId = fill?.tradeId
  if (typeof tradeId !== "string" || !/^\d+$/.test(tradeId)) {
    throw new TypeError("Account trade history returned an invalid trade ID for " + symbol)
  }
  const normalized = Number(tradeId)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new RangeError("Account trade history trade ID exceeds the safe pagination range for " + symbol)
  }
  return normalized
}

/**
 * Fetch symbol-scoped account trade history for every supplied canonical Market.
 * The first page is anchored at startTime; full pages continue from the next
 * inclusive Binance trade ID. Calls are sequential and rate-limited by default.
 *
 * marketUniverseComplete is an explicit caller assertion. Binance exchangeInfo
 * only describes its current catalog; callers must not claim completeness when
 * symbols delisted after the baseline could contain unobserved executions.
 */
export async function fetchAccountTradeHistory({
  broker,
  markets,
  startTime,
  limit = DEFAULT_PAGE_SIZE,
  requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
  sleep = defaultSleep,
  marketUniverseComplete = false,
} = {}) {
  try {
    if (!broker || typeof broker.getFills !== "function") {
      throw new TypeError("fetchAccountTradeHistory requires broker.getFills")
    }
    if (!Array.isArray(markets) || markets.some((market) => !(market instanceof Market))) {
      throw new TypeError("fetchAccountTradeHistory markets must contain canonical Market values")
    }
    if (new Set(markets.map((market) => market.symbol)).size !== markets.length) {
      throw new Error("Account trade-history market catalog contains duplicate symbols")
    }
    if (!Number.isSafeInteger(startTime) || startTime < 0) {
      throw new TypeError("Account trade-history startTime must be a non-negative safe integer")
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_PAGE_SIZE) {
      throw new TypeError("Account trade-history limit must be between 1 and 1000")
    }
    if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0) {
      throw new TypeError("Account trade-history requestDelayMs must be a non-negative safe integer")
    }
    if (typeof sleep !== "function") throw new TypeError("Account trade-history sleep must be a function")

    const fills = []
    const fillIds = new Set()
    const tradeIdsBySymbol = new Map()
    let requestCount = 0

    for (const market of markets) {
      let fromId
      let firstPage = true
      let lastTradeId = -1
      let lastExecutedAt = -1

      while (true) {
        if (requestCount > 0 && requestDelayMs > 0) {
          await sleep({ durationMs: requestDelayMs })
        }
        const query = {
          symbol: market.symbol,
          limit,
          ...(firstPage ? { startTime } : { fromId }),
        }
        const result = await broker.getFills(query)
        requestCount += 1
        if (result?.ok !== true || !Array.isArray(result.data)) {
          const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
          throw new Error(
            "Unable to fetch complete account trade history for " + market.symbol +
            (details ? ": " + details : ""),
          )
        }
        const page = result.data
        if (page.length > limit) {
          throw new Error("Account trade history exceeded the requested page size for " + market.symbol)
        }

        for (const fill of page) {
          if (!(fill instanceof Fill) || fill.market.symbol !== market.symbol) {
            throw new TypeError("Account trade history returned a non-canonical or wrong-market fill for " + market.symbol)
          }
          const numericTradeId = requireSafeTradeId({ fill, symbol: market.symbol })
          if (numericTradeId <= lastTradeId) {
            throw new Error("Account trade history cursor did not advance strictly for " + market.symbol)
          }
          lastTradeId = numericTradeId
          if (fill.executedAt !== undefined) {
            if (!Number.isSafeInteger(fill.executedAt) || fill.executedAt < lastExecutedAt) {
              throw new Error("Account trade history execution timestamps are invalid or moved backwards for " + market.symbol)
            }
            if (firstPage && fill.executedAt < startTime) {
              throw new Error("Account trade history returned an execution before the requested baseline for " + market.symbol)
            }
            lastExecutedAt = fill.executedAt
          }
          if (fillIds.has(fill.id)) {
            throw new Error("Account trade history contains duplicate execution identity " + fill.id)
          }
          const tradeKey = market.symbol + ":" + fill.tradeId
          if (tradeIdsBySymbol.has(tradeKey)) {
            throw new Error("Account trade history contains duplicate trade identity " + tradeKey)
          }
          fillIds.add(fill.id)
          tradeIdsBySymbol.set(tradeKey, fill.id)
          fills.push(fill)
        }

        if (page.length < limit) break
        if (lastTradeId >= Number.MAX_SAFE_INTEGER) {
          throw new RangeError("Account trade history cannot safely advance the Binance trade cursor for " + market.symbol)
        }
        fromId = lastTradeId + 1
        firstPage = false
      }
    }

    return toResult({
      data: Object.freeze({
        fills: Object.freeze(fills),
        marketsChecked: markets.length,
        pagesChecked: requestCount,
        historyPagesComplete: true,
        marketUniverseComplete: marketUniverseComplete === true,
        complete: marketUniverseComplete === true,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
