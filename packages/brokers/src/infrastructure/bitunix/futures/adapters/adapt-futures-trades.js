import {
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"

const SIDES = new Set(["BUY", "SELL"])
const ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const POSITION_MODES = new Set(["ONE_WAY", "HEDGE"])
const MARGIN_MODES = new Set(["ISOLATION", "CROSS"])
const LIQUIDITY_ROLES = new Set(["MAKER", "TAKER"])

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures trade ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requireDecimal({ value, field, allowNegative = false, allowZero = true }) {
  assertDecimalString({
    value,
    field: `Bitunix Futures trade ${field}`,
  })
  const comparison = compareDecimal({
    left: value,
    right: "0",
  })
  if ((!allowNegative && comparison < 0) || (!allowZero && comparison === 0)) {
    throw new RangeError(`Bitunix Futures trade ${field} is outside the valid range`)
  }
  return value
}

function requireEnum({ value, values, field }) {
  if (!values.has(value)) {
    throw new TypeError(`Bitunix Futures trade ${field} is unsupported`)
  }
  return value
}

function requireTradeObject({ trade }) {
  if (trade === null || typeof trade !== "object" || Array.isArray(trade)) {
    throw new TypeError("Bitunix Futures trade should be an object")
  }
}

function normalizeTradeIdentity({ trade }) {
  const clientId = trade.clientId == null
    ? undefined
    : requireIdentifier({
      value: trade.clientId,
      field: "clientId",
    })
  return {
    tradeId: requireIdentifier({
      value: trade.tradeId,
      field: "tradeId",
    }),
    orderId: requireIdentifier({
      value: trade.orderId,
      field: "orderId",
    }),
    ...(clientId === undefined ? {} : { clientId }),
    symbol: requireIdentifier({
      value: trade.symbol,
      field: "symbol",
    }).toUpperCase(),
  }
}

function normalizeTradeExecution({ trade }) {
  return {
    quantity: requireDecimal({
      value: trade.qty,
      field: "qty",
      allowZero: false,
    }),
    price: requireDecimal({
      value: trade.price,
      field: "price",
      allowZero: false,
    }),
    side: requireEnum({
      value: trade.side,
      values: SIDES,
      field: "side",
    }),
    orderType: requireEnum({
      value: trade.orderType ?? trade.type,
      values: ORDER_TYPES,
      field: "orderType",
    }),
    liquidityRole: requireEnum({
      value: trade.roleType,
      values: LIQUIDITY_ROLES,
      field: "roleType",
    }),
  }
}

function normalizeTradePositionContext({ trade }) {
  if (!Number.isSafeInteger(trade.leverage) || trade.leverage <= 0) {
    throw new TypeError("Bitunix Futures trade leverage must be a positive safe integer")
  }
  if (typeof trade.reduceOnly !== "boolean") {
    throw new TypeError("Bitunix Futures trade reduceOnly must be a boolean")
  }
  return {
    positionMode: requireEnum({
      value: trade.positionMode,
      values: POSITION_MODES,
      field: "positionMode",
    }),
    marginMode: requireEnum({
      value: trade.marginMode,
      values: MARGIN_MODES,
      field: "marginMode",
    }),
    leverage: trade.leverage,
    ...(trade.effect === undefined ? {} : {
      effect: requireIdentifier({
        value: trade.effect,
        field: "effect",
      }),
    }),
    reduceOnly: trade.reduceOnly,
  }
}

function normalizeTradeFinancials({ trade }) {
  return {
    fee: requireDecimal({
      value: trade.fee,
      field: "fee",
    }),
    realizedPNL: requireDecimal({
      value: trade.realizedPNL,
      field: "realizedPNL",
      allowNegative: true,
    }),
  }
}

function normalizeTradeTimestamp({ trade }) {
  if (!Number.isSafeInteger(trade.ctime) || trade.ctime < 0) {
    throw new TypeError("Bitunix Futures trade ctime must be a non-negative safe integer")
  }
  return trade.ctime
}

function normalizeTrade({ trade }) {
  requireTradeObject({
    trade,
  })
  return Object.freeze({
    ...normalizeTradeIdentity({
      trade,
    }),
    ...normalizeTradeExecution({
      trade,
    }),
    ...normalizeTradePositionContext({
      trade,
    }),
    ...normalizeTradeFinancials({
      trade,
    }),
    executedAt: normalizeTradeTimestamp({
      trade,
    }),
  })
}

export function adaptFuturesTradeHistory({ rows } = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError("Bitunix Futures tradeList must be an array")
  }
  const trades = rows.map((trade) => normalizeTrade({
    trade,
  }))
  const tradeIds = new Set()
  for (const trade of trades) {
    if (tradeIds.has(trade.tradeId)) {
      throw new TypeError("Bitunix Futures trade history contains duplicate trade IDs")
    }
    tradeIds.add(trade.tradeId)
  }
  return Object.freeze(trades)
}
