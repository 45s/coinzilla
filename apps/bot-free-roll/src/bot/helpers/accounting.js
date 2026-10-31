import { addDecimal, compareDecimal, divideDecimal, maxDecimal, multiplyDecimal, subtractDecimal, assertDecimalString } from "./decimal.js"

export function getFeeRate({ makerPercent, takerPercent }) {
  for (const [name, percent] of Object.entries({ makerPercent, takerPercent })) {
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
      throw new Error(`${name} must be a number from 0 (inclusive) to 100 (exclusive)`)
    }
  }

  // Use the higher configured rate for both sides to keep estimates conservative.
  return Math.max(makerPercent, takerPercent) / 100
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


// Exact financial accounting used by the Free-Roll orchestrator.
// Inputs and outputs are decimal strings; Number is intentionally not used.
export function getFeeRateExact({ makerPercent, takerPercent }) {
  for (const [name, percent] of Object.entries({ makerPercent, takerPercent })) {
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
      throw new Error(`${name} must be a number from 0 (inclusive) to 100 (exclusive)`);
    }
  }

  const makerRate = divideDecimal({ left: String(makerPercent), right: "100", scale: 18, rounding: "half-up" });
  const takerRate = divideDecimal({ left: String(takerPercent), right: "100", scale: 18, rounding: "half-up" });
  return maxDecimal({ left: makerRate, right: takerRate });
}

export function estimateBuyAccountingExact({ quantity, price, feeRate }) {
  for (const [name, value] of Object.entries({ quantity, price, feeRate })) {
    assertDecimalString(value, name);
  }
  if (compareDecimal({ left: quantity, right: "0" }) <= 0 ||
      compareDecimal({ left: price, right: "0" }) <= 0 ||
      compareDecimal({ left: feeRate, right: "0" }) < 0 ||
      compareDecimal({ left: feeRate, right: "1" }) >= 0) {
    throw new Error("Invalid buy accounting inputs");
  }

  return {
    netQuantity: multiplyDecimal({
      left: quantity,
      right: subtractDecimal({ left: "1", right: feeRate }),
    }),
    estimatedCost: multiplyDecimal({
      left: multiplyDecimal({ left: quantity, right: price }),
      right: addDecimal({ left: "1", right: feeRate }),
    }),
  };
}

export function estimateSellAccountingExact({ quantity, price, feeRate }) {
  for (const [name, value] of Object.entries({ quantity, price, feeRate })) {
    assertDecimalString(value, name);
  }
  if (compareDecimal({ left: quantity, right: "0" }) < 0 ||
      compareDecimal({ left: price, right: "0" }) <= 0 ||
      compareDecimal({ left: feeRate, right: "0" }) < 0 ||
      compareDecimal({ left: feeRate, right: "1" }) >= 0) {
    throw new Error("Invalid sell accounting inputs");
  }

  return {
    estimatedProceeds: multiplyDecimal({
      left: multiplyDecimal({ left: quantity, right: price }),
      right: subtractDecimal({ left: "1", right: feeRate }),
    }),
    estimatedBaseDeduction: multiplyDecimal({
      left: quantity,
      right: addDecimal({ left: "1", right: feeRate }),
    }),
  };
}

export function getOrderType({ makerPercent }) {
  if (!Number.isFinite(makerPercent) || makerPercent < 0 || makerPercent >= 100) {
    throw new Error("makerPercent must be a number from 0 (inclusive) to 100 (exclusive)");
  }

  return makerPercent === 0 ? "LIMIT_MAKER" : "LIMIT";
}

export function getConfiguredSellFeeRateExact({ makerPercent, takerPercent }) {
  const orderType = getOrderType({ makerPercent });
  const configuredRate = getFeeRateExact({ makerPercent, takerPercent });

  return orderType === "LIMIT_MAKER" ? "0" : configuredRate;
}

export function calculateFillAccountingExact({
  side,
  quantity,
  quoteQuantity,
  commissionAmount,
  commissionAsset,
  baseAsset,
  quoteAsset,
}) {
  for (const [name, value] of Object.entries({
    quantity,
    quoteQuantity,
    commissionAmount,
  })) {
    assertDecimalString(value, name);
  }

  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("side must be BUY or SELL");
  }
  if (typeof baseAsset !== "string" || !baseAsset.trim() ||
      typeof quoteAsset !== "string" || !quoteAsset.trim() ||
      baseAsset === quoteAsset) {
    throw new Error("baseAsset and quoteAsset must be distinct non-empty strings");
  }
  if (compareDecimal({ left: quantity, right: "0" }) <= 0 ||
      compareDecimal({ left: quoteQuantity, right: "0" }) <= 0 ||
      compareDecimal({ left: commissionAmount, right: "0" }) < 0) {
    throw new Error("Fill quantity, quote quantity, and commission must be non-negative; trade quantities must be positive");
  }

  const hasCommission = compareDecimal({ left: commissionAmount, right: "0" }) > 0;
  if (hasCommission && !commissionAsset) {
    throw new Error("A non-zero commission must include its asset");
  }
  if (hasCommission && commissionAsset !== baseAsset && commissionAsset !== quoteAsset) {
    throw new Error(`Unsupported commission asset: ${commissionAsset}`);
  }

  const baseCommission = hasCommission && commissionAsset === baseAsset
    ? commissionAmount
    : "0";
  const quoteCommission = hasCommission && commissionAsset === quoteAsset
    ? commissionAmount
    : "0";

  const baseQuantity = side === "BUY"
    ? subtractDecimal({ left: quantity, right: baseCommission })
    : addDecimal({ left: quantity, right: baseCommission });
  const netQuoteQuantity = side === "BUY"
    ? addDecimal({ left: quoteQuantity, right: quoteCommission })
    : subtractDecimal({ left: quoteQuantity, right: quoteCommission });

  if (compareDecimal({ left: baseQuantity, right: "0" }) <= 0 ||
      compareDecimal({ left: netQuoteQuantity, right: "0" }) < 0) {
    throw new Error("Commission exceeds the corresponding fill amount");
  }

  return {
    baseQuantity,
    quoteQuantity: netQuoteQuantity,
  };
}


export function calculateCommissionRateExact({
  price,
  quoteQuantity,
  commissionAmount,
  commissionAsset,
  baseAsset,
  quoteAsset,
}) {
  for (const [name, value] of Object.entries({
    price,
    quoteQuantity,
    commissionAmount,
  })) {
    assertDecimalString(value, name);
  }

  if (compareDecimal({ left: price, right: "0" }) <= 0 ||
      compareDecimal({ left: quoteQuantity, right: "0" }) <= 0 ||
      compareDecimal({ left: commissionAmount, right: "0" }) < 0) {
    throw new Error("Price and quote quantity must be positive; commission must be non-negative");
  }
  if (typeof baseAsset !== "string" || !baseAsset.trim() ||
      typeof quoteAsset !== "string" || !quoteAsset.trim() ||
      baseAsset === quoteAsset) {
    throw new Error("baseAsset and quoteAsset must be distinct non-empty strings");
  }

  if (compareDecimal({ left: commissionAmount, right: "0" }) === 0) return "0";

  let quoteCommission;
  if (commissionAsset === quoteAsset) {
    quoteCommission = commissionAmount;
  } else if (commissionAsset === baseAsset) {
    quoteCommission = multiplyDecimal({
      left: commissionAmount,
      right: price,
    });
  } else {
    throw new Error(`Unsupported commission asset: ${commissionAsset ?? "unknown"}`);
  }

  return divideDecimal({
    left: quoteCommission,
    right: quoteQuantity,
    scale: 18,
    rounding: "away-from-zero",
  });
}
