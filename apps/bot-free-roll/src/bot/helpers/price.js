import { alignDecimals, formatDecimal, parseDecimal, multiplyDecimal, compareDecimal, divideDecimal, subtractDecimal, assertDecimalString } from "./decimal.js"

function roundToIncrement(value, increment, direction) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Value must be non-negative");
  }

  if (!Number.isFinite(increment) || increment < 0) {
    throw new Error("Increment must be non-negative");
  }

  if (increment === 0) {
    const factor = 100_000_000n;
    const scaled = parseDecimal(value);
    const aligned = alignDecimals(scaled, { coefficient: 1n, scale: 8 });
    const integer = direction === "up"
      ? (aligned.left + aligned.right - 1n) / aligned.right
      : aligned.left / aligned.right;
    return Number(integer) / Number(factor);
  }

  const parsedValue = parseDecimal(value);
  const parsedIncrement = parseDecimal(increment);
  const { left, right } = alignDecimals(parsedValue, parsedIncrement);
  const quotient = left / right;
  const remainder = left % right;
  const units =
    direction === "up" && remainder !== 0n ? quotient + 1n : quotient;

  return formatDecimal({
    coefficient: units * parsedIncrement.coefficient,
    scale: parsedIncrement.scale,
  });
}

function calculatePercentageDrop({ price, percent }) {
  const parsedPrice = parseDecimal(price);
  const parsedPercent = parseDecimal(percent);
  const denominator = 10n ** BigInt(parsedPercent.scale + 2);
  const numerator = denominator - parsedPercent.coefficient;

  return formatDecimal({
    coefficient: parsedPrice.coefficient * numerator,
    scale: parsedPrice.scale + parsedPercent.scale + 2,
  });
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
    throw new Error("Price must be positive");
  }

  if (!Number.isFinite(tickSize) || tickSize < 0) {
    throw new Error("tickSize must be non-negative");
  }

  return roundToIncrement(price, tickSize, "down");
}

export function roundPriceUp(price, tickSize = 0) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Price must be positive");
  }

  if (!Number.isFinite(tickSize) || tickSize < 0) {
    throw new Error("tickSize must be non-negative");
  }

  return roundToIncrement(price, tickSize, "up");
}

export function roundQuantityDown(quantity, stepSize = 0) {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be non-negative");
  }

  if (!Number.isFinite(stepSize) || stepSize < 0) {
    throw new Error("stepSize must be non-negative");
  }

  return roundToIncrement(quantity, stepSize, "down");
}

export function calculatePercentageDropExact({ price, percent }) {
  assertDecimalString(price, "price");
  assertDecimalString(percent, "percent");
  if (
    compareDecimal({ left: price, right: "0" }) <= 0 ||
    compareDecimal({ left: percent, right: "0" }) <= 0 ||
    compareDecimal({ left: percent, right: "100" }) >= 0
  ) {
    throw new Error("Invalid percentage drop inputs");
  }

  return multiplyDecimal({
    left: price,
    right: divideDecimal({
      left: subtractDecimal({ left: "100", right: percent }),
      right: "100",
      scale: 36,
      rounding: "toward-zero",
    }),
  });
}

export function calculateBuyThresholdExact({ referencePrice, lastBuyPrice, priceStepPercent }) {
  const basePrice = lastBuyPrice ?? referencePrice;
  return calculatePercentageDropExact({ price: basePrice, percent: priceStepPercent });
}
