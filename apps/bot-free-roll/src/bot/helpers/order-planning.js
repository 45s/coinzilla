import { addDecimal, compareDecimal, divideDecimal, maxDecimal, multiplyDecimal, roundDecimalToIncrement, subtractDecimal } from "./decimal.js"
import { roundPriceUp, roundQuantityDown } from "./price.js"

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

export function calculateSellPlanExact({
  activeQuantity,
  keepQuantity,
  cycleCost,
  saleProceeds,
  minProfit,
  feeRate,
  priceTickSize = "0",
  quantityStepSize = "0",
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
  };
  for (const [name, value] of Object.entries(values)) assertDecimalString(value, name);

  if (
    compareDecimal({ left: activeQuantity, right: "0" }) <= 0 ||
    compareDecimal({ left: keepQuantity, right: "0" }) < 0 ||
    compareDecimal({ left: cycleCost, right: "0" }) < 0 ||
    compareDecimal({ left: saleProceeds, right: "0" }) < 0 ||
    compareDecimal({ left: minProfit, right: "0" }) <= 0 ||
    compareDecimal({ left: feeRate, right: "0" }) < 0 ||
    compareDecimal({ left: feeRate, right: "1" }) >= 0 ||
    compareDecimal({ left: priceTickSize, right: "0" }) < 0 ||
    compareDecimal({ left: quantityStepSize, right: "0" }) < 0
  ) {
    throw new Error("Invalid sell plan inputs");
  }

  const sellableQuantity = maxDecimal({
    left: "0",
    right: subtractDecimal({ left: activeQuantity, right: keepQuantity }),
  });
  const quantityBeforeStep = divideDecimal({
    left: sellableQuantity,
    right: addDecimal({ left: "1", right: feeRate }),
    scale: 36,
    rounding: "toward-zero",
  });
  const quantity = roundDecimalToIncrement({
    value: quantityBeforeStep,
    increment: quantityStepSize,
    direction: "down",
  });
  const requiredNetProceeds = maxDecimal({
    left: "0",
    right: subtractDecimal({
      left: addDecimal({ left: cycleCost, right: minProfit }),
      right: saleProceeds,
    }),
  });

  if (compareDecimal({ left: quantity, right: "0" }) <= 0) {
    return { quantity: "0", price: null, requiredNetProceeds };
  }

  const netSellRate = subtractDecimal({ left: "1", right: feeRate });
  const netQuotePerBase = multiplyDecimal({ left: quantity, right: netSellRate });
  const minimumPrice = divideDecimal({
    left: requiredNetProceeds,
    right: netQuotePerBase,
    scale: 36,
    rounding: "away-from-zero",
  });
  const price = roundDecimalToIncrement({
    value: minimumPrice,
    increment: priceTickSize,
    direction: "up",
  });

  return { quantity, price, requiredNetProceeds };
}
