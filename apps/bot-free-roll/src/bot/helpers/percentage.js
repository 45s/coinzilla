import { addDecimal, divideDecimal, multiplyDecimal, subtractDecimal, validateScale, MAX_DECIMAL_SCALE, assertDecimalString } from "./decimal.js"

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
  if (scale > MAX_DECIMAL_SCALE - 2) {
    throw new Error(`scale must not exceed ${MAX_DECIMAL_SCALE - 2} for percentage calculations`);
  }
  const difference = subtractDecimal({ left: to, right: from });
  const ratio = divideDecimal({ left: difference, right: from, scale: scale + 2, rounding });
  return multiplyDecimal({ left: ratio, right: "100" });
}
