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

  return basePrice * (1 - priceStepPercent / 100)
}

function getTickPrecision(tickSize) {
  const [coefficient, exponent = "0"] = tickSize.toString().toLowerCase().split("e")
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent))
}

export function roundPriceDown(price, tickSize = 0) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Price must be positive")
  }

  if (!Number.isFinite(tickSize) || tickSize < 0) {
    throw new Error("tickSize must be non-negative")
  }

  if (tickSize === 0) {
    return Math.floor(price * 1e8) / 1e8
  }

  const precision = getTickPrecision(tickSize)
  const ticks = Math.floor((price + tickSize * 1e-10) / tickSize)
  return Number((ticks * tickSize).toFixed(precision))
}

export function roundPriceUp(price, tickSize = 0) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Price must be positive")
  }

  if (!Number.isFinite(tickSize) || tickSize < 0) {
    throw new Error("tickSize must be non-negative")
  }

  if (tickSize === 0) {
    return Math.ceil(price * 1e8) / 1e8
  }

  const precision = getTickPrecision(tickSize)
  const ticks = Math.ceil((price - tickSize * 1e-10) / tickSize)
  return Number((ticks * tickSize).toFixed(precision))
}

export function roundQuantityDown(quantity, stepSize = 0) {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be non-negative")
  }

  if (!Number.isFinite(stepSize) || stepSize < 0) {
    throw new Error("stepSize must be non-negative")
  }

  if (stepSize === 0) {
    return Math.floor(quantity * 1e8) / 1e8
  }

  const precision = getTickPrecision(stepSize)
  const steps = Math.floor((quantity + stepSize * 1e-10) / stepSize)
  return Number((steps * stepSize).toFixed(precision))
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
