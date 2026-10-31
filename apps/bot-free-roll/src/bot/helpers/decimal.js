const MAX_DECIMAL_DIGITS = 256;
export const MAX_DECIMAL_SCALE = 100;
const MAX_DECIMAL_EXPONENT = 100;

export function parseDecimal(value) {
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

export function formatDecimal({ coefficient, scale }) {
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

export function alignDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);

  return {
    left: left.coefficient * 10n ** BigInt(scale - left.scale),
    right: right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

export function formatDecimalString({ coefficient, scale }) {
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

export function validateScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new Error(`scale must be an integer from 0 to ${MAX_DECIMAL_SCALE}`);
  }
}

export function divideIntegers({ numerator, denominator, rounding }) {
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
