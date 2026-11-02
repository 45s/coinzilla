import {
  applyPercentageChange,
  assertDecimalString,
  compareDecimal,
  roundDecimalToIncrement,
} from "@coinzilla/utils"

/**
 * Calculate the initial Free-Roll BUY limit from the last traded price.
 *
 * The percentage is expressed in human-readable percent units (0.05 = 0.05%).
 * BUY price is rounded down to the exchange tick so the order never exceeds
 * the strategy's calculated limit.
 *
 * @param {object} input
 * @param {string} input.lastTradePrice Positive decimal-string last trade price.
 * @param {string} input.priceStepPercent Positive decimal-string percentage below 100.
 * @param {string} input.priceTickSize Positive exchange price increment.
 * @returns {{ price: string }}
 */
export function calculateInitialBuyPrice({
  lastTradePrice,
  priceStepPercent,
  priceTickSize,
} = {}) {
  assertDecimalString({ value: lastTradePrice, field: "lastTradePrice" })
  assertDecimalString({ value: priceStepPercent, field: "priceStepPercent" })
  assertDecimalString({ value: priceTickSize, field: "priceTickSize" })

  if (compareDecimal({ left: lastTradePrice, right: "0" }) <= 0) {
    throw new RangeError("lastTradePrice must be greater than zero")
  }
  if (
    compareDecimal({ left: priceStepPercent, right: "0" }) <= 0 ||
    compareDecimal({ left: priceStepPercent, right: "100" }) >= 0
  ) {
    throw new RangeError("priceStepPercent must be greater than zero and less than 100")
  }
  if (compareDecimal({ left: priceTickSize, right: "0" }) <= 0) {
    throw new RangeError("priceTickSize must be greater than zero")
  }

  const unroundedPrice = applyPercentageChange({
    value: lastTradePrice,
    percent: "-" + priceStepPercent,
  })
  const price = roundDecimalToIncrement({
    value: unroundedPrice,
    increment: priceTickSize,
    direction: "down",
  })

  if (compareDecimal({ left: price, right: "0" }) <= 0) {
    throw new RangeError("Calculated initial BUY price is not positive after tick rounding")
  }

  return Object.freeze({ price })
}
