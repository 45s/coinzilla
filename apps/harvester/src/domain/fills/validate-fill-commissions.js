import { addDecimal, assertDecimalString, compareDecimal } from "@coinzilla/utils"

function registerAssetIdentity({ asset, assetIdsByCode, assetCodesById, field }) {
  const id = asset?.id
  const code = asset?.code
  if (typeof id !== "string" || !id.trim() || typeof code !== "string" || !code.trim()) {
    throw new TypeError(field + " must contain a non-empty asset ID and code")
  }
  const knownCode = assetCodesById.get(id)
  const knownId = assetIdsByCode.get(code)
  if ((knownCode !== undefined && knownCode !== code) ||
      (knownId !== undefined && knownId !== id)) {
    throw new TypeError(field + " has a contradictory asset ID/code identity")
  }
  assetCodesById.set(id, code)
  assetIdsByCode.set(code, id)
}

/**
 * Validate actual commission facts before either accounting projection is
 * calculated. Limits apply to the aggregate commission charged in each
 * market asset, not to each entry independently.
 *
 * @param {object} input
 * @param {object} input.market Canonical market.
 * @param {object} input.fill Canonical fill.
 * @returns {{ baseCommission: string, quoteCommission: string, thirdAssetQuoteValue: string }}
 */
export function validateFillCommissions({ market, fill } = {}) {
  if (!market || !fill) {
    throw new TypeError("validateFillCommissions requires market and fill")
  }
  if (fill.market?.id !== market.id) {
    throw new TypeError("Fill market does not match commission validation market")
  }
  if (fill.commissionStatus !== "COMPLETE") {
    throw new TypeError("Fill requires complete commission data")
  }
  if (!Array.isArray(fill.commissions)) {
    throw new TypeError("Fill.commissions must be an array")
  }

  const assetIdsByCode = new Map()
  const assetCodesById = new Map()
  registerAssetIdentity({
    asset: market.baseAsset,
    assetIdsByCode,
    assetCodesById,
    field: "market.baseAsset",
  })
  registerAssetIdentity({
    asset: market.quoteAsset,
    assetIdsByCode,
    assetCodesById,
    field: "market.quoteAsset",
  })

  let baseCommission = "0"
  let quoteCommission = "0"
  let thirdAssetQuoteValue = "0"
  for (const commission of fill.commissions) {
    const amount = commission?.amount
    assertDecimalString({ value: amount?.amount, field: "commission.amount" })
    if (compareDecimal({ left: amount.amount, right: "0" }) < 0) {
      throw new RangeError("Commission amount must be non-negative")
    }
    if (compareDecimal({ left: amount.amount, right: "0" }) === 0) continue

    registerAssetIdentity({
      asset: amount.asset,
      assetIdsByCode,
      assetCodesById,
      field: "commission.amount.asset",
    })

    if (amount.asset.id === market.baseAsset.id) {
      baseCommission = addDecimal({ left: baseCommission, right: amount.amount })
      continue
    }
    if (amount.asset.id === market.quoteAsset.id) {
      quoteCommission = addDecimal({ left: quoteCommission, right: amount.amount })
      continue
    }
    const quoteValue = commission?.quoteValue
    if (!quoteValue) {
      throw new TypeError(
        "Third-asset commission requires reliable quote-currency valuation: " +
        String(amount.asset?.code ?? "unknown"),
      )
    }
    assertDecimalString({ value: quoteValue.amount, field: "commission.quoteValue.amount" })
    registerAssetIdentity({
      asset: quoteValue.asset,
      assetIdsByCode,
      assetCodesById,
      field: "commission.quoteValue.asset",
    })
    if (quoteValue.asset?.id !== market.quoteAsset.id ||
        quoteValue.asset?.code !== market.quoteAsset.code) {
      throw new TypeError("Third-asset commission quote value must use the market quote asset")
    }
    if (compareDecimal({ left: quoteValue.amount, right: "0" }) <= 0) {
      throw new RangeError("Third-asset commission quote value must be greater than zero")
    }
    thirdAssetQuoteValue = addDecimal({
      left: thirdAssetQuoteValue,
      right: quoteValue.amount,
    })
  }

  assertDecimalString({ value: fill.quantity?.amount, field: "fill.quantity.amount" })
  assertDecimalString({ value: fill.quoteQuantity?.amount, field: "fill.quoteQuantity.amount" })
  if (compareDecimal({ left: baseCommission, right: fill.quantity.amount }) > 0) {
    throw new RangeError("Base commission exceeds executed base quantity")
  }
  if (compareDecimal({ left: quoteCommission, right: fill.quoteQuantity.amount }) > 0) {
    const limit = fill.side === "SELL" ? "SELL quote proceeds" : "executed quote notional"
    throw new RangeError("Quote commission exceeds " + limit)
  }

  return Object.freeze({ baseCommission, quoteCommission, thirdAssetQuoteValue })
}
