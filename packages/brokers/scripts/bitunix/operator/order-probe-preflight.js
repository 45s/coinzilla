import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { createSpotOrderRequest } from "../../../src/infrastructure/bitunix/spot/adapters/order-requests.js"
import { assertSuccessfulBrokerResult } from "../helpers/create-hypeusdt-order-preflight.js"
import { createBitunixOrderProbeInput, getBitunixOrderProbe } from "./order-probe-matrix.js"

function requireArrayResult({ result, operation }) {
  const value = assertSuccessfulBrokerResult({
    result,
    operation,
  })
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix order probe preflight ${operation} must return an array`)
  }
  return value
}

function requireExactNonNegativeAmount({ value, field }) {
  const amount = assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: amount,
    right: "0",
  }) < 0) {
    throw new RangeError(`${field} must be non-negative`)
  }
  return amount
}

function findAssetBalance({ balances, asset, required }) {
  const row = balances.find(({ free }) => free?.asset?.code === asset)
  if (!row) {
    if (required) {
      throw new Error(`Bitunix order probe requires an explicit ${asset} balance row; missing is not assumed to mean zero`)
    }
    return {
      free: null,
      locked: null,
    }
  }
  return {
    free: requireExactNonNegativeAmount({
      value: row.free.amount,
      field: `free ${asset} balance`,
    }),
    locked: requireExactNonNegativeAmount({
      value: row.locked?.amount,
      field: `locked ${asset} balance`,
    }),
  }
}

function validateActiveHypeUsdtMarket({ markets, filters }) {
  const market = markets.find(({ symbol }) => symbol === "HYPEUSDT")
  if (!market ||
      market.baseAsset?.code !== "HYPE" ||
      market.quoteAsset?.code !== "USDT") {
    throw new Error("Bitunix order probe requires an explicitly listed HYPEUSDT market with HYPE/USDT asset identity")
  }
  if (filters?.symbol !== "HYPEUSDT" ||
      filters.base !== "HYPE" ||
      filters.quote !== "USDT" ||
      (filters.isOpen !== "1" && filters.isOpen !== 1)) {
    throw new Error("Bitunix order probe requires matching, explicitly open HYPEUSDT symbol metadata")
  }
  return {
    basePrecision: Number(filters.basePrecision),
    quotePrecision: Number(filters.quotePrecision),
    minimumQuantity: requireExactNonNegativeAmount({
      value: filters.minVolume,
      field: "HYPEUSDT minVolume",
    }),
    minimumNotional: requireExactNonNegativeAmount({
      value: filters.minPrice,
      field: "HYPEUSDT minPrice",
    }),
  }
}


function decimalParts(value) {
  const [whole, fraction = ""] = String(value).split(".")
  return { integer: BigInt(`${whole}${fraction}`), scale: fraction.length }
}

function formatScaled(value, scale) {
  const digits = value.toString().padStart(scale + 1, "0")
  if (scale === 0) return digits
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\\.?0+$/, "")
}

function divideToPrecision({ numerator, denominator, precision }) {
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 18) {
    throw new Error("Bitunix HYPEUSDT basePrecision is missing or invalid")
  }
  const a = decimalParts(numerator)
  const b = decimalParts(denominator)
  const exponent = precision + b.scale - a.scale
  const dividend = exponent >= 0 ? a.integer * (10n ** BigInt(exponent)) : a.integer / (10n ** BigInt(-exponent))
  return formatScaled(dividend / b.integer, precision)
}

function multiplyDecimals(left, right) {
  const a = decimalParts(left)
  const b = decimalParts(right)
  return formatScaled(a.integer * b.integer, a.scale + b.scale)
}

function addDecimals(left, right) {
  const a = decimalParts(left)
  const b = decimalParts(right)
  const scale = Math.max(a.scale, b.scale)
  const leftValue = a.integer * (10n ** BigInt(scale - a.scale))
  const rightValue = b.integer * (10n ** BigInt(scale - b.scale))
  return formatScaled(leftValue + rightValue, scale)
}

function assertProbeBalanceIsInsufficient({ probe, freeBase, freeQuote }) {
  if (probe.spendingAmount !== undefined) {
    const required = addDecimals(probe.spendingAmount, probe.feeReserve)
    if (compareDecimal({ left: freeQuote, right: required }) < 0) {
      throw new Error(`Bitunix funded BUY blocked: free USDT ${freeQuote} is below ${required} USDT (11 USDT spend plus 0.24 USDT reserve)`)
    }
    return
  }
  if (probe.type === "LIMIT" && probe.side === "BUY" &&
      compareDecimal({
        left: freeQuote,
        right: probe.quoteNotional,
      }) >= 0) {
    throw new Error("Bitunix order probe blocked: free USDT can cover this BUY LIMIT notional")
  }
  if (probe.type === "LIMIT" && probe.side === "SELL" &&
      freeBase !== null &&
      compareDecimal({
        left: freeBase,
        right: probe.quantity,
      }) >= 0) {
    throw new Error("Bitunix order probe blocked: free HYPE can cover this SELL LIMIT quantity")
  }
  if (probe.type === "MARKET" &&
      (compareDecimal({
        left: freeQuote,
        right: probe.quoteQuantity,
      }) >= 0 ||
      compareDecimal({
        left: freeBase,
        right: probe.quoteQuantity,
      }) >= 0)) {
    throw new Error("Bitunix order probe blocked: an asset balance could satisfy one of the conflicting documented MARKET volume denominations")
  }
}

function createBalanceSummary({ balances, probe }) {
  const baseRequired = probe.type === "MARKET"
  const quoteRequired = probe.type === "MARKET" ||
    (probe.type === "LIMIT" && probe.side === "BUY")
  const base = findAssetBalance({
    balances,
    asset: "HYPE",
    required: baseRequired,
  })
  const quote = findAssetBalance({
    balances,
    asset: "USDT",
    required: quoteRequired,
  })
  return {
    freeBaseBalance: base.free,
    lockedBaseBalance: base.locked,
    freeQuoteBalance: quote.free,
    lockedQuoteBalance: quote.locked,
  }
}

function assertNoOpenOrders({ openOrders }) {
  if (openOrders.length > 0) {
    throw new Error("Bitunix order probe blocked: HYPEUSDT has existing open orders")
  }
}


function createPreflightResult({
  probe,
  orderInput,
  wireRequest,
  minimumQuantity,
  minimumNotional,
  balanceSummary,
  openOrderCount,
}) {
  return Object.freeze({
    probe,
    orderInput,
    wireRequest,
    minimumQuantity,
    minimumNotional,
    belowMinimumQuantity: probe.quantity !== undefined &&
      compareDecimal({
        left: probe.quantity,
        right: minimumQuantity,
      }) < 0,
    belowMinimumNotional: compareDecimal({
      left: probe.quoteNotional,
      right: minimumNotional,
    }) < 0,
    ...balanceSummary,
    baseBalanceUnreported: probe.type === "LIMIT" &&
      probe.side === "SELL" &&
      balanceSummary.freeBaseBalance === null,
    openOrderCount,
  })
}

/**
 * Validate fresh read-only exchange facts for one explicitly selected probe.
 * Intentionally does not reject below-minimum probes; those are part of the
 * controlled exchange-rejection investigation and are clearly displayed.
 *
 * @param {object} input
 * @param {string} input.probeId Reviewed probe identifier.
 * @param {object} input.marketResult Broker getExchangeMarkets() result.
 * @param {object} input.filtersResult Broker getSymbolFilters() result.
 * @param {object} input.balancesResult Broker getBalances() result.
 * @param {object} input.openOrdersResult Broker getOpenOrders() result.
 * @returns {Readonly<object>} Exact probe intent, wire request and read-only facts.
 */
export function createBitunixOrderProbePreflight({
  probeId,
  marketResult,
  filtersResult,
  balancesResult,
  openOrdersResult,
} = {}) {
  const probe = getBitunixOrderProbe({
    probeId,
  })
  const markets = requireArrayResult({
    result: marketResult,
    operation: "market catalog",
  })
  const filters = assertSuccessfulBrokerResult({
    result: filtersResult,
    operation: "symbol metadata",
  })
  const metadata = validateActiveHypeUsdtMarket({
    markets,
    filters,
  })
  const balances = requireArrayResult({
    result: balancesResult,
    operation: "account balances",
  })
  const balanceSummary = createBalanceSummary({
    balances,
    probe,
  })
  let resolvedProbe = probe
  let calculatedQuantity
  if (probe.spendingAmount !== undefined) {
    if (!Number.isSafeInteger(metadata.basePrecision) || metadata.basePrecision < 0 ||
        !Number.isSafeInteger(metadata.quotePrecision) || metadata.quotePrecision < 0) {
      throw new Error("Bitunix HYPEUSDT basePrecision/quotePrecision metadata is missing or invalid; refusing to guess order precision")
    }
    if ((probe.price.split(".")[1]?.length ?? 0) > metadata.quotePrecision) {
      throw new Error("Configured HYPEUSDT price exceeds live quotePrecision")
    }
    calculatedQuantity = divideToPrecision({
      numerator: probe.spendingAmount,
      denominator: probe.price,
      precision: metadata.basePrecision,
    })
    const actualNotional = multiplyDecimals(calculatedQuantity, probe.price)
    resolvedProbe = Object.freeze({ ...probe, quantity: calculatedQuantity, quoteNotional: actualNotional })
    if (compareDecimal({ left: calculatedQuantity, right: metadata.minimumQuantity }) < 0 ||
        compareDecimal({ left: actualNotional, right: metadata.minimumNotional }) < 0) {
      throw new Error("Calculated HYPEUSDT order is below Bitunix live minimum quantity or notional")
    }
  }
  assertProbeBalanceIsInsufficient({
    probe: resolvedProbe,
    freeBase: balanceSummary.freeBaseBalance,
    freeQuote: balanceSummary.freeQuoteBalance,
  })
  const openOrders = requireArrayResult({
    result: openOrdersResult,
    operation: "symbol-scoped open orders",
  })
  assertNoOpenOrders({
    openOrders,
  })
  const orderInput = createBitunixOrderProbeInput({
    probeId,
    quantity: calculatedQuantity,
  })
  const request = createSpotOrderRequest({
    input: orderInput,
  })
  return createPreflightResult({
    probe: resolvedProbe,
    orderInput,
    wireRequest: request.body,
    minimumQuantity: metadata.minimumQuantity,
    minimumNotional: metadata.minimumNotional,
    balanceSummary,
    openOrderCount: openOrders.length,
  })
}
