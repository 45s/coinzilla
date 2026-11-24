import {
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"

const SIDES = new Set(["LONG", "SHORT"])
const POSITION_MODES = new Set(["ONE_WAY", "HEDGE"])
const MARGIN_MODES = new Set(["ISOLATION", "CROSS"])

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures position ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requireDecimal({ value, field, allowNegative = false, allowZero = true }) {
  assertDecimalString({
    value,
    field: `Bitunix Futures position ${field}`,
  })
  const comparison = compareDecimal({
    left: value,
    right: "0",
  })
  if ((!allowNegative && comparison < 0) || (!allowZero && comparison === 0)) {
    throw new RangeError(`Bitunix Futures position ${field} is outside the valid range`)
  }
  return value
}

function requireTimestamp({ value, field }) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Bitunix Futures position ${field} must be a non-negative safe integer`)
  }
  return value
}

function requireLeverage({ value }) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Bitunix Futures position leverage must be a positive safe integer")
  }
  return value
}

function requireEnum({ value, values, field }) {
  if (!values.has(value)) {
    throw new TypeError(`Bitunix Futures position ${field} is unsupported`)
  }
  return value
}

function requirePositionObject({ position, lifecycle }) {
  if (position === null || typeof position !== "object" || Array.isArray(position)) {
    throw new TypeError(`Bitunix Futures ${lifecycle.toLowerCase()} position should be an object`)
  }
}

function normalizePositionContext({ position }) {
  return {
    positionId: requireIdentifier({
      value: position.positionId,
      field: "positionId",
    }),
    symbol: requireIdentifier({
      value: position.symbol,
      field: "symbol",
    }).toUpperCase(),
    side: requireEnum({
      value: position.side,
      values: SIDES,
      field: "side",
    }),
    positionMode: requireEnum({
      value: position.positionMode,
      values: POSITION_MODES,
      field: "positionMode",
    }),
    marginMode: requireEnum({
      value: position.marginMode,
      values: MARGIN_MODES,
      field: "marginMode",
    }),
    leverage: requireLeverage({
      value: position.leverage,
    }),
  }
}

function normalizeSubAccountId({ position }) {
  if (position.subAccountId === undefined || position.subAccountId === null) {
    return {}
  }
  if (!Number.isSafeInteger(position.subAccountId) || position.subAccountId < 0) {
    throw new TypeError("Bitunix Futures position subAccountId must be a non-negative safe integer")
  }
  return {
    subAccountId: position.subAccountId,
  }
}

function normalizePositionTimestamps({ position }) {
  return {
    createdAt: requireTimestamp({
      value: position.ctime,
      field: "ctime",
    }),
    updatedAt: requireTimestamp({
      value: position.mtime,
      field: "mtime",
    }),
  }
}

function normalizeCurrentPositionAmounts({ position }) {
  return {
    quantity: requireDecimal({
      value: position.qty,
      field: "qty",
      allowZero: false,
    }),
    entryValue: requireDecimal({
      value: position.entryValue,
      field: "entryValue",
      allowZero: false,
    }),
    fee: requireDecimal({
      value: position.fee,
      field: "fee",
    }),
    funding: requireDecimal({
      value: position.funding,
      field: "funding",
      allowNegative: true,
    }),
    realizedPNL: requireDecimal({
      value: position.realizedPNL,
      field: "realizedPNL",
      allowNegative: true,
    }),
    margin: requireDecimal({
      value: position.margin,
      field: "margin",
    }),
    unrealizedPNL: requireDecimal({
      value: position.unrealizedPNL,
      field: "unrealizedPNL",
      allowNegative: true,
    }),
    liquidationPrice: requireDecimal({
      value: position.liqPrice,
      field: "liqPrice",
    }),
    marginRate: requireDecimal({
      value: position.marginRate,
      field: "marginRate",
    }),
    entryPrice: requireDecimal({
      value: position.avgOpenPrice,
      field: "avgOpenPrice",
      allowZero: false,
    }),
  }
}

function normalizeHistoricalPositionAmounts({ position }) {
  return {
    quantity: requireDecimal({
      value: position.maxQty,
      field: "maxQty",
      allowZero: false,
    }),
    entryPrice: requireDecimal({
      value: position.entryPrice,
      field: "entryPrice",
      allowZero: false,
    }),
    closePrice: requireDecimal({
      value: position.closePrice,
      field: "closePrice",
    }),
    liquidatedQuantity: requireDecimal({
      value: position.liqQty,
      field: "liqQty",
    }),
    fee: requireDecimal({
      value: position.fee,
      field: "fee",
    }),
    funding: requireDecimal({
      value: position.funding,
      field: "funding",
      allowNegative: true,
    }),
    realizedPNL: requireDecimal({
      value: position.realizedPNL,
      field: "realizedPNL",
      allowNegative: true,
    }),
    liquidationPrice: requireDecimal({
      value: position.liqPrice,
      field: "liqPrice",
    }),
  }
}

function normalizeCurrentPosition({ position }) {
  requirePositionObject({
    position,
    lifecycle: "Current",
  })
  return Object.freeze({
    ...normalizePositionContext({
      position,
    }),
    ...normalizeSubAccountId({
      position,
    }),
    ...normalizeCurrentPositionAmounts({
      position,
    }),
    ...normalizePositionTimestamps({
      position,
    }),
    lifecycle: "CURRENT",
  })
}

function normalizeHistoricalPosition({ position }) {
  requirePositionObject({
    position,
    lifecycle: "Historical",
  })
  return Object.freeze({
    ...normalizePositionContext({
      position,
    }),
    ...normalizeSubAccountId({
      position,
    }),
    ...normalizeHistoricalPositionAmounts({
      position,
    }),
    ...normalizePositionTimestamps({
      position,
    }),
    lifecycle: "HISTORICAL",
  })
}

export function adaptFuturesCurrentPositions({ rows } = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError("Bitunix Futures pending positions response must be an array")
  }
  return Object.freeze(rows.map((position) => normalizeCurrentPosition({
    position,
  })))
}

export function adaptFuturesHistoricalPositions({ rows } = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError("Bitunix Futures historical positionList must be an array")
  }
  return Object.freeze(rows.map((position) => normalizeHistoricalPosition({
    position,
  })))
}
