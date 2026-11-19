import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"

const ALLOWED_FIELDS = new Set([
  "recoverySellQuantity",
  "legacySellQuantity",
])

function assertAllocationShape({ sellAllocation } = {}) {
  if (!sellAllocation || typeof sellAllocation !== "object" || Array.isArray(sellAllocation)) {
    throw new TypeError("Recovery Seller SELL allocation must be an object")
  }
  if (Object.keys(sellAllocation).some((field) => !ALLOWED_FIELDS.has(field))) {
    throw new TypeError("Recovery Seller SELL allocation contains unsupported fields")
  }
}

function assertAllocationQuantities({ sellAllocation, quantity } = {}) {
  assertDecimalString({
    value: sellAllocation.recoverySellQuantity,
    field: "sellAllocation.recoverySellQuantity",
  })
  assertDecimalString({
    value: sellAllocation.legacySellQuantity,
    field: "sellAllocation.legacySellQuantity",
  })
  if (quantity !== undefined) {
    assertDecimalString({
      value: quantity,
      field: "order quantity",
    })
  }
  if (compareDecimal({
    left: sellAllocation.recoverySellQuantity,
    right: "0",
  }) <= 0) {
    throw new RangeError("recoverySellQuantity must be greater than zero")
  }
  if (compareDecimal({
    left: sellAllocation.legacySellQuantity,
    right: "0",
  }) < 0) {
    throw new RangeError("legacySellQuantity must be non-negative")
  }
  if (quantity !== undefined) {
    const allocatedQuantity = addDecimal({
      left: sellAllocation.recoverySellQuantity,
      right: sellAllocation.legacySellQuantity,
    })
    if (compareDecimal({
      left: allocatedQuantity,
      right: quantity,
    }) !== 0) {
      throw new RangeError("Recovery Seller SELL allocation must equal the canonical order quantity")
    }
  }
}

export function normalizeRecoverySellerSellAllocation({
  sellAllocation,
  quantity,
  required = false,
} = {}) {
  if (sellAllocation === undefined || sellAllocation === null) {
    if (required) {
      throw new TypeError("Recovery Seller SELL allocation requires recovery and legacy SELL quantities")
    }
    return undefined
  }
  assertAllocationShape({
    sellAllocation,
  })
  assertAllocationQuantities({
    sellAllocation,
    quantity,
  })
  return Object.freeze({
    recoverySellQuantity: sellAllocation.recoverySellQuantity,
    legacySellQuantity: sellAllocation.legacySellQuantity,
  })
}
