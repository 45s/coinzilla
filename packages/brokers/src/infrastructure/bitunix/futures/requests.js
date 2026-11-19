const MAX_INT64 = 9_223_372_036_854_775_807n
const MAX_PAGE_SIZE = 100
const MAX_KLINE_LIMIT = 200
const MAX_FUNDING_HISTORY_LIMIT = 200
const KLINE_INTERVALS = new Set([
  "1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
])
const DEPTH_LIMITS = new Set(["1", "5", "15", "50", "max"])
const KLINE_PRICE_TYPES = new Set(["LAST_PRICE", "MARK_PRICE"])

function normalizeString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Futures ${field} must be a non-empty string`)
  }
  return value.trim()
}

function normalizeSymbol({ symbol }) {
  return normalizeString({ value: symbol, field: "symbol" }).toUpperCase()
}

function normalizeSymbols({ symbols }) {
  if (symbols === undefined || symbols === null) {
    return undefined
  }

  const values = Array.isArray(symbols) ? symbols : (
    typeof symbols === "string" ? symbols.split(",") : null
  )
  if (!values || values.length === 0) {
    throw new TypeError("Bitunix Futures symbols must be a non-empty array or comma-separated string")
  }

  const normalized = values.map((symbol) => normalizeSymbol({ symbol }))
  if (normalized.some((symbol) => !symbol)) {
    throw new TypeError("Bitunix Futures symbols must not contain empty values")
  }
  return normalized.join(",")
}

function normalizeInt64({ value, field, defaultValue }) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  let normalized
  if (typeof value === "string" && /^(?:0|[1-9]\\d*)$/.test(value)) {
    normalized = value
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    normalized = String(value)
  } else {
    throw new TypeError(`Bitunix Futures ${field} must be a non-negative int64 string or safe integer`)
  }

  if (BigInt(normalized) > MAX_INT64) {
    throw new RangeError(`Bitunix Futures ${field} exceeds the signed int64 range`)
  }
  return normalized
}

function normalizeOptionalString({ value, field }) {
  if (value === undefined || value === null) {
    return undefined
  }
  return normalizeString({ value, field })
}

function normalizeOptionalBoolean({ value, field }) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`Bitunix Futures ${field} must be a boolean`)
  }
  return value
}

function normalizePositiveInteger({ value, field, defaultValue, maximum }) {
  const normalized = value === undefined || value === null ? defaultValue : value
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`Bitunix Futures ${field} must be a positive integer`)
  }
  if (maximum !== undefined && normalized > maximum) {
    throw new RangeError(`Bitunix Futures ${field} must not exceed ${maximum}`)
  }
  return normalized
}

function normalizePagination({ skip, limit, maximum = MAX_PAGE_SIZE }) {
  return {
    skip: normalizeInt64({ value: skip, field: "skip", defaultValue: "0" }),
    limit: normalizePositiveInteger({
      value: limit,
      field: "limit",
      defaultValue: 10,
      maximum,
    }),
  }
}

function normalizeTimeRange({ startTime, endTime }) {
  const start = normalizeInt64({ value: startTime, field: "startTime" })
  const end = normalizeInt64({ value: endTime, field: "endTime" })
  if (start !== undefined && end !== undefined && BigInt(start) > BigInt(end)) {
    throw new RangeError("Bitunix Futures startTime must be less than or equal to endTime")
  }
  return {
    ...(start === undefined ? {} : { startTime: start }),
    ...(end === undefined ? {} : { endTime: end }),
  }
}

function compactQuery(query) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined))
}

function normalizeDepthLimit({ limit }) {
  if (limit === undefined || limit === null) {
    return undefined
  }
  const value = String(limit)
  if (!DEPTH_LIMITS.has(value)) {
    throw new TypeError("Bitunix Futures depth limit must be one of 1, 5, 15, 50, or max")
  }
  return value
}

function normalizeKlineInterval({ interval }) {
  const value = normalizeString({ value: interval, field: "interval" })
  if (!KLINE_INTERVALS.has(value)) {
    throw new TypeError("Bitunix Futures interval is not documented")
  }
  return value
}

function normalizeKlinePriceType({ type }) {
  if (type === undefined || type === null) {
    return undefined
  }
  if (!KLINE_PRICE_TYPES.has(type)) {
    throw new TypeError("Bitunix Futures Kline type must be LAST_PRICE or MARK_PRICE")
  }
  return type
}

function normalizePageQuery(input, maximum = MAX_PAGE_SIZE) {
  return normalizePagination({
    skip: input.skip,
    limit: input.limit,
    maximum,
  })
}

function normalizeHistoryOrderRange({ input, now }) {
  const queryCanceled = normalizeOptionalBoolean({
    value: input.queryCanceled,
    field: "queryCanceled",
  }) ?? false
  const range = normalizeTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
  })
  const maxAge = queryCanceled ? 3 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000
  const earliestAllowed = BigInt(Math.max(0, now - maxAge))
  const latestAllowed = BigInt(now)
  if ((range.startTime !== undefined && BigInt(range.startTime) < earliestAllowed) ||
      (range.endTime !== undefined && (
        BigInt(range.endTime) < earliestAllowed || BigInt(range.endTime) > latestAllowed
      ))) {
    throw new RangeError(
      `Bitunix Futures ${queryCanceled ? "canceled" : "non-canceled"} order history is limited to the last ${queryCanceled ? "3" : "90"} days`,
    )
  }
  return {
    ...range,
    queryCanceled,
  }
}

export function createTradingPairsQuery({ symbols } = {}) {
  return compactQuery({
    symbols: normalizeSymbols({ symbols }),
  })
}

export function createTickersQuery({ symbols } = {}) {
  return compactQuery({
    symbols: normalizeSymbols({ symbols }),
  })
}

export function createDepthQuery({ symbol, limit } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    limit: normalizeDepthLimit({ limit }),
  }
}

export function createKlinesQuery({ symbol, interval, endTime, limit, type } = {}) {
  return compactQuery({
    symbol: normalizeSymbol({ symbol }),
    interval: normalizeKlineInterval({ interval }),
    endTime: normalizeInt64({ value: endTime, field: "endTime" }),
    limit: normalizePositiveInteger({
      value: limit,
      field: "limit",
      defaultValue: 100,
      maximum: MAX_KLINE_LIMIT,
    }),
    type: normalizeKlinePriceType({ type }),
  })
}

export function createFundingRateQuery({ symbol } = {}) {
  return { symbol: normalizeSymbol({ symbol }) }
}

export function createFundingHistoryQuery({ symbol, startTime, endTime, limit } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    ...normalizeTimeRange({ startTime, endTime }),
    limit: normalizePositiveInteger({
      value: limit,
      field: "limit",
      defaultValue: 100,
      maximum: MAX_FUNDING_HISTORY_LIMIT,
    }),
  }
}

export function createPositionTiersQuery({ symbol } = {}) {
  return { symbol: normalizeSymbol({ symbol }) }
}

export function createAccountQuery({ marginCoin } = {}) {
  return { marginCoin: normalizeString({ value: marginCoin, field: "marginCoin" }).toUpperCase() }
}

export function createTradingSettingsQuery({ symbols } = {}) {
  const normalizedSymbols = normalizeSymbols({ symbols })
  if (normalizedSymbols !== undefined && normalizedSymbols.split(",").length > 50) {
    throw new RangeError("Bitunix Futures trading settings accept at most 50 symbols")
  }
  return compactQuery({ symbols: normalizedSymbols })
}

export function createLeverageMarginModeQuery({ symbol, marginCoin } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    marginCoin: normalizeString({ value: marginCoin, field: "marginCoin" }).toUpperCase(),
  }
}

export function createPendingPositionsQuery({
  symbol,
  positionId,
  subAccountId,
  includeSubAccounts,
} = {}) {
  return compactQuery({
    symbol: symbol === undefined ? undefined : normalizeSymbol({ symbol }),
    positionId: normalizeOptionalString({ value: positionId, field: "positionId" }),
    subAccountId: normalizeInt64({ value: subAccountId, field: "subAccountId" }),
    includeSubAccounts: normalizeOptionalBoolean({
      value: includeSubAccounts,
      field: "includeSubAccounts",
    }),
  })
}

export function createHistoryPositionsQuery(input = {}) {
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    positionId: normalizeOptionalString({ value: input.positionId, field: "positionId" }),
    ...normalizeTimeRange({
      startTime: input.startTime,
      endTime: input.endTime,
    }),
    ...normalizePageQuery(input),
    subAccountId: normalizeInt64({
      value: input.subAccountId,
      field: "subAccountId",
    }),
  })
}

export function createPendingOrdersQuery(input = {}) {
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    orderId: normalizeOptionalString({ value: input.orderId, field: "orderId" }),
    clientId: normalizeOptionalString({ value: input.clientId, field: "clientId" }),
    status: normalizeOptionalString({ value: input.status, field: "status" }),
    ...normalizeTimeRange({
      startTime: input.startTime,
      endTime: input.endTime,
    }),
    ...normalizePageQuery(input),
  })
}

export function createHistoryOrdersQuery(input = {}, { now = Date.now() } = {}) {
  const range = normalizeHistoryOrderRange({ input, now })
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    orderId: normalizeOptionalString({ value: input.orderId, field: "orderId" }),
    clientId: normalizeOptionalString({ value: input.clientId, field: "clientId" }),
    status: normalizeOptionalString({ value: input.status, field: "status" }),
    type: normalizeOptionalString({ value: input.type, field: "type" }),
    ...range,
    ...normalizePageQuery(input),
    subAccountId: normalizeInt64({
      value: input.subAccountId,
      field: "subAccountId",
    }),
  })
}

export function createOrderDetailQuery({ orderId, clientId } = {}) {
  const normalizedOrderId = normalizeOptionalString({ value: orderId, field: "orderId" })
  const normalizedClientId = normalizeOptionalString({ value: clientId, field: "clientId" })
  if (normalizedOrderId === undefined && normalizedClientId === undefined) {
    throw new TypeError("Bitunix Futures order detail requires orderId or clientId")
  }
  return compactQuery({
    orderId: normalizedOrderId,
    clientId: normalizedClientId,
  })
}

export function createHistoryTradesQuery(input = {}) {
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    orderId: normalizeOptionalString({ value: input.orderId, field: "orderId" }),
    positionId: normalizeOptionalString({ value: input.positionId, field: "positionId" }),
    ...normalizeTimeRange({
      startTime: input.startTime,
      endTime: input.endTime,
    }),
    ...normalizePageQuery(input),
  })
}

export function createPendingTpSlQuery(input = {}) {
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    positionId: normalizeOptionalString({ value: input.positionId, field: "positionId" }),
    side: input.side === undefined ? undefined : normalizePositiveInteger({
      value: input.side,
      field: "side",
    }),
    positionMode: input.positionMode === undefined ? undefined : normalizePositiveInteger({
      value: input.positionMode,
      field: "positionMode",
    }),
    ...normalizePageQuery(input),
  })
}

export function createHistoryTpSlQuery(input = {}) {
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    side: input.side === undefined ? undefined : normalizePositiveInteger({
      value: input.side,
      field: "side",
    }),
    positionMode: input.positionMode === undefined ? undefined : normalizePositiveInteger({
      value: input.positionMode,
      field: "positionMode",
    }),
    ...normalizeTimeRange({
      startTime: input.startTime,
      endTime: input.endTime,
    }),
    ...normalizePageQuery(input),
  })
}
