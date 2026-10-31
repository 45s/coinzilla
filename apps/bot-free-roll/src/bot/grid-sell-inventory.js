import { toResult } from "@coinzilla/utils"
import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "./helpers/decimal.js"

function fail(reason) {
  return toResult({ errors: [reason] })
}

// Reserve enough base inventory for the gross SELL quantity plus the configured
// worst-case base-asset fee. The exchange's actual fill debit remains canonical.
export function calculateGridSellInventoryPlan({
  availableQuantity,
  keepQuantity,
  feeRate,
  quantityStepSize = "0",
} = {}) {
  try {
    for (const [name, value] of Object.entries({
      availableQuantity,
      keepQuantity,
      feeRate,
      quantityStepSize,
    })) {
      assertDecimalString(value, name)
    }

    if (
      compareDecimal({ left: availableQuantity, right: "0" }) < 0 ||
      compareDecimal({ left: keepQuantity, right: "0" }) < 0 ||
      compareDecimal({ left: feeRate, right: "0" }) < 0 ||
      compareDecimal({ left: feeRate, right: "1" }) >= 0 ||
      compareDecimal({ left: quantityStepSize, right: "0" }) < 0
    ) {
      throw new Error("Invalid Grid SELL inventory inputs")
    }

    const sellableQuantity = compareDecimal({
      left: availableQuantity,
      right: keepQuantity,
    }) > 0
      ? subtractDecimal({ left: availableQuantity, right: keepQuantity })
      : "0"
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
    const reservedQuantity = multiplyDecimal({
      left: quantity,
      right: addDecimal({ left: "1", right: feeRate }),
    })

    if (compareDecimal({ left: reservedQuantity, right: sellableQuantity }) > 0) {
      throw new Error("Grid SELL reservation exceeds available sellable inventory")
    }

    return toResult({
      data: {
        quantity,
        reservedQuantity,
        sellableQuantity,
        unreservedQuantity: subtractDecimal({
          left: sellableQuantity,
          right: reservedQuantity,
        }),
      },
    })
  } catch (error) {
    return fail(error.message)
  }
}
