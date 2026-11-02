import {
  applyPercentageChange,
  assertDecimalString,
  compareDecimal,
  negateDecimal,
  roundDecimalToIncrement,
} from "@coinzilla/utils"

function roundToIncrement(value, increment, direction) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Value must be non-negative")
  }
  if (!Number.isFinite(increment) || increment < 0) {
    throw new Error("Increment must be non-negative")
  }

  const decimalValue = String(value)
  if (increment === 0) {
    return Number(roundDecimalToIncrement({
      value: decimalValue,
      increment: "0.00000001",
      direction,
    }))
  }

  return Number(roundDecimalToIncrement({
    value: decimalValue,
    increment: String(increment),
    direction,
  }))
}

function calculatePercentageDrop({ price, percent }) {
  return Number(applyPercentageChange({
    value: String(price),
    percent: String(-percent),
  }))
}

export function calculateBuyThreshold({
  referencePrice,
  lastBuyPrice,
  priceStepPercent,
}) {
  const basePrice = lastBuyPrice ?? referencePrice

  if (
    !Number.isFinite(basePrice) ||
    basePrice <= 0 ||
    !Number.isFinite(priceStepPercent) ||
    priceStepPercent <= 0 ||
    priceStepPercent >= 100
  ) {
    throw new Error("Invalid buy threshold inputs")
  }

  return calculatePercentageDrop({ price: basePrice, percent: priceStepPercent })
}

export function roundPriceDown(price, tickSize = 0) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Price must be positive")
  }
  if (!Number.isFinite(tickSize) || tickSize < 0) {
    throw new Error("tickSize must be non-negative")
  }
  return roundToIncrement(price, tickSize, "down")
}

export function roundPriceUp(price, tickSize = 0) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Price must be positive")
  }
  if (!Number.isFinite(tickSize) || tickSize < 0) {
    throw new Error("tickSize must be non-negative")
  }
  return roundToIncrement(price, tickSize, "up")
}

export function roundQuantityDown(quantity, stepSize = 0) {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be non-negative")
  }
  if (!Number.isFinite(stepSize) || stepSize < 0) {
    throw new Error("stepSize must be non-negative")
  }
  return roundToIncrement(quantity, stepSize, "down")
}

export function calculatePercentageDropExact({ price, percent }) {
  assertDecimalString({ value: price, field: "price" })
  assertDecimalString({ value: percent, field: "percent" })
  if (
    compareDecimal({ left: price, right: "0" }) <= 0 ||
    compareDecimal({ left: percent, right: "0" }) <= 0 ||
    compareDecimal({ left: percent, right: "100" }) >= 0
  ) {
    throw new Error("Invalid percentage drop inputs")
  }

  return applyPercentageChange({
    value: price,
    percent: negateDecimal({ value: percent }),
  })
}

export function calculateBuyThresholdExact({
  referencePrice,
  lastBuyPrice,
  priceStepPercent,
}) {
  const basePrice = lastBuyPrice ?? referencePrice
  return calculatePercentageDropExact({ price: basePrice, percent: priceStepPercent })
}
