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

  return Math.floor((price + Number.EPSILON) / tickSize) * tickSize
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

  return Math.ceil((price - Number.EPSILON) / tickSize) * tickSize
}

export function calculateSellPlan({
  activeQuantity,
  keepQuantity,
  cycleCost,
  saleProceeds,
  minProfit,
  feeRate,
  priceTickSize = 0,
}) {
  const values = {
    activeQuantity,
    keepQuantity,
    cycleCost,
    saleProceeds,
    minProfit,
    feeRate,
    priceTickSize,
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
    priceTickSize < 0
  ) {
    throw new Error("Invalid sell plan inputs")
  }

  const quantity = Math.max(0, (activeQuantity - keepQuantity) / (1 + feeRate))

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
    requiredNetProceeds,
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
