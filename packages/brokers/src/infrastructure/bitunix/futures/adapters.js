const DECIMAL_PATTERN = /^-?\\d+(?:\\.\\d+)?$/
const INT64_PATTERN = /^(?:0|[1-9]\\d*)$/

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Bitunix Futures ${field} must be an object`)
  }
  return value
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix Futures ${field} must be an array`)
  }
  return value
}

function requireString(record, field, path) {
  const value = record[field]
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Futures ${path}.${field} must be a non-empty string`)
  }
}

function requireDecimal(record, field, path) {
  const value = record[field]
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`Bitunix Futures ${path}.${field} must be an exact decimal string`)
  }
}

function requireInteger(record, field, path) {
  const value = record[field]
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Bitunix Futures ${path}.${field} must be a safe integer`)
  }
}

function requireInt64(record, field, path) {
  const value = record[field]
  if (typeof value !== "string" || !INT64_PATTERN.test(value)) {
    throw new TypeError(`Bitunix Futures ${path}.${field} must be an exact non-negative int64 string`)
  }
}

function requireBoolean(record, field, path) {
  if (typeof record[field] !== "boolean") {
    throw new TypeError(`Bitunix Futures ${path}.${field} must be a boolean`)
  }
}

function validateRecord(record, {
  path,
  strings = [],
  optionalStrings = [],
  decimals = [],
  integers = [],
  int64 = [],
  booleans = [],
}) {
  requireRecord(record, path)
  strings.forEach((field) => requireString(record, field, path))
  optionalStrings.forEach((field) => {
    if (record[field] !== undefined && record[field] !== null &&
        typeof record[field] !== "string") {
      throw new TypeError(`Bitunix Futures ${path}.${field} must be a string when present`)
    }
  })
  decimals.forEach((field) => {
    if (record[field] !== undefined && record[field] !== null) {
      requireDecimal(record, field, path)
    }
  })
  integers.forEach((field) => {
    if (record[field] !== undefined && record[field] !== null) {
      requireInteger(record, field, path)
    }
  })
  int64.forEach((field) => {
    if (record[field] !== undefined && record[field] !== null) {
      requireInt64(record, field, path)
    }
  })
  booleans.forEach((field) => {
    if (record[field] !== undefined && record[field] !== null) {
      requireBoolean(record, field, path)
    }
  })
  return Object.freeze({ ...record })
}

function adaptRows(data, spec, path) {
  return Object.freeze(requireArray(data, path).map((row, index) => (
    validateRecord(row, { ...spec,
      path: `${path}[${index}]` })
  )))
}

function adaptPage(data, { listField,
  spec,
  path }) {
  requireRecord(data, path)
  const items = adaptRows(data[listField], spec, `${path}.${listField}`)
  requireInt64(data, "total", path)
  return Object.freeze({
    ...data,
    [listField]: items,
  })
}

function adaptOrderBook(data) {
  requireRecord(data, "market/depth data")
  for (const side of ["asks", "bids"]) {
    const levels = requireArray(data[side], `market/depth ${side}`)
    levels.forEach((level, index) => {
      if (!Array.isArray(level) || level.length !== 2) {
        throw new TypeError(`Bitunix Futures market/depth ${side}[${index}] must be a [price, quantity] pair`)
      }
      level.forEach((value, valueIndex) => {
        if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
          throw new TypeError(`Bitunix Futures market/depth ${side}[${index}][${valueIndex}] must be an exact decimal string`)
        }
      })
    })
  }
  return Object.freeze({
    ...data,
    asks: Object.freeze(data.asks.map((level) => Object.freeze([...level]))),
    bids: Object.freeze(data.bids.map((level) => Object.freeze([...level]))),
  })
}

export function adaptFuturesTradingPairs(data) {
  return adaptRows(data, {
    strings: ["symbol", "base", "quote", "symbolStatus"],
    decimals: [
      "minTradeVolume",
      "minBuyPriceOffset",
      "maxSellPriceOffset",
      "maxLimitOrderVolume",
      "maxMarketOrderVolume",
      "maxFundingRate",
      "minFundingRate",
      "priceProtectScope",
    ],
    integers: ["basePrecision", "quotePrecision", "maxLeverage", "minLeverage", "defaultLeverage"],
    int64: ["launchTime", "delistTime"],
    booleans: ["isApiSupported"],
    path: "market/trading_pairs",
  }, "market/trading_pairs")
}

export function adaptFuturesTickers(data) {
  return adaptRows(data, {
    strings: ["symbol"],
    decimals: ["markPrice", "lastPrice", "open", "last", "quoteVol", "baseVol", "high", "low"],
    path: "market/tickers",
  }, "market/tickers")
}

export function adaptFuturesDepth(data) {
  return adaptOrderBook(data)
}

export function adaptFuturesKlines(data) {
  return adaptRows(data, {
    strings: ["type"],
    decimals: ["open", "high", "low", "close", "quoteVol", "baseVol"],
    int64: ["time"],
    path: "market/kline",
  }, "market/kline")
}

export function adaptFuturesFundingRates(data) {
  return adaptRows(data, {
    strings: ["symbol"],
    decimals: [
      "markPrice",
      "lastPrice",
      "indexPrice",
      "fundingRate",
      "maxFundingRate",
      "minFundingRate",
    ],
    integers: ["fundingInterval"],
    int64: ["nextFundingTime"],
    path: "market/funding_rate",
  }, "market/funding_rate")
}

export function adaptFuturesFundingHistory(data) {
  return adaptRows(data, {
    decimals: ["fundingRate", "markPrice"],
    int64: ["fundingTime"],
    path: "market/funding_rate/history",
  }, "market/funding_rate/history")
}

export function adaptFuturesPositionTiers(data) {
  return adaptRows(data, {
    strings: ["symbol"],
    decimals: ["startValue", "endValue", "maintenanceMarginRate"],
    integers: ["level", "leverage"],
    path: "position/tiers",
  }, "position/tiers")
}

export function adaptFuturesAccounts(data) {
  return adaptRows(data, {
    strings: ["marginCoin", "positionMode"],
    decimals: [
      "available",
      "frozen",
      "margin",
      "transfer",
      "crossUnrealizedPNL",
      "isolationUnrealizedPNL",
      "bonus",
    ],
    path: "account",
  }, "account")
}

export function adaptFuturesTradingSettings(data) {
  return adaptRows(data, {
    strings: ["symbol", "marginCoin", "marginMode"],
    integers: ["leverage", "longLeverage", "shortLeverage"],
    path: "account/trading_settings",
  }, "account/trading_settings")
}

export function adaptFuturesLeverageMarginMode(data) {
  return validateRecord(data, {
    strings: ["symbol", "marginCoin", "marginMode"],
    integers: ["leverage"],
    path: "account/get_leverage_margin_mode",
  })
}

export function adaptFuturesPositionMode(data) {
  return validateRecord(data, {
    strings: ["positionMode"],
    path: "account/position_mode",
  })
}

export function adaptFuturesPendingPositions(data) {
  return adaptRows(data, {
    strings: ["positionId", "symbol", "side", "marginMode", "positionMode"],
    decimals: [
      "qty",
      "entryValue",
      "fee",
      "funding",
      "realizedPNL",
      "margin",
      "unrealizedPNL",
      "liqPrice",
      "marginRate",
      "avgOpenPrice",
    ],
    integers: ["leverage"],
    int64: ["ctime", "mtime", "subAccountId"],
    path: "position/get_pending_positions",
  }, "position/get_pending_positions")
}

export function adaptFuturesHistoryPositions(data) {
  return adaptPage(data, {
    listField: "positionList",
    spec: {
      strings: ["positionId", "symbol", "side", "marginMode", "positionMode"],
      decimals: [
        "maxQty",
        "entryPrice",
        "closePrice",
        "liqQty",
        "fee",
        "funding",
        "realizedPNL",
        "liqPrice",
      ],
      integers: ["leverage"],
      int64: ["ctime", "mtime", "subAccountId"],
    },
    path: "position/get_history_positions",
  })
}

const ORDER_SPEC = Object.freeze({
  strings: ["orderId", "symbol", "positionMode", "marginMode", "side", "status"],
  optionalStrings: ["clientId", "orderType", "type", "effect", "source"],
  decimals: [
    "qty",
    "tradeQty",
    "price",
    "fee",
    "realizedPNL",
    "tpPrice",
    "tpOrderPrice",
    "slPrice",
    "slOrderPrice",
  ],
  integers: ["leverage"],
  int64: ["ctime", "mtime", "subAccountId"],
  booleans: ["reduceOnly"],
})

function normalizeOrderType(record) {
  const orderType = record.orderType ?? record.type
  if (typeof orderType !== "string" || !orderType) {
    throw new TypeError("Bitunix Futures order record must include orderType or the documented type alias")
  }
  return {
    ...record,
    orderType,
  }
}

function adaptOrderRows(data, { listField,
  path }) {
  requireRecord(data, path)
  const rows = requireArray(data[listField], `${path}.${listField}`)
  const items = Object.freeze(rows.map((row, index) => (
    validateRecord(normalizeOrderType(row), {
      ...ORDER_SPEC,
      path: `${path}.${listField}[${index}]`,
    })
  )))
  requireInt64(data, "total", path)
  return Object.freeze({
    ...data,
    [listField]: items,
  })
}

export function adaptFuturesPendingOrders(data) {
  return adaptOrderRows(data, {
    listField: "orderList",
    path: "trade/get_pending_orders",
  })
}

export function adaptFuturesHistoryOrders(data) {
  return adaptOrderRows(data, {
    listField: "orderList",
    path: "trade/get_history_orders",
  })
}

export function adaptFuturesOrderDetail(data) {
  if (data === null) {
    return null
  }
  return validateRecord(normalizeOrderType(data), {
    ...ORDER_SPEC,
    path: "trade/get_order_detail",
  })
}

export function adaptFuturesHistoryTrades(data) {
  requireRecord(data, "trade/get_history_trades")
  const trades = requireArray(data.tradeList, "trade/get_history_trades.tradeList")
  const tradeList = Object.freeze(trades.map((trade, index) => {
    const normalized = normalizeOrderType(trade)
    return validateRecord(normalized, {
      path: `trade/get_history_trades.tradeList[${index}]`,
      strings: ["tradeId", "orderId", "symbol", "side"],
      optionalStrings: ["clientId", "orderType", "type", "effect", "roleType"],
      decimals: ["qty", "price", "fee", "realizedPNL"],
      integers: ["leverage"],
      int64: ["ctime", "subAccountId"],
      booleans: ["reduceOnly"],
    })
  }))
  requireInt64(data, "total", "trade/get_history_trades")
  return Object.freeze({
    ...data,
    tradeList,
  })
}

const TP_SL_SPEC = Object.freeze({
  strings: ["id", "positionId", "symbol"],
  decimals: ["tpPrice", "slPrice", "tpOrderPrice", "slOrderPrice", "tpQty", "slQty"],
  int64: ["ctime", "triggerTime"],
})

export function adaptFuturesPendingTpSlOrders(data) {
  return adaptRows(data, {
    ...TP_SL_SPEC,
    path: "tpsl/get_pending_orders",
  }, "tpsl/get_pending_orders")
}

export function adaptFuturesHistoryTpSlOrders(data) {
  if (Array.isArray(data)) {
    return adaptRows(data, {
      ...TP_SL_SPEC,
      path: "tpsl/get_history_orders",
    }, "tpsl/get_history_orders")
  }
  return adaptPage(data, {
    listField: "orderList",
    spec: TP_SL_SPEC,
    path: "tpsl/get_history_orders",
  })
}

export function adaptFuturesCopyTradingAssets(data) {
  return validateRecord(data, {
    decimals: ["available", "maxTransfer"],
    path: "copyTrading/asset/query",
  })
}
