const MAX_DECIMAL_DIGITS = 256;
const MAX_DECIMAL_SCALE = 100;
const MAX_DECIMAL_EXPONENT = 100;

function parseDecimal(value) {
  if (!["string", "number", "bigint"].includes(typeof value)) {
    throw new Error("Decimal value must be a string, number, or bigint");
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Decimal value must be finite");
  }

  const decimal = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(decimal);

  if (!match) {
    throw new Error("Decimal value has an invalid format");
  }

  const [, sign, whole, fraction = "", exponentText = "0"] = match;

  if (whole.length + fraction.length > MAX_DECIMAL_DIGITS || exponentText.length > 4) {
    throw new Error("Decimal value exceeds supported precision");
  }

  const exponent = Number(exponentText);

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) {
    throw new Error("Decimal exponent exceeds supported range");
  }

  const scale = fraction.length - exponent;
  const digits = `${whole}${fraction}`;
  const resultingDigits = digits.length + Math.max(0, -scale);

  if (scale > MAX_DECIMAL_SCALE || resultingDigits > MAX_DECIMAL_DIGITS) {
    throw new Error("Decimal value exceeds supported precision");
  }

  const coefficient = BigInt(`${sign === "-" ? "-" : ""}${digits}`);

  if (scale < 0) {
    return {
      coefficient: coefficient * 10n ** BigInt(-scale),
      scale: 0,
    };
  }

  return { coefficient, scale };
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

function formatDecimalString({ coefficient, scale }) {
  const negative = coefficient < 0n;
  const absolute = negative ? -coefficient : coefficient;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const value = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  const normalized = value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;

  return `${negative ? "-" : ""}${normalized}`;
}

export function addDecimal({ left, right }) {
  const aligned = alignDecimals(parseDecimal(left), parseDecimal(right));

  return formatDecimalString({
    coefficient: aligned.left + aligned.right,
    scale: aligned.scale,
  });
}

export function subtractDecimal({ left, right }) {
  const aligned = alignDecimals(parseDecimal(left), parseDecimal(right));

  return formatDecimalString({
    coefficient: aligned.left - aligned.right,
    scale: aligned.scale,
  });
}

export function multiplyDecimal({ left, right }) {
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);

  return formatDecimalString({
    coefficient: parsedLeft.coefficient * parsedRight.coefficient,
    scale: parsedLeft.scale + parsedRight.scale,
  });
}

function validateScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new Error(`scale must be an integer from 0 to ${MAX_DECIMAL_SCALE}`);
  }
}

function divideIntegers({ numerator, denominator, rounding }) {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero");
  }

  if (!["toward-zero", "away-from-zero", "half-up"].includes(rounding)) {
    throw new Error("rounding must be toward-zero, away-from-zero, or half-up");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n || rounding === "toward-zero") {
    return quotient;
  }

  const sameSign = (numerator < 0n) === (denominator < 0n);
  const adjustment = sameSign ? 1n : -1n;

  if (rounding === "away-from-zero") {
    return quotient + adjustment;
  }

  return remainder < 0n
    ? (-remainder * 2n >= (denominator < 0n ? -denominator : denominator)
        ? quotient + adjustment
        : quotient)
    : (remainder * 2n >= (denominator < 0n ? -denominator : denominator)
        ? quotient + adjustment
        : quotient);
}

export function divideDecimal({ left, right, scale, rounding }) {
  validateScale(scale);
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);

  let numerator = parsedLeft.coefficient;
  let denominator = parsedRight.coefficient;
  const exponent = parsedRight.scale + scale - parsedLeft.scale;

  if (exponent >= 0) {
    numerator *= 10n ** BigInt(exponent);
  } else {
    denominator *= 10n ** BigInt(-exponent);
  }

  return formatDecimalString({
    coefficient: divideIntegers({ numerator, denominator, rounding }),
    scale,
  });
}

export function absoluteDecimal({ value }) {
  const parsed = parseDecimal(value);
  return formatDecimalString({
    coefficient: parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient,
    scale: parsed.scale,
  });
}

export function negateDecimal({ value }) {
  const parsed = parseDecimal(value);
  return formatDecimalString({
    coefficient: -parsed.coefficient,
    scale: parsed.scale,
  });
}

export function minDecimal({ left, right }) {
  return compareDecimal({ left, right }) <= 0
    ? formatDecimalString(parseDecimal(left))
    : formatDecimalString(parseDecimal(right));
}

export function maxDecimal({ left, right }) {
  return compareDecimal({ left, right }) >= 0
    ? formatDecimalString(parseDecimal(left))
    : formatDecimalString(parseDecimal(right));
}

export function rescaleDecimal({ value, scale, rounding }) {
  validateScale(scale);
  const parsed = parseDecimal(value);

  if (scale >= parsed.scale) {
    return formatDecimalString({
      coefficient: parsed.coefficient * 10n ** BigInt(scale - parsed.scale),
      scale,
    });
  }

  const divisor = 10n ** BigInt(parsed.scale - scale);

  return formatDecimalString({
    coefficient: divideIntegers({
      numerator: parsed.coefficient,
      denominator: divisor,
      rounding,
    }),
    scale,
  });
}

export function compareDecimal({ left, right }) {
  const aligned = alignDecimals(parseDecimal(left), parseDecimal(right));

  return aligned.left === aligned.right ? 0 : aligned.left > aligned.right ? 1 : -1;
}

export function roundDecimalToIncrement({ value, increment, direction }) {
  if (typeof value !== "string" || typeof increment !== "string") {
    throw new Error("Value and increment must be decimal strings");
  }

  if (!["down", "up", "nearest"].includes(direction)) {
    throw new Error("direction must be down, up, or nearest");
  }

  const parsedValue = parseDecimal(value);
  const parsedIncrement = parseDecimal(increment);

  if (parsedValue.coefficient < 0n || parsedIncrement.coefficient < 0n) {
    throw new Error("Value and increment must be non-negative");
  }

  if (parsedIncrement.coefficient === 0n) {
    return formatDecimalString(parsedValue);
  }

  const aligned = alignDecimals(parsedValue, parsedIncrement);
  const quotient = aligned.left / aligned.right;
  const remainder = aligned.left % aligned.right;

  const units = direction === "up" && remainder !== 0n
    ? quotient + 1n
    : direction === "nearest" && remainder * 2n >= aligned.right
      ? quotient + 1n
      : quotient;

  return formatDecimalString({
    coefficient: units * parsedIncrement.coefficient,
    scale: parsedIncrement.scale,
  });
}

function assertDecimalString(value, name) {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a decimal string`);
  }
}

export function percentageToRate({ percent }) {
  assertDecimalString(percent, "percent");
  return multiplyDecimal({ left: percent, right: "0.01" });
}

export function calculatePercentageOf({ value, percent }) {
  assertDecimalString(value, "value");
  return multiplyDecimal({ left: value, right: percentageToRate({ percent }) });
}

export function applyPercentageChange({ value, percent }) {
  assertDecimalString(value, "value");
  const change = calculatePercentageOf({ value, percent });
  return addDecimal({ left: value, right: change });
}

export function calculatePercentageChange({ from, to, scale, rounding }) {
  assertDecimalString(from, "from");
  assertDecimalString(to, "to");
  validateScale(scale);
  const difference = subtractDecimal({ left: to, right: from });
  const ratio = divideDecimal({ left: difference, right: from, scale: scale + 2, rounding });
  return multiplyDecimal({ left: ratio, right: "100" });
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

    // Keep quote accounting as a decimal string; do not accumulate binary floats.
    estimatedCost: multiplyDecimal({
      left: multiplyDecimal({ left: quantity, right: price }),
      right: addDecimal({ left: "1", right: feeRate }),
    }),
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
    // Keep quote accounting as a decimal string; do not accumulate binary floats.
    estimatedProceeds: multiplyDecimal({
      left: multiplyDecimal({ left: quantity, right: price }),
      right: subtractDecimal({ left: "1", right: feeRate }),
    }),

    // Conservative base-asset deduction.
    estimatedBaseDeduction: quantity * (1 + feeRate),
  }
}
