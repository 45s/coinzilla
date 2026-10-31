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

export function validateStreamName(stream) {
  if (typeof stream !== "string" || stream.length === 0 || stream !== stream.trim()) {
    throw new TypeError("stream name must be a non-empty string without surrounding whitespace")
  }

  const symbolStream = /^([a-z0-9]{1,20})@(aggTrade|trade|miniTicker|ticker|bookTicker|kline_(1s|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)|ticker_(1h|4h|1d)|depth(?:5|10|20)?(?:@(100ms|1000ms))?)$/
  const allMarketStream = /^!(miniTicker|ticker|ticker_(1h|4h|1d))@arr$/

  if (!symbolStream.test(stream) && !allMarketStream.test(stream)) {
    throw new TypeError(`Unsupported Binance Spot stream name: ${stream}`)
  }

  return stream
}

export function createStreamName(type, options = {}) {
  const { symbol, interval, windowSize, levels, speed } = options
  const normalizedSymbol = symbol === undefined || symbol === null ? null : assertSymbol(symbol)

  switch (type) {
    case "trade":
    case "aggTrade":
      if (!normalizedSymbol) throw new TypeError(`symbol is required for ${type}`)
      return validateStreamName(`${normalizedSymbol}@${type}`)
    case "miniTicker":
    case "ticker":
      return validateStreamName(normalizedSymbol ? `${normalizedSymbol}@${type}` : `!${type}@arr`)
    case "bookTicker":
      if (!normalizedSymbol) throw new TypeError("symbol is required for bookTicker")
      return validateStreamName(`${normalizedSymbol}@bookTicker`)
    case "kline":
      if (!normalizedSymbol) throw new TypeError("symbol is required for kline")
      if (!INTERVALS.has(interval)) throw new TypeError("interval is not a supported Binance kline interval")
      return validateStreamName(`${normalizedSymbol}@kline_${interval}`)
    case "rollingWindowTicker":
      if (!ROLLING_WINDOWS.has(windowSize)) throw new TypeError("windowSize must be 1h, 4h, or 1d")
      return validateStreamName(normalizedSymbol
        ? `${normalizedSymbol}@ticker_${windowSize}`
        : `!ticker_${windowSize}@arr`)
    case "partialBookDepth":
      if (!normalizedSymbol) throw new TypeError("symbol is required for partialBookDepth")
      if (!DEPTH_LEVELS.has(Number(levels))) throw new TypeError("levels must be 5, 10, or 20")
      if (!UPDATE_SPEEDS.has(speed)) throw new TypeError("speed must be 100ms or 1000ms")
      return validateStreamName(`${normalizedSymbol}@depth${levels}@${speed}`)
    case "diffBookDepth":
      if (!normalizedSymbol) throw new TypeError("symbol is required for diffBookDepth")
      if (!UPDATE_SPEEDS.has(speed)) throw new TypeError("speed must be 100ms or 1000ms")
      return validateStreamName(`${normalizedSymbol}@depth@${speed}`)
    default:
      throw new TypeError(`Unsupported Binance stream type: ${type}`)
  }
}

export function parseStreamMessage(rawMessage) {
  let parsed
  try {
    parsed = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage
  } catch {
    throw new TypeError("Binance stream message is not valid JSON")
  }

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
    if (typeof parsed.stream !== "string" || !parsed.data || typeof parsed.data !== "object") {
      throw new TypeError("Malformed Binance combined-stream envelope")
    }
    if (parsed.stream === "!serverShutdown" && parsed.data.e === "serverShutdown") {
      return { serverShutdown: true, data: parsed.data }
    }
    return { stream: validateStreamName(parsed.stream), data: parsed.data }
  }

  if (typeof parsed.id === "string" || typeof parsed.id === "number") {
    return { acknowledgement: parsed }
  }

  if (parsed.e === "serverShutdown") {
    return { serverShutdown: true, data: parsed }
  }

  if (typeof parsed.e !== "string" || parsed.e.length === 0) {
    throw new TypeError("Binance raw stream event is missing its event type")
  }

  return { stream: null, data: parsed }
}
