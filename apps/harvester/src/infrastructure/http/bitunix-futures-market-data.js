const DEFAULT_BASE_URL = "https://fapi.bitunix.com"
const DEFAULT_TIMEOUT_MS = 5_000

function readString(value) {
  return typeof value === "string" ? value : null
}

function readBoolean(value) {
  return typeof value === "boolean" ? value : null
}

function parseMarketDataPayload({ payload, endpoint } = {}) {
  if (payload?.code !== 0 || !Array.isArray(payload.data)) {
    throw new Error(`Bitunix returned an invalid ${endpoint} response.`)
  }
  return payload.data
}

async function requestMarketData({ fetchImpl, url, timeoutMs } = {}) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error("Bitunix public market-data request failed.")
  }
  return response.json()
}

function mapTickerFields(ticker) {
  return {
    lastPrice: readString(ticker?.lastPrice),
    markPrice: readString(ticker?.markPrice),
    open: readString(ticker?.open),
    high: readString(ticker?.high),
    low: readString(ticker?.low),
    quoteVol: readString(ticker?.quoteVol),
    baseVol: readString(ticker?.baseVol),
    change5m: readString(ticker?.change5m),
    change1h: readString(ticker?.change1h),
    change4h: readString(ticker?.change4h),
    change24h: readString(ticker?.r),
  }
}

function mapFuturesContract({ contract, ticker } = {}) {
  return {
    symbol: readString(contract.symbol),
    base: readString(contract.base),
    quote: readString(contract.quote),
    symbolStatus: readString(contract.symbolStatus),
    isApiSupported: readBoolean(contract.isApiSupported),
    maxLeverage: typeof contract.maxLeverage === "number" ? contract.maxLeverage : null,
    ...mapTickerFields(ticker),
  }
}

/**
 * Create a read-only client for Bitunix public Futures market metadata and tickers.
 *
 * @param {{fetchImpl?: Function, baseUrl?: string, timeoutMs?: number, now?: Function}} input
 * @returns {Readonly<{getBitunixFuturesMarkets: Function}>}
 */
export function createBitunixFuturesMarketDataClient({
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Bitunix market-data client requires a fetch implementation.")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError("Bitunix market-data timeout must be between 1 and 30000 milliseconds.")
  }
  const normalizedBaseUrl = new URL(baseUrl)
  if (normalizedBaseUrl.protocol !== "https:") {
    throw new TypeError("Bitunix public market-data must use HTTPS.")
  }

  return Object.freeze({
    async getBitunixFuturesMarkets() {
      const contractsUrl = new URL("/api/v1/futures/market/trading_pairs", normalizedBaseUrl)
      const tickersUrl = new URL("/api/v1/futures/market/tickers", normalizedBaseUrl)
      const [contractsPayload, tickersPayload] = await Promise.all([
        requestMarketData({ fetchImpl, url: contractsUrl, timeoutMs }),
        requestMarketData({ fetchImpl, url: tickersUrl, timeoutMs }),
      ])
      const contracts = parseMarketDataPayload({
        payload: contractsPayload,
        endpoint: "trading-pairs",
      })
      const tickers = parseMarketDataPayload({
        payload: tickersPayload,
        endpoint: "tickers",
      })
      const tickersBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]))
      const markets = contracts
        .filter((contract) => typeof contract.symbol === "string")
        .map((contract) => mapFuturesContract({
          contract,
          ticker: tickersBySymbol.get(contract.symbol),
        }))
        .sort((left, right) => left.symbol.localeCompare(right.symbol))

      return {
        provider: "bitunix",
        marketType: "futures",
        observedAt: now().toISOString(),
        markets,
      }
    },
  })
}
