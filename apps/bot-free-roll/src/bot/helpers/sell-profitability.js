import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  maxDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "./decimal.js"

export const SELL_PROFITABILITY_REASONS = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNSUPPORTED_FEE_ASSET: "UNSUPPORTED_FEE_ASSET",
  INSUFFICIENT_INVENTORY: "INSUFFICIENT_INVENTORY",
  PRICE_TICK_MISMATCH: "PRICE_TICK_MISMATCH",
  QUANTITY_STEP_MISMATCH: "QUANTITY_STEP_MISMATCH",
  BELOW_MIN_NOTIONAL: "BELOW_MIN_NOTIONAL",
  FEES_EXCEED_PROCEEDS: "FEES_EXCEED_PROCEEDS",
  BELOW_MIN_PROFIT: "BELOW_MIN_PROFIT",
})

function isAligned({ value, increment }) {
  if (compareDecimal({ left: increment, right: "0" }) === 0) return true

  const rounded = roundDecimalToIncrement({
    value,
    increment,
    direction: "down",
  })

  return compareDecimal({ left: rounded, right: value }) === 0
}

function validateDecimalFields({ values }) {
  for (const [name, value] of Object.entries(values)) {
    assertDecimalString(value, name)
  }
}

export function evaluateSellProfitability({
  position,
  candidate,
  accounting,
  feeAssumptions,
  valuationData,
  tradingRules,
  minProfit,
} = {}) {
  try {
    if (!position || !candidate || !accounting || !valuationData || !tradingRules) {
      throw new TypeError("position, candidate, accounting, valuationData, and tradingRules are required")
    }
    if (!Array.isArray(feeAssumptions)) {
      throw new TypeError("feeAssumptions must be an array; use [] for confirmed zero fees")
    }

    const {
      activeQuantity,
      keepQuantity,
    } = position
    const baseAsset = typeof position.baseAsset === "string" ? position.baseAsset.trim() : ""
    const quoteAsset = typeof position.quoteAsset === "string" ? position.quoteAsset.trim() : ""
    if (!baseAsset || !quoteAsset || baseAsset === quoteAsset) {
      throw new TypeError("position must include distinct baseAsset and quoteAsset codes")
    }

    const values = {
      activeQuantity,
      keepQuantity,
      candidateQuantity: candidate.quantity,
      candidatePrice: candidate.price,
      cycleCost: accounting.cycleCost,
      saleProceeds: accounting.saleProceeds,
      baseToQuoteRate: valuationData.baseToQuoteRate,
      minNotional: tradingRules.minNotional,
      priceTickSize: tradingRules.priceTickSize,
      quantityStepSize: tradingRules.quantityStepSize,
      minProfit,
    }
    validateDecimalFields({ values })

    if (compareDecimal({ left: activeQuantity, right: "0" }) < 0 ||
        compareDecimal({ left: keepQuantity, right: "0" }) < 0 ||
        compareDecimal({ left: candidate.quantity, right: "0" }) <= 0 ||
        compareDecimal({ left: candidate.price, right: "0" }) <= 0 ||
        compareDecimal({ left: accounting.cycleCost, right: "0" }) < 0 ||
        compareDecimal({ left: accounting.saleProceeds, right: "0" }) < 0 ||
        compareDecimal({ left: valuationData.baseToQuoteRate, right: "0" }) <= 0 ||
        compareDecimal({ left: tradingRules.minNotional, right: "0" }) < 0 ||
        compareDecimal({ left: tradingRules.priceTickSize, right: "0" }) < 0 ||
        compareDecimal({ left: tradingRules.quantityStepSize, right: "0" }) < 0 ||
        compareDecimal({ left: minProfit, right: "0" }) <= 0) {
      throw new RangeError("Sell profitability inputs contain an out-of-range value")
    }

    let baseFeeQuantity = "0"
    let quoteFeeAmount = "0"
    const unsupportedFeeAssets = []

    for (const [index, assumption] of feeAssumptions.entries()) {
      const feeAsset = typeof assumption?.asset === "string" ? assumption.asset.trim() : ""
      if (!feeAsset) {
        throw new TypeError(`feeAssumptions[${index}].asset must be a non-empty string`)
      }
      assertDecimalString(assumption.rate, `feeAssumptions[${index}].rate`)
      if (compareDecimal({ left: assumption.rate, right: "0" }) < 0 ||
          compareDecimal({ left: assumption.rate, right: "1" }) >= 0) {
        throw new RangeError(`feeAssumptions[${index}].rate must be from 0 (inclusive) to 1 (exclusive)`)
      }
      if (compareDecimal({ left: assumption.rate, right: "0" }) === 0) continue

      if (feeAsset === baseAsset) {
        baseFeeQuantity = addDecimal({
          left: baseFeeQuantity,
          right: multiplyDecimal({
            left: candidate.quantity,
            right: assumption.rate,
          }),
        })
      } else if (feeAsset === quoteAsset) {
        quoteFeeAmount = addDecimal({
          left: quoteFeeAmount,
          right: multiplyDecimal({
            left: multiplyDecimal({
              left: candidate.quantity,
              right: candidate.price,
            }),
            right: assumption.rate,
          }),
        })
      } else {
        unsupportedFeeAssets.push(feeAsset)
      }
    }

    const grossProceeds = multiplyDecimal({
      left: candidate.quantity,
      right: candidate.price,
    })
    const baseFeeValueInQuote = multiplyDecimal({
      left: baseFeeQuantity,
      right: valuationData.baseToQuoteRate,
    })
    const feeValueInQuote = addDecimal({
      left: baseFeeValueInQuote,
      right: quoteFeeAmount,
    })
    const netProceeds = subtractDecimal({
      left: grossProceeds,
      right: feeValueInQuote,
    })
    const inventoryRequired = addDecimal({
      left: candidate.quantity,
      right: baseFeeQuantity,
    })
    const availableForSell = subtractDecimal({
      left: activeQuantity,
      right: keepQuantity,
    })
    const requiredNetProceeds = maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: addDecimal({
          left: accounting.cycleCost,
          right: minProfit,
        }),
        right: accounting.saleProceeds,
      }),
    })
    const projectedNetProfit = subtractDecimal({
      left: addDecimal({
        left: accounting.saleProceeds,
        right: netProceeds,
      }),
      right: accounting.cycleCost,
    })
    const reasons = new Set()

    if (unsupportedFeeAssets.length > 0) {
      reasons.add(SELL_PROFITABILITY_REASONS.UNSUPPORTED_FEE_ASSET)
    }
    if (compareDecimal({ left: availableForSell, right: "0" }) <= 0 ||
        compareDecimal({ left: inventoryRequired, right: availableForSell }) > 0) {
      reasons.add(SELL_PROFITABILITY_REASONS.INSUFFICIENT_INVENTORY)
    }
    if (!isAligned({
      value: candidate.quantity,
      increment: tradingRules.quantityStepSize,
    })) {
      reasons.add(SELL_PROFITABILITY_REASONS.QUANTITY_STEP_MISMATCH)
    }
    if (!isAligned({
      value: candidate.price,
      increment: tradingRules.priceTickSize,
    })) {
      reasons.add(SELL_PROFITABILITY_REASONS.PRICE_TICK_MISMATCH)
    }
    if (compareDecimal({ left: grossProceeds, right: tradingRules.minNotional }) < 0) {
      reasons.add(SELL_PROFITABILITY_REASONS.BELOW_MIN_NOTIONAL)
    }
    if (compareDecimal({ left: netProceeds, right: "0" }) < 0) {
      reasons.add(SELL_PROFITABILITY_REASONS.FEES_EXCEED_PROCEEDS)
    }
    if (compareDecimal({ left: projectedNetProfit, right: minProfit }) < 0) {
      reasons.add(SELL_PROFITABILITY_REASONS.BELOW_MIN_PROFIT)
    }

    return {
      approved: reasons.size === 0,
      reasonCodes: [...reasons],
      details: {
        unsupportedFeeAssets: [...unsupportedFeeAssets],
      },
      breakdown: {
        grossProceeds,
        baseFeeQuantity,
        quoteFeeAmount,
        feeValueInQuote,
        netProceeds,
        inventoryRequired,
        availableForSell,
        requiredNetProceeds,
        projectedNetProfit,
        minProfit,
        notional: grossProceeds,
      },
    }
  } catch (error) {
    return {
      approved: false,
      reasonCodes: [SELL_PROFITABILITY_REASONS.INVALID_INPUT],
      details: { message: error.message },
      breakdown: null,
    }
  }
}
