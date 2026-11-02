import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  maxDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "@coinzilla/utils"

/**
 * Calculate a Free-Roll recovery SELL plan using exact decimal arithmetic.
 *
 * feeRate is the conservative execution-fee rate used by the Free-Roll
 * planning policy. The quantity reserves for a possible base-asset SELL fee;
 * the price covers the quote proceeds required after the fee and prior sales.
 * Actual fills and commissions remain authoritative for accounting.
 *
 * @param {object} input
 * @param {string} input.activeQuantity Current strategy-owned base quantity.
 * @param {string} input.keepQuantity Base quantity retained after recovery.
 * @param {string} input.cycleCost Unrecovered BUY cost for the current cycle.
 * @param {string} input.saleProceeds Confirmed net SELL proceeds already credited.
 * @param {string} input.minProfit Required minimum net quote profit.
 * @param {string} input.feeRate Conservative fee rate as a decimal fraction.
 * @param {string} input.priceTickSize Exchange price increment.
 * @param {string} input.quantityStepSize Exchange quantity increment.
 * @returns {{ quantity: string, price: string | null, requiredNetProceeds: string }}
 */
export function calculateRecoverySellPlan({
  activeQuantity,
  keepQuantity,
  cycleCost,
  saleProceeds,
  minProfit,
  feeRate,
  priceTickSize,
  quantityStepSize,
} = {}) {
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

  for (const [field, value] of Object.entries(values)) {
    assertDecimalString({ value, field })
  }

  if (
    compareDecimal({ left: activeQuantity, right: "0" }) <= 0 ||
    compareDecimal({ left: keepQuantity, right: "0" }) < 0 ||
    compareDecimal({ left: cycleCost, right: "0" }) < 0 ||
    compareDecimal({ left: saleProceeds, right: "0" }) < 0 ||
    compareDecimal({ left: minProfit, right: "0" }) <= 0 ||
    compareDecimal({ left: feeRate, right: "0" }) < 0 ||
    compareDecimal({ left: feeRate, right: "1" }) >= 0 ||
    compareDecimal({ left: priceTickSize, right: "0" }) <= 0 ||
    compareDecimal({ left: quantityStepSize, right: "0" }) <= 0
  ) {
    throw new RangeError("Invalid Free-Roll recovery SELL plan inputs")
  }

  const sellableQuantity = maxDecimal({
    left: "0",
    right: subtractDecimal({ left: activeQuantity, right: keepQuantity }),
  })
  const quantityBeforeStep = divideDecimal({
    left: sellableQuantity,
    right: addDecimal({ left: "1", right: feeRate }),
    scale: 36,
    rounding: "toward-zero",
  })
  const quantity = roundDecimalToIncrement({
    value: quantityBeforeStep,
    increment: quantityStepSize,
    direction: "down",
  })
  const requiredNetProceeds = maxDecimal({
    left: "0",
    right: subtractDecimal({
      left: addDecimal({ left: cycleCost, right: minProfit }),
      right: saleProceeds,
    }),
  })

  if (
    compareDecimal({ left: quantity, right: "0" }) <= 0 ||
    compareDecimal({ left: requiredNetProceeds, right: "0" }) <= 0
  ) {
    return Object.freeze({
      quantity: "0",
      price: null,
      requiredNetProceeds,
    })
  }

  const netSellRate = subtractDecimal({ left: "1", right: feeRate })
  const netQuotePerBase = multiplyDecimal({
    left: quantity,
    right: netSellRate,
  })
  const minimumPrice = divideDecimal({
    left: requiredNetProceeds,
    right: netQuotePerBase,
    scale: 36,
    rounding: "away-from-zero",
  })
  const price = roundDecimalToIncrement({
    value: minimumPrice,
    increment: priceTickSize,
    direction: "up",
  })

  return Object.freeze({ quantity, price, requiredNetProceeds })
}
