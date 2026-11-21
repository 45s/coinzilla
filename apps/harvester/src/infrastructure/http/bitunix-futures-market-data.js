const DEFAULT_BASE_URL = "https://fapi.bitunix.com"
const DEFAULT_WEBSOCKET_URL = "wss://fapi.bitunix.com/public/"
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_WEBSOCKET_TIMEOUT_MS = 3_000
const MAX_CHANNELS_PER_WEBSOCKET = 300

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

function parseNativeTickerMessage(data) {
  try {
    const payload = JSON.parse(String(data))
    return payload?.ch === "tickers" && Array.isArray(payload.data)
      ? payload.data
      : []
  } catch {
    return []
  }
}

function collectNativeTickerChanges({ tickers, changes } = {}) {
  for (const ticker of tickers) {
    if (typeof ticker?.s === "string" && typeof ticker.r === "string") {
      changes.set(ticker.s, ticker.r)
    }
  }
}

function closeWebSocket(socket) {
  try {
    socket?.close()
  } catch {
    // A failed public market-data socket must not prevent REST ticker display.
  }
}

function readNativeTickerChunk({ WebSocketImpl, websocketUrl, symbols, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const changes = new Map()
    let settled = false
    let socket
    let timeout

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      closeWebSocket(socket)
      resolve(changes)
    }

    try {
      socket = new WebSocketImpl(websocketUrl)
      timeout = setTimeout(finish, timeoutMs)
      socket.addEventListener("open", () => {
        if (settled) {
          return
        }
        try {
          socket.send(JSON.stringify({
            op: "subscribe",
            args: symbols.map((symbol) => ({
              symbol,
              ch: "tickers",
            })),
          }))
        } catch {
          finish()
        }
      }, { once: true })
      socket.addEventListener("message", (event) => {
        collectNativeTickerChanges({
          tickers: parseNativeTickerMessage(event.data),
          changes,
        })
        if (changes.size >= symbols.length) {
          finish()
        }
      })
      socket.addEventListener("error", finish, { once: true })
      socket.addEventListener("close", finish, { once: true })
    } catch {
      finish()
    }
  })
}

function splitSymbolsIntoWebSocketChunks(symbols) {
  const chunks = []
  for (let index = 0; index < symbols.length; index += MAX_CHANNELS_PER_WEBSOCKET) {
    chunks.push(symbols.slice(index, index + MAX_CHANNELS_PER_WEBSOCKET))
  }
  return chunks
}

async function readNative24hChanges({ WebSocketImpl, websocketUrl, symbols, timeoutMs } = {}) {
  if (typeof WebSocketImpl !== "function" || symbols.length === 0) {
    return new Map()
  }
  const chunks = splitSymbolsIntoWebSocketChunks(symbols)
  const results = await Promise.all(chunks.map((chunk) => readNativeTickerChunk({
    WebSocketImpl,
    websocketUrl,
    symbols: chunk,
    timeoutMs,
  })))
  const changes = new Map()
  for (const result of results) {
    for (const [symbol, value] of result) {
      changes.set(symbol, value)
    }
  }
  return changes
}

function mapTickerFields({ ticker, native24hChange } = {}) {
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
    change24h: readString(native24hChange),
  }
}

function mapFuturesContract({ contract, ticker, native24hChange } = {}) {
  return {
    symbol: readString(contract.symbol),
    base: readString(contract.base),
    quote: readString(contract.quote),
    symbolStatus: readString(contract.symbolStatus),
    isApiSupported: readBoolean(contract.isApiSupported),
    maxLeverage: typeof contract.maxLeverage === "number" ? contract.maxLeverage : null,
    ...mapTickerFields({
      ticker,
      native24hChange,
    }),
  }
}

async function fetchBitunixFuturesData({ fetchImpl, baseUrl, timeoutMs } = {}) {
  const contractsUrl = new URL("/api/v1/futures/market/trading_pairs", baseUrl)
  const tickersUrl = new URL("/api/v1/futures/market/tickers", baseUrl)
  const [contractsPayload, tickersPayload] = await Promise.all([
    requestMarketData({
      fetchImpl,
      url: contractsUrl,
      timeoutMs,
    }),
    requestMarketData({
      fetchImpl,
      url: tickersUrl,
      timeoutMs,
    }),
  ])
  const contracts = parseMarketDataPayload({
    payload: contractsPayload,
    endpoint: "trading-pairs",
  }).filter((contract) => contract && typeof contract.symbol === "string")
  const tickers = parseMarketDataPayload({
    payload: tickersPayload,
    endpoint: "tickers",
  })
  const tickersBySymbol = new Map(tickers
    .filter((ticker) => ticker && typeof ticker.symbol === "string")
    .map((ticker) => [ticker.symbol, ticker]))
  return {
    contracts,
    tickersBySymbol,
  }
}

async function createBitunixFuturesSnapshot({
  fetchImpl,
  WebSocketImpl,
  baseUrl,
  websocketUrl,
  timeoutMs,
  websocketTimeoutMs,
  now,
} = {}) {
  const { contracts, tickersBySymbol } = await fetchBitunixFuturesData({
    fetchImpl,
    baseUrl,
    timeoutMs,
  })
  const native24hChanges = await readNative24hChanges({
    WebSocketImpl,
    websocketUrl,
    symbols: contracts.map((contract) => contract.symbol),
    timeoutMs: websocketTimeoutMs,
  })
  const markets = contracts.map((contract) => mapFuturesContract({
    contract,
    ticker: tickersBySymbol.get(contract.symbol),
    native24hChange: native24hChanges.get(contract.symbol),
  }))
  return {
    provider: "bitunix",
    marketType: "futures",
    observedAt: now().toISOString(),
    markets,
  }
}


function validateMarketDataClientConfiguration({
  fetchImpl,
  WebSocketImpl,
  baseUrl,
  websocketUrl,
  timeoutMs,
  websocketTimeoutMs,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Bitunix market-data client requires a fetch implementation.")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError("Bitunix market-data timeout must be between 1 and 30000 milliseconds.")
  }
  if (!Number.isSafeInteger(websocketTimeoutMs) || websocketTimeoutMs < 1 || websocketTimeoutMs > 10_000) {
    throw new TypeError("Bitunix ticker WebSocket timeout must be between 1 and 10000 milliseconds.")
  }
  const normalizedBaseUrl = new URL(baseUrl)
  if (normalizedBaseUrl.protocol !== "https:") {
    throw new TypeError("Bitunix public market-data must use HTTPS.")
  }
  const normalizedWebsocketUrl = new URL(websocketUrl)
  if (normalizedWebsocketUrl.protocol !== "wss:") {
    throw new TypeError("Bitunix public market-data WebSocket must use WSS.")
  }
  return {
    fetchImpl,
    WebSocketImpl,
    baseUrl: normalizedBaseUrl,
    websocketUrl: normalizedWebsocketUrl.toString(),
    timeoutMs,
    websocketTimeoutMs,
  }
}

/**
 * Create a read-only client for Bitunix public Futures market metadata and tickers.
 *
 * @param {{fetchImpl?: Function, WebSocketImpl?: Function|null, baseUrl?: string, websocketUrl?: string, timeoutMs?: number, websocketTimeoutMs?: number, now?: Function}} input
 * @returns {Readonly<{getBitunixFuturesMarkets: Function}>}
 */
export function createBitunixFuturesMarketDataClient({
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  baseUrl = DEFAULT_BASE_URL,
  websocketUrl = DEFAULT_WEBSOCKET_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  websocketTimeoutMs = DEFAULT_WEBSOCKET_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const configuration = validateMarketDataClientConfiguration({
    fetchImpl,
    WebSocketImpl,
    baseUrl,
    websocketUrl,
    timeoutMs,
    websocketTimeoutMs,
  })
  return Object.freeze({
    getBitunixFuturesMarkets: () => createBitunixFuturesSnapshot({
      ...configuration,
      now,
    }),
  })
}
