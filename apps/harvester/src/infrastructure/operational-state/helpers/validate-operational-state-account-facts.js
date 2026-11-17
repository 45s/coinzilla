import { addDecimal, compareDecimal } from "@coinzilla/utils"
import { requireNonEmptyString } from "../operational-state-canonical.js"
import {
  MAX_FACT_ID_LENGTH,
  SHA256_PATTERN,
} from "./operational-state-fact-schema.js"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
} from "./operational-state-decimal-validation.js"

function validateAccountSnapshotMetadata({ canonicalData }) {
  const allowedFields = new Set(["phase", "auditStatus", "sourceTime", "assetCount", "balances", "auditReasons"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Account snapshot contains unsupported fields")
  }
  if (!["OPENING", "CLOSING", "PREFLIGHT", "RECOVERY", "COMMISSION_BASELINE"].includes(canonicalData.phase)) {
    throw new TypeError("Account snapshot phase is unsupported")
  }
  if (!["COMPLETE", "INCOMPLETE"].includes(canonicalData.auditStatus)) {
    throw new TypeError("Account snapshot auditStatus must be COMPLETE or INCOMPLETE")
  }
  if (!Number.isSafeInteger(canonicalData.sourceTime) || canonicalData.sourceTime < 0) {
    throw new TypeError("Account snapshot sourceTime must be a non-negative safe integer")
  }
  if (
    !Array.isArray(canonicalData.balances) ||
    !Number.isSafeInteger(canonicalData.assetCount) ||
    canonicalData.assetCount !== canonicalData.balances.length
  ) {
    throw new TypeError("Account snapshot assetCount must match its complete balances array")
  }
  if (
    canonicalData.phase === "COMMISSION_BASELINE" &&
    (canonicalData.auditStatus !== "COMPLETE" || canonicalData.balances.length !== 1)
  ) {
    throw new TypeError("COMMISSION_BASELINE account snapshot must be complete and contain exactly one fee-asset balance")
  }
  if (
    !Array.isArray(canonicalData.auditReasons) ||
    canonicalData.auditReasons.some((reason) =>
      typeof reason !== "string" || reason.trim() === "" || reason !== reason.trim()
    )
  ) {
    throw new TypeError("Account snapshot auditReasons must contain canonical non-empty strings")
  }
  if (canonicalData.auditStatus === "COMPLETE" && canonicalData.auditReasons.length > 0) {
    throw new TypeError("A COMPLETE account snapshot cannot contain auditReasons")
  }
  if (canonicalData.auditStatus === "INCOMPLETE" && canonicalData.auditReasons.length === 0) {
    throw new TypeError("An INCOMPLETE account snapshot requires auditReasons")
  }
}

function validateAccountSnapshotBalances({ balances }) {
  const assets = new Set()
  let previousAsset = null
  for (const [index, balance] of balances.entries()) {
    const allowedBalanceFields = new Set(["asset", "free", "locked", "total"])
    if (
      !balance ||
      typeof balance !== "object" ||
      Array.isArray(balance) ||
      Object.keys(balance).some((key) => !allowedBalanceFields.has(key))
    ) {
      throw new TypeError(`Account snapshot balance ${index} contains unsupported fields`)
    }
    const asset = requireNonEmptyString({
      value: balance.asset,
      field: `balances[${index}].asset`,
      maxLength: 32,
    })
    if (!/^[A-Z0-9]{2,32}$/.test(asset) || assets.has(asset)) {
      throw new TypeError("Account snapshot assets must be unique canonical uppercase asset codes")
    }
    if (previousAsset !== null && previousAsset.localeCompare(asset) >= 0) {
      throw new TypeError("Account snapshot balances must be sorted by canonical asset code")
    }
    previousAsset = asset
    assets.add(asset)
    for (const field of ["free", "locked", "total"]) {
      if (!isCanonicalDecimalString({ value: balance[field] })) {
        throw new TypeError(`Account snapshot ${field} balance must be a non-negative exact decimal string`)
      }
    }
    if (compareDecimal({
      left: balance.total,
      right: addDecimal({ left: balance.free,
right: balance.locked }),
    }) !== 0) {
      throw new TypeError("Account snapshot total balance must equal exact free plus locked quantities")
    }
  }
}

export function validateAccountSnapshotCapturedFact({ factType, canonicalData }) {
  if (factType !== "ACCOUNT_SNAPSHOT_CAPTURED") {
    return
  }
  validateAccountSnapshotMetadata({ canonicalData })
  validateAccountSnapshotBalances({ balances: canonicalData.balances })
}

function validateAccountOpenOrdersMetadata({ canonicalData }) {
  const allowedFields = new Set(["phase", "observedAt", "readiness", "orderCount", "orders", "blockReasons"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Account open-order snapshot contains unsupported fields")
  }
  if (!["OPENING", "PREFLIGHT", "RECOVERY"].includes(canonicalData.phase)) {
    throw new TypeError("Account open-order snapshot phase is unsupported")
  }
  if (!Number.isSafeInteger(canonicalData.observedAt) || canonicalData.observedAt < 0) {
    throw new TypeError("Account open-order snapshot observedAt must be a non-negative safe integer")
  }
  if (!["READY", "RECONCILED", "BLOCKED"].includes(canonicalData.readiness)) {
    throw new TypeError("Account open-order snapshot readiness is unsupported")
  }
  if (
    !Array.isArray(canonicalData.orders) ||
    !Number.isSafeInteger(canonicalData.orderCount) ||
    canonicalData.orderCount !== canonicalData.orders.length
  ) {
    throw new TypeError("Account open-order snapshot orderCount must match its orders array")
  }
  if (
    !Array.isArray(canonicalData.blockReasons) ||
    canonicalData.blockReasons.some((reason) =>
      typeof reason !== "string" || reason.trim() === "" || reason !== reason.trim()
    )
  ) {
    throw new TypeError("Account open-order blockReasons must contain canonical non-empty strings")
  }
}

function validateAccountOpenOrder({ order, index }) {
  const allowedOrderFields = new Set([
    "clientOrderId",
    "brokerOrderId",
    "symbol",
    "side",
    "type",
    "price",
    "quantity",
    "executedQuantity",
    "status",
  ])
  if (
    !order ||
    typeof order !== "object" ||
    Array.isArray(order) ||
    Object.keys(order).some((key) => !allowedOrderFields.has(key))
  ) {
    throw new TypeError(`Account open order ${index} contains unsupported fields`)
  }
  const brokerOrderId = requireNonEmptyString({
    value: order.brokerOrderId,
    field: `orders[${index}].brokerOrderId`,
    maxLength: MAX_FACT_ID_LENGTH,
  })
  const symbol = requireNonEmptyString({
    value: order.symbol,
    field: `orders[${index}].symbol`,
    maxLength: 32,
  })
  if (!/^[A-Z0-9]{3,30}$/.test(symbol)) {
    throw new TypeError("Account open-order symbol must be canonical uppercase alphanumeric")
  }
  if (order.clientOrderId !== undefined) {
    requireNonEmptyString({
      value: order.clientOrderId,
      field: `orders[${index}].clientOrderId`,
      maxLength: MAX_FACT_ID_LENGTH,
    })
  }
  if (order.side !== "BUY" && order.side !== "SELL") {
    throw new TypeError("Account open-order side must be BUY or SELL")
  }
  requireNonEmptyString({ value: order.type,
field: `orders[${index}].type`,
maxLength: 32 })
  if (
    order.price !== undefined &&
    !isPositiveCanonicalDecimalString({ value: order.price })
  ) {
    throw new TypeError("Account open-order price must be a positive exact decimal string when present")
  }
  if (
    !isPositiveCanonicalDecimalString({ value: order.quantity }) ||
    !isCanonicalDecimalString({ value: order.executedQuantity })
  ) {
    throw new TypeError("Account open-order quantities must be exact canonical decimal strings")
  }
  if (compareDecimal({ left: order.executedQuantity,
right: order.quantity }) > 0) {
    throw new TypeError("Account open-order executed quantity cannot exceed original quantity")
  }
  if (!["NEW", "OPEN", "PARTIALLY_FILLED"].includes(order.status)) {
    throw new TypeError("Account open-order status must be OPEN or PARTIALLY_FILLED")
  }
  return `${symbol}:${brokerOrderId}`
}

function validateAccountOpenOrderCollection({ orders }) {
  const orderIdentities = new Set()
  for (const [index, order] of orders.entries()) {
    const identity = validateAccountOpenOrder({ order,
index })
    if (orderIdentities.has(identity)) {
      throw new TypeError("Account open-order snapshot contains duplicate symbol/brokerOrderId identities")
    }
    orderIdentities.add(identity)
  }
}

function validateAccountOpenOrderReadiness({ canonicalData }) {
  if (
    canonicalData.readiness === "READY" &&
    (canonicalData.orders.length > 0 || canonicalData.blockReasons.length > 0)
  ) {
    throw new TypeError("READY account open-order snapshot requires no orders and no block reasons")
  }
  if (
    canonicalData.readiness === "RECONCILED" &&
    (canonicalData.orders.length === 0 || canonicalData.blockReasons.length > 0)
  ) {
    throw new TypeError("RECONCILED account open-order snapshot requires owned open orders and no block reasons")
  }
  if (canonicalData.readiness === "BLOCKED" && canonicalData.blockReasons.length === 0) {
    throw new TypeError("BLOCKED account open-order snapshot requires explicit blockReasons")
  }
}

export function validateAccountOpenOrdersCapturedFact({ factType, canonicalData }) {
  if (factType !== "ACCOUNT_OPEN_ORDERS_CAPTURED") {
    return
  }
  validateAccountOpenOrdersMetadata({ canonicalData })
  validateAccountOpenOrderCollection({ orders: canonicalData.orders })
  validateAccountOpenOrderReadiness({ canonicalData })
}

export function validateMarketHistoryCoverageConfirmedFact({ factType, canonicalData }) {
  if (factType === "MARKET_HISTORY_COVERAGE_CONFIRMED") {
    const allowedFields = new Set([
      "symbol",
      "coveredFromTime",
      "verifiedAt",
      "evidenceDigest",
      "verifiedBy",
    ])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Market-history coverage fact contains unsupported fields")
    }
    requireNonEmptyString({ value: canonicalData.symbol,
field: "data.symbol" })
    if (!/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Market-history coverage symbol must be canonical uppercase alphanumeric")
    }
    requireNonEmptyString({ value: canonicalData.verifiedBy,
field: "data.verifiedBy",
maxLength: MAX_FACT_ID_LENGTH })
    if (!Number.isSafeInteger(canonicalData.coveredFromTime) || canonicalData.coveredFromTime < 0 ||
        !Number.isSafeInteger(canonicalData.verifiedAt) || canonicalData.verifiedAt < canonicalData.coveredFromTime) {
      throw new TypeError("Market-history coverage timestamps must be non-negative safe integers with verifiedAt >= coveredFromTime")
    }
    if (typeof canonicalData.evidenceDigest !== "string" || !SHA256_PATTERN.test(canonicalData.evidenceDigest)) {
      throw new TypeError("Market-history coverage evidenceDigest must be a SHA-256 digest")
    }
  }
}
