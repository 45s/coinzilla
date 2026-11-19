const MAX_INT64 = 9_223_372_036_854_775_807n
const MAX_PAGE_SIZE = 100
const MAX_KLINE_LIMIT = 200
const MAX_FUNDING_HISTORY_LIMIT = 200
const KLINE_INTERVALS = new Set([
  "1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
])
const DEPTH_LIMITS = new Set(["1", "5", "15", "50", "max"])
const KLINE_PRICE_TYPES = new Set(["LAST_PRICE", "MARK_PRICE"])

function normalizeString({ value,
  field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Futures ${field} must be a non-empty string`)
  }
  return value.trim()
}

function normalizeSymbol({ symbol }) {
  return normalizeString({ value: symbol,
    field: "symbol" }).toUpperCase()
}

function normalizeSymbols({ symbols }) {
  if (symbols === undefined || symbols === null) {
    return undefined
  }

  let values
  if (Array.isArray(symbols)) {
    values = symbols
  } else if (typeof symbols === "string") {
    values = symbols.split(",")
  }
  if (!values || values.length === 0) {
    throw new TypeError("Bitunix Futures symbols must be a non-empty array or comma-separated string")
  }

  const normalized = values.map((symbol) => normalizeSymbol({ symbol }))
  if (normalized.some((symbol) => !symbol)) {
    throw new TypeError("Bitunix Futures symbols must not contain empty values")
  }
  return normalized.join(",")
}

function normalizeInt64({ value,
  field,
  defaultValue }) {
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

function normalizeOptionalString({ value,
  field }) {
  if (value === undefined || value === null) {
    return undefined
  }
  return normalizeString({ value,
    field })
}

function normalizeOptionalBoolean({ value,
  field }) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`Bitunix Futures ${field} must be a boolean`)
  }
  return value
}

function normalizePositiveInteger({ value,
  field,
  defaultValue,
  maximum }) {
  const normalized = value === undefined || value === null ? defaultValue : value
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`Bitunix Futures ${field} must be a positive integer`)
  }
  if (maximum !== undefined && normalized > maximum) {
    throw new RangeError(`Bitunix Futures ${field} must not exceed ${maximum}`)
  }
  return normalized
}

function normalizePagination({ skip,
  limit,
  maximum = MAX_PAGE_SIZE }) {
  return {
    skip: normalizeInt64({ value: skip,
      field: "skip",
      defaultValue: "0" }),
    limit: normalizePositiveInteger({
      value: limit,
      field: "limit",
      defaultValue: 10,
      maximum,
    }),
  }
}

function normalizeTimeRange({ startTime,
  endTime }) {
  const start = normalizeInt64({ value: startTime,
    field: "startTime" })
  const end = normalizeInt64({ value: endTime,
    field: "endTime" })
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
  const value = normalizeString({ value: interval,
    field: "interval" })
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

function normalizePageQuery(input) {
  return normalizePagination({
    skip: input.skip,
    limit: input.limit,
  })
}

function normalizeHistoryOrderRange({ input,
  now }) {
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
  if ((range.startTime !== undefined && (
    BigInt(range.startTime) < earliestAllowed || BigInt(range.startTime) > latestAllowed
  )) || (range.endTime !== undefined && (
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

export function createDepthQuery({ symbol,
  limit } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    limit: normalizeDepthLimit({ limit }),
  }
}

export function createKlinesQuery({ symbol,
  interval,
  endTime,
  limit,
  type } = {}) {
  return compactQuery({
    symbol: normalizeSymbol({ symbol }),
    interval: normalizeKlineInterval({ interval }),
    endTime: normalizeInt64({ value: endTime,
      field: "endTime" }),
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

export function createFundingHistoryQuery({ symbol,
  startTime,
  endTime,
  limit } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    ...normalizeTimeRange({ startTime,
      endTime }),
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
  return { marginCoin: normalizeString({ value: marginCoin,
    field: "marginCoin" }).toUpperCase() }
}

export function createTradingSettingsQuery({ symbols } = {}) {
  const normalizedSymbols = normalizeSymbols({ symbols })
  if (normalizedSymbols !== undefined && normalizedSymbols.split(",").length > 50) {
    throw new RangeError("Bitunix Futures trading settings accept at most 50 symbols")
  }
  return compactQuery({ symbols: normalizedSymbols })
}

export function createLeverageMarginModeQuery({ symbol,
  marginCoin } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    marginCoin: normalizeString({ value: marginCoin,
      field: "marginCoin" }).toUpperCase(),
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
    positionId: normalizeOptionalString({ value: positionId,
      field: "positionId" }),
    subAccountId: normalizeInt64({ value: subAccountId,
      field: "subAccountId" }),
    includeSubAccounts: normalizeOptionalBoolean({
      value: includeSubAccounts,
      field: "includeSubAccounts",
    }),
  })
}

export function createHistoryPositionsQuery(input = {}) {
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    positionId: normalizeOptionalString({ value: input.positionId,
      field: "positionId" }),
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
    orderId: normalizeOptionalString({ value: input.orderId,
      field: "orderId" }),
    clientId: normalizeOptionalString({ value: input.clientId,
      field: "clientId" }),
    status: normalizeOptionalString({ value: input.status,
      field: "status" }),
    ...normalizeTimeRange({
      startTime: input.startTime,
      endTime: input.endTime,
    }),
    ...normalizePageQuery(input),
  })
}

export function createHistoryOrdersQuery({ input = {}, now = Date.now() } = {}) {
  const range = normalizeHistoryOrderRange({ input,
    now })
  return compactQuery({
    symbol: input.symbol === undefined ? undefined : normalizeSymbol({ symbol: input.symbol }),
    orderId: normalizeOptionalString({ value: input.orderId,
      field: "orderId" }),
    clientId: normalizeOptionalString({ value: input.clientId,
      field: "clientId" }),
    status: normalizeOptionalString({ value: input.status,
      field: "status" }),
    type: normalizeOptionalString({ value: input.type,
      field: "type" }),
    ...range,
    ...normalizePageQuery(input),
    subAccountId: normalizeInt64({
      value: input.subAccountId,
      field: "subAccountId",
    }),
  })
}

export function createOrderDetailQuery({ orderId,
  clientId } = {}) {
  const normalizedOrderId = normalizeOptionalString({ value: orderId,
    field: "orderId" })
  const normalizedClientId = normalizeOptionalString({ value: clientId,
    field: "clientId" })
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
    orderId: normalizeOptionalString({ value: input.orderId,
      field: "orderId" }),
    positionId: normalizeOptionalString({ value: input.positionId,
      field: "positionId" }),
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
    positionId: normalizeOptionalString({ value: input.positionId,
      field: "positionId" }),
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


const FUTURES_SIDES = new Set(["BUY", "SELL"])
const FUTURES_TRADE_SIDES = new Set(["OPEN", "CLOSE"])
const FUTURES_ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const FUTURES_ORDER_EFFECTS = new Set(["GTC", "IOC", "FOK", "POST_ONLY"])
const FUTURES_MARGIN_MODES = new Set(["ISOLATION", "CROSS"])
const FUTURES_POSITION_MODES = new Set(["ONE_WAY", "HEDGE"])
const FUTURES_ASSET_TYPES = new Set(["SPOT", "FUTURES"])

function normalizeDecimal({ value, field, allowNegative = false }) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Bitunix Futures " + field + " must be an exact decimal string")
  }
  if (/^-?0(?:\.0+)?$/.test(value)) {
    throw new RangeError("Bitunix Futures " + field + " must not be zero")
  }
  if (!allowNegative && value.startsWith("-")) {
    throw new RangeError("Bitunix Futures " + field + " must be positive")
  }
  return value
}

function normalizeOptionalDecimal({ value, field, allowNegative = false }) {
  if (value === undefined || value === null) {
    return undefined
  }
  return normalizeDecimal({
    value,
    field,
    allowNegative,
  })
}

function normalizeEnum({ value, field, allowed }) {
  const normalized = normalizeString({ value, field }).toUpperCase()
  if (!allowed.has(normalized)) {
    throw new TypeError("Bitunix Futures " + field + " is not a documented value")
  }
  return normalized
}

function normalizeOptionalEnum({ value, field, allowed }) {
  if (value === undefined || value === null) {
    return undefined
  }
  return normalizeEnum({
    value,
    field,
    allowed,
  })
}

function normalizeStopType({ value, field }) {
  if (value === undefined || value === null) {
    return undefined
  }
  const aliases = {
    MARK: "MARK_PRICE",
    LAST: "LAST_PRICE",
  }
  const normalized = normalizeString({ value, field }).toUpperCase()
  const canonical = aliases[normalized] || normalized
  if (canonical !== "MARK_PRICE" && canonical !== "LAST_PRICE") {
    throw new TypeError("Bitunix Futures " + field + " must be MARK_PRICE or LAST_PRICE")
  }
  return canonical
}

function normalizeOptionalStopType({ value, field }) {
  if (value === undefined || value === null) {
    return undefined
  }
  return normalizeStopType({
    value,
    field,
  })
}

function normalizeOrderIdentity({ orderId, clientId }) {
  const normalizedOrderId = normalizeOptionalString({
    value: orderId,
    field: "orderId",
  })
  const normalizedClientId = normalizeOptionalString({
    value: clientId,
    field: "clientId",
  })
  if (normalizedOrderId === undefined && normalizedClientId === undefined) {
    throw new TypeError("Bitunix Futures order identity requires orderId or clientId")
  }
  return {
    ...(normalizedOrderId === undefined ? {} : { orderId: normalizedOrderId }),
    ...(normalizedClientId === undefined ? {} : { clientId: normalizedClientId }),
  }
}

function normalizeTpSlFields({ input, includeQuantity = false, defaultOrderType = false }) {
  const tpPrice = normalizeOptionalDecimal({
    value: input.tpPrice,
    field: "tpPrice",
  })
  const slPrice = normalizeOptionalDecimal({
    value: input.slPrice,
    field: "slPrice",
  })
  const tpStopType = normalizeOptionalStopType({
    value: input.tpStopType,
    field: "tpStopType",
  })
  const slStopType = normalizeOptionalStopType({
    value: input.slStopType,
    field: "slStopType",
  })
  const tpOrderType = normalizeOptionalEnum({
    value: input.tpOrderType ?? (defaultOrderType && tpPrice !== undefined ? "MARKET" : undefined),
    field: "tpOrderType",
    allowed: FUTURES_ORDER_TYPES,
  })
  const slOrderType = normalizeOptionalEnum({
    value: input.slOrderType ?? (defaultOrderType && slPrice !== undefined ? "MARKET" : undefined),
    field: "slOrderType",
    allowed: FUTURES_ORDER_TYPES,
  })
  const tpOrderPrice = normalizeOptionalDecimal({
    value: input.tpOrderPrice,
    field: "tpOrderPrice",
  })
  const slOrderPrice = normalizeOptionalDecimal({
    value: input.slOrderPrice,
    field: "slOrderPrice",
  })
  const tpQty = includeQuantity
    ? normalizeOptionalDecimal({ value: input.tpQty, field: "tpQty" })
    : undefined
  const slQty = includeQuantity
    ? normalizeOptionalDecimal({ value: input.slQty, field: "slQty" })
    : undefined

  if (tpPrice === undefined && (
    tpStopType !== undefined || tpOrderType !== undefined || tpOrderPrice !== undefined || tpQty !== undefined
  )) {
    throw new TypeError("Bitunix Futures TP order fields require tpPrice")
  }
  if (slPrice === undefined && (
    slStopType !== undefined || slOrderType !== undefined || slOrderPrice !== undefined || slQty !== undefined
  )) {
    throw new TypeError("Bitunix Futures SL order fields require slPrice")
  }
  if (tpPrice !== undefined && includeQuantity && tpQty === undefined) {
    throw new TypeError("Bitunix Futures tpQty is required when tpPrice is supplied")
  }
  if (slPrice !== undefined && includeQuantity && slQty === undefined) {
    throw new TypeError("Bitunix Futures slQty is required when slPrice is supplied")
  }
  if (tpOrderType === "LIMIT" && tpOrderPrice === undefined) {
    throw new TypeError("Bitunix Futures tpOrderPrice is required for LIMIT TP orders")
  }
  if (slOrderType === "LIMIT" && slOrderPrice === undefined) {
    throw new TypeError("Bitunix Futures slOrderPrice is required for LIMIT SL orders")
  }
  if (tpOrderType === "MARKET" && tpOrderPrice !== undefined) {
    throw new TypeError("Bitunix Futures tpOrderPrice is not valid for MARKET TP orders")
  }
  if (slOrderType === "MARKET" && slOrderPrice !== undefined) {
    throw new TypeError("Bitunix Futures slOrderPrice is not valid for MARKET SL orders")
  }

  return compactQuery({
    tpPrice,
    tpStopType,
    tpOrderType,
    tpOrderPrice,
    tpQty,
    slPrice,
    slStopType,
    slOrderType,
    slOrderPrice,
    slQty,
  })
}

function normalizeOrderFields({ input }) {
  const qty = normalizeDecimal({
    value: input.qty,
    field: "qty",
  })
  const side = normalizeEnum({
    value: input.side,
    field: "side",
    allowed: FUTURES_SIDES,
  })
  const tradeSide = normalizeEnum({
    value: input.tradeSide,
    field: "tradeSide",
    allowed: FUTURES_TRADE_SIDES,
  })
  const orderType = normalizeEnum({
    value: input.orderType,
    field: "orderType",
    allowed: FUTURES_ORDER_TYPES,
  })
  const positionId = normalizeOptionalString({
    value: input.positionId,
    field: "positionId",
  })
  const price = normalizeOptionalDecimal({
    value: input.price,
    field: "price",
  })
  const effect = normalizeOptionalEnum({
    value: input.effect ?? (orderType === "LIMIT" ? "GTC" : undefined),
    field: "effect",
    allowed: FUTURES_ORDER_EFFECTS,
  })
  const clientId = normalizeString({
    value: input.clientId,
    field: "clientId",
  })
  const reduceOnly = normalizeOptionalBoolean({
    value: input.reduceOnly,
    field: "reduceOnly",
  })

  if (tradeSide === "CLOSE" && positionId === undefined) {
    throw new TypeError("Bitunix Futures close orders require positionId")
  }
  if (orderType === "LIMIT" && price === undefined) {
    throw new TypeError("Bitunix Futures LIMIT orders require price")
  }
  if (orderType === "MARKET" && price !== undefined) {
    throw new TypeError("Bitunix Futures MARKET orders must not include price")
  }
  if (orderType === "MARKET" && effect !== undefined) {
    throw new TypeError("Bitunix Futures MARKET orders must not include effect")
  }

  return compactQuery({
    qty,
    price,
    side,
    tradeSide,
    positionId,
    orderType,
    effect,
    clientId,
    reduceOnly,
    ...normalizeTpSlFields({ input }),
  })
}

export function createPlaceOrderBody(input = {}) {
  return {
    symbol: normalizeSymbol({ symbol: input.symbol }),
    ...normalizeOrderFields({ input }),
  }
}

export function createBatchOrderBody(input = {}) {
  const symbol = normalizeSymbol({ symbol: input.symbol })
  if (!Array.isArray(input.orderList) || input.orderList.length < 1 || input.orderList.length > 5) {
    throw new RangeError("Bitunix Futures batch orderList must contain between 1 and 5 orders")
  }
  const orderList = input.orderList.map((order) => normalizeOrderFields({ input: order }))
  const clientIds = orderList.map((order) => order.clientId)
  if (new Set(clientIds).size !== clientIds.length) {
    throw new TypeError("Bitunix Futures batch orders require unique clientId values")
  }
  return {
    symbol,
    orderList,
  }
}

export function createModifyOrderBody(input = {}) {
  const symbol = normalizeSymbol({ symbol: input.symbol })
  const orderId = normalizeString({
    value: input.orderId,
    field: "orderId",
  })
  const qty = normalizeDecimal({
    value: input.qty,
    field: "qty",
  })
  const price = normalizeDecimal({
    value: input.price,
    field: "price",
  })
  const clientId = normalizeOptionalString({
    value: input.clientId,
    field: "clientId",
  })
  const effect = normalizeOptionalEnum({
    value: input.effect,
    field: "effect",
    allowed: FUTURES_ORDER_EFFECTS,
  })
  const reduceOnly = normalizeOptionalBoolean({
    value: input.reduceOnly,
    field: "reduceOnly",
  })
  return compactQuery({
    symbol,
    orderId,
    qty,
    price,
    clientId,
    effect,
    reduceOnly,
    ...normalizeTpSlFields({ input }),
  })
}

export function createCancelOrdersBody(input = {}) {
  const symbol = normalizeSymbol({ symbol: input.symbol })
  if (!Array.isArray(input.orderList) || input.orderList.length === 0) {
    throw new TypeError("Bitunix Futures cancel orderList must be a non-empty array")
  }
  const orderList = input.orderList.map((item) => normalizeOrderIdentity(item))
  return {
    symbol,
    orderList,
  }
}

export function createCancelAllOrdersBody({ symbol } = {}) {
  return compactQuery({
    symbol: symbol === undefined ? undefined : normalizeSymbol({ symbol }),
  })
}

export function createCloseAllPositionBody({ symbol } = {}) {
  return compactQuery({
    symbol: symbol === undefined ? undefined : normalizeSymbol({ symbol }),
  })
}

export function createFlashClosePositionBody({ positionId } = {}) {
  return {
    positionId: normalizeString({
      value: positionId,
      field: "positionId",
    }),
  }
}

export function createAdjustPositionMarginBody(input = {}) {
  const symbol = normalizeSymbol({ symbol: input.symbol })
  const marginCoin = normalizeString({
    value: input.marginCoin,
    field: "marginCoin",
  }).toUpperCase()
  const amount = normalizeDecimal({
    value: input.amount,
    field: "amount",
    allowNegative: true,
  })
  const side = input.side === undefined || input.side === null
    ? undefined
    : normalizeEnum({
      value: input.side,
      field: "side",
      allowed: new Set(["LONG", "SHORT"]),
    })
  const positionId = normalizeOptionalString({
    value: input.positionId,
    field: "positionId",
  })
  if ((side === undefined) === (positionId === undefined)) {
    throw new TypeError("Bitunix Futures margin adjustment requires exactly one of side or positionId")
  }
  return compactQuery({
    symbol,
    marginCoin,
    amount,
    side,
    positionId,
  })
}

export function createChangeLeverageBody({ symbol, marginCoin, leverage } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    marginCoin: normalizeString({ value: marginCoin, field: "marginCoin" }).toUpperCase(),
    leverage: normalizePositiveInteger({
      value: leverage,
      field: "leverage",
    }),
  }
}

export function createChangeMarginModeBody({ symbol, marginCoin, marginMode } = {}) {
  return {
    symbol: normalizeSymbol({ symbol }),
    marginCoin: normalizeString({ value: marginCoin, field: "marginCoin" }).toUpperCase(),
    marginMode: normalizeEnum({
      value: marginMode,
      field: "marginMode",
      allowed: FUTURES_MARGIN_MODES,
    }),
  }
}

export function createChangePositionModeBody({ positionMode } = {}) {
  return {
    positionMode: normalizeEnum({
      value: positionMode,
      field: "positionMode",
      allowed: FUTURES_POSITION_MODES,
    }),
  }
}

export function createPlacePositionTpSlBody(input = {}) {
  const symbol = normalizeSymbol({ symbol: input.symbol })
  const positionId = normalizeString({
    value: input.positionId,
    field: "positionId",
  })
  const fields = normalizeTpSlFields({ input })
  if (fields.tpPrice === undefined && fields.slPrice === undefined) {
    throw new TypeError("Bitunix Futures position TP/SL requires tpPrice or slPrice")
  }
  return {
    symbol,
    positionId,
    ...fields,
  }
}

export function createPlaceTpSlBody(input = {}) {
  const symbol = normalizeSymbol({ symbol: input.symbol })
  const positionId = normalizeString({
    value: input.positionId,
    field: "positionId",
  })
  const fields = normalizeTpSlFields({
    input,
    includeQuantity: true,
    defaultOrderType: true,
  })
  if (fields.tpPrice === undefined && fields.slPrice === undefined) {
    throw new TypeError("Bitunix Futures TP/SL order requires tpPrice or slPrice")
  }
  return {
    symbol,
    positionId,
    ...fields,
  }
}

export function createModifyPositionTpSlBody(input = {}) {
  return createPlacePositionTpSlBody(input)
}

export function createModifyTpSlBody(input = {}) {
  const orderId = normalizeString({
    value: input.orderId,
    field: "orderId",
  })
  const fields = normalizeTpSlFields({
    input,
    includeQuantity: true,
  })
  if (fields.tpPrice === undefined && fields.slPrice === undefined) {
    throw new TypeError("Bitunix Futures TP/SL modification requires tpPrice or slPrice")
  }
  return {
    orderId,
    ...fields,
  }
}

export function createCancelTpSlBody({ orderId } = {}) {
  return {
    orderId: normalizeString({
      value: orderId,
      field: "orderId",
    }),
  }
}

export function createCopyTradingTransferBody({ assetType, amount } = {}) {
  return {
    assetType: normalizeEnum({
      value: assetType,
      field: "assetType",
      allowed: FUTURES_ASSET_TYPES,
    }),
    amount: normalizeDecimal({
      value: amount,
      field: "amount",
    }),
  }
}
