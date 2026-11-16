const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,20}$/
const INTERVALS = new Set(["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"])
const ROLLING_WINDOWS = new Set(["1h", "4h"])
const DEPTH_LEVELS = new Set([5, 10, 20])
const UPDATE_SPEEDS = new Set(["100ms", "1000ms"])

function assertSymbol(symbol) {
  if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) {
    throw new TypeError("symbol must contain 1-20 ASCII letters or digits")
  }
  return symbol.toLowerCase()
}

function normalizeSymbol(symbol) {
  if (symbol === undefined || symbol === null ||
      typeof symbol === "string" && symbol.trim() === "") {
    return null
  }
  return assertSymbol(symbol)
}

function requireSymbol(symbol, type) {
  if (!symbol) throw new TypeError(`symbol is required for ${type}`)
  return symbol
}

function createTradeStream({ type, symbol }) {
  return validateStreamName(`${requireSymbol(symbol, type)}@${type}`)
}

function createTickerStream({ type, symbol }) {
  const stream = symbol ? `${symbol}@${type}` : `!${type}@arr`
  return validateStreamName(stream)
}

function createBookTickerStream({ symbol }) {
  return validateStreamName(`${requireSymbol(symbol, "bookTicker")}@bookTicker`)
}

function createKlineStream({ symbol, interval }) {
  requireSymbol(symbol, "kline")
  if (!INTERVALS.has(interval)) {
    throw new TypeError("interval is not a supported Binance kline interval")
  }
  return validateStreamName(`${symbol}@kline_${interval}`)
}

function createRollingWindowStream({ symbol, windowSize }) {
  if (!ROLLING_WINDOWS.has(windowSize)) {
    throw new TypeError("windowSize must be 1h or 4h")
  }
  const stream = symbol ? `${symbol}@ticker_${windowSize}` : `!ticker_${windowSize}@arr`
  return validateStreamName(stream)
}

function createPartialBookDepthStream({ symbol, levels, speed }) {
  requireSymbol(symbol, "partialBookDepth")
  if (!DEPTH_LEVELS.has(Number(levels))) {
    throw new TypeError("levels must be 5, 10, or 20")
  }
  if (!UPDATE_SPEEDS.has(speed)) {
    throw new TypeError("speed must be 100ms or 1000ms")
  }
  return validateStreamName(`${symbol}@depth${levels}@${speed}`)
}

function createDiffBookDepthStream({ symbol, speed }) {
  requireSymbol(symbol, "diffBookDepth")
  if (!UPDATE_SPEEDS.has(speed)) {
    throw new TypeError("speed must be 100ms or 1000ms")
  }
  return validateStreamName(`${symbol}@depth@${speed}`)
}

/**
 * Validate a Binance Spot stream name without changing its spelling.
 *
 * @param {string} stream
 * @returns {string} The validated stream name.
 * @throws {TypeError} If the name is empty or unsupported.
 */
export function validateStreamName(stream) {
  if (typeof stream !== "string" || stream.length === 0 || stream !== stream.trim()) {
    throw new TypeError("stream name must be a non-empty string without surrounding whitespace")
  }

  const symbolStream = /^([a-z0-9]{1,20})@(aggTrade|trade|miniTicker|ticker|bookTicker|kline_(1s|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)|ticker_(1h|4h)|depth(?:5|10|20)?(?:@(100ms|1000ms))?)$/
  const allMarketStream = /^!(miniTicker|ticker|ticker_(1h|4h))@arr$/

  if (!symbolStream.test(stream) && !allMarketStream.test(stream)) {
    throw new TypeError(`Unsupported Binance Spot stream name: ${stream}`)
  }

  return stream
}

/**
 * Create a validated Binance Spot stream name from its typed options.
 *
 * @param {"trade"|"aggTrade"|"miniTicker"|"ticker"|"bookTicker"|"kline"|"rollingWindowTicker"|"partialBookDepth"|"diffBookDepth"} type
 * @param {{symbol?: string, interval?: string, windowSize?: string, levels?: number, speed?: "100ms"|"1000ms"}} [options]
 * @returns {string}
 * @throws {TypeError} If the selected stream type or its options are unsupported.
 */
export function createStreamName(...args) {
  const [type, options = {}] = args
  const { symbol, interval, windowSize, levels, speed } = options
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedWindowSize = typeof windowSize === "string" ? windowSize.toLowerCase() : windowSize

  switch (type) {
    case "trade":
    case "aggTrade":
      return createTradeStream({ type, symbol: normalizedSymbol })
    case "miniTicker":
    case "ticker":
      return createTickerStream({ type, symbol: normalizedSymbol })
    case "bookTicker":
      return createBookTickerStream({ symbol: normalizedSymbol })
    case "kline":
      return createKlineStream({ symbol: normalizedSymbol, interval })
    case "rollingWindowTicker":
      return createRollingWindowStream({ symbol: normalizedSymbol, windowSize: normalizedWindowSize })
    case "partialBookDepth":
      return createPartialBookDepthStream({ symbol: normalizedSymbol, levels, speed })
    case "diffBookDepth":
      return createDiffBookDepthStream({ symbol: normalizedSymbol, speed })
    default:
      throw new TypeError(`Unsupported Binance stream type: ${type}`)
  }
}

function parseMessageInput(rawMessage) {
  try {
    return typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage
  } catch {
    throw new TypeError("Binance stream message is not valid JSON")
  }
}

function parseCombinedStream(parsed) {
  if (typeof parsed.stream !== "string" || !parsed.data || typeof parsed.data !== "object") {
    throw new TypeError("Malformed Binance combined-stream envelope")
  }
  if (parsed.stream === "!serverShutdown" && parsed.data.e === "serverShutdown") {
    return { serverShutdown: true, data: parsed.data }
  }
  return { stream: validateStreamName(parsed.stream), data: parsed.data }
}

function isBookTickerPayload(parsed) {
  return typeof parsed.s === "string" &&
    ["u", "b", "B", "a", "A"].every((field) => Object.hasOwn(parsed, field))
}

function parseRawStream(parsed) {
  if (typeof parsed.id === "string" || typeof parsed.id === "number") {
    return { acknowledgement: parsed }
  }
  if (parsed.e === "serverShutdown") {
    return { serverShutdown: true, data: parsed }
  }
  if ((typeof parsed.e !== "string" || parsed.e.length === 0) && !isBookTickerPayload(parsed)) {
    throw new TypeError("Binance raw stream event is missing its event type")
  }
  return { stream: null, data: parsed }
}

/**
 * Parse raw, combined, all-market, or control-acknowledgement stream messages.
 *
 * @param {string|object|Array<object>} rawMessage - WebSocket message data.
 * @returns {{stream: string|null, data: object|object[]}|{acknowledgement: object}|{serverShutdown: true, data: object}}
 * @throws {TypeError} If the payload is not a supported Binance stream message.
 */
export function parseStreamMessage(rawMessage) {
  const parsed = parseMessageInput(rawMessage)
  if (Array.isArray(parsed)) {
    if (!parsed.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new TypeError("Binance all-market stream payload must contain objects")
    }
    return { stream: null, data: parsed }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new TypeError("Binance stream message must be an object")
  }
  if (Object.hasOwn(parsed, "stream") && Object.hasOwn(parsed, "data")) {
    return parseCombinedStream(parsed)
  }
  return parseRawStream(parsed)
}
