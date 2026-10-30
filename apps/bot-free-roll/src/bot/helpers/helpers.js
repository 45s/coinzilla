function parseDecimal(value) {
  if (!Number.isFinite(value)) {
    throw new Error("Decimal value must be finite");
  }

  const [coefficient, exponentText = "0"] = String(value)
    .toLowerCase()
    .split("e");
  const exponent = Number(exponentText);
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^\+/, "");
  const scale = fraction.length - exponent;

  if (scale < 0) {
    return { coefficient: BigInt(digits) * 10n ** BigInt(-scale), scale: 0 };
  }

  return { coefficient: BigInt(digits), scale };
}

function formatDecimal({ coefficient, scale }) {
  const negative = coefficient < 0n;
  const absolute = negative ? -coefficient : coefficient;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const value =
    scale === 0
      ? digits
      : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  const normalized = value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;

  return Number(`${negative ? "-" : ""}${normalized}`);
}

function alignDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);

  return {
    left: left.coefficient * 10n ** BigInt(scale - left.scale),
    right: right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

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

export function getOrderId(order) {
  const id = order?.id ?? order?.orderId ?? order?.orderID
  return id == null ? null : String(id)
}

export function unwrapResult(result, operation) {
  if (!result || result.ok === false || result.error || result.errors?.length) {
    throw new AggregateError(
      result?.errors ?? [result?.error ?? new Error(`${operation}: failed`)],
      `${operation} failed`,
    )
  }

  if (!Object.hasOwn(result, "data")) {
    throw new Error(`${operation}: response has no data`)
  }

  return result.data
}

export function getFeeRate({ makerPercent, takerPercent }) {
  for (const [name, percent] of Object.entries({ makerPercent, takerPercent })) {
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
      throw new Error(`${name} must be a number from 0 (inclusive) to 100 (exclusive)`)
    }
  }

  // Use the higher configured rate for both sides to keep estimates conservative.
  return Math.max(makerPercent, takerPercent) / 100
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

export function calculateSellPlan({
  activeQuantity,
  keepQuantity,
  cycleCost,
  saleProceeds,
  minProfit,
  feeRate,
  priceTickSize = 0,
  quantityStepSize = 0,
}) {
  const values = {
    activeQuantity,
    keepQuantity,
    cycleCost,
    saleProceeds,
    minProfit,
    feeRate,
    priceTickSize,
    quantityStepSize,
  }

  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} must be a finite number`)
    }
  }

  if (
    activeQuantity <= 0 ||
    keepQuantity < 0 ||
    cycleCost < 0 ||
    saleProceeds < 0 ||
    minProfit <= 0 ||
    feeRate < 0 ||
    feeRate >= 1 ||
    priceTickSize < 0 ||
    quantityStepSize < 0
  ) {
    throw new Error("Invalid sell plan inputs")
  }

  const quantity = roundQuantityDown(
    Math.max(0, (activeQuantity - keepQuantity) / (1 + feeRate)),
    quantityStepSize,
  )

  if (quantity <= 0) {
    return {
      quantity: 0,
      price: null,
      requiredNetProceeds: Math.max(0, cycleCost + minProfit - saleProceeds),
    }
  }

  const requiredNetProceeds = Math.max(0, cycleCost + minProfit - saleProceeds)

  const minimumPrice = requiredNetProceeds / (quantity * (1 - feeRate))

  return {
    quantity,
    price: roundPriceUp(minimumPrice, priceTickSize),
    requiredNetProceeds: Number(requiredNetProceeds.toFixed(8)),
  }
}

export function estimateBuyAccounting({ quantity, price, feeRate }) {
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    feeRate >= 1
  ) {
    throw new Error("Invalid buy accounting inputs")
  }

  return {
    // Conservative reserve in case fees are charged in the base asset.
    netQuantity: quantity * (1 - feeRate),

    // Conservative quote-cost estimate.
    estimatedCost: quantity * price * (1 + feeRate),
  }
}

export function estimateSellAccounting({ quantity, price, feeRate }) {
  if (
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    feeRate >= 1
  ) {
    throw new Error("Invalid sell accounting inputs")
  }

  return {
    // Conservative quote-proceeds estimate.
    estimatedProceeds: quantity * price * (1 - feeRate),

    // Conservative base-asset deduction.
    estimatedBaseDeduction: quantity * (1 + feeRate),
  }
}
