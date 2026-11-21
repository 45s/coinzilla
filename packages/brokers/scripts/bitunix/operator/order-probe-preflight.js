import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { createSpotOrderRequest } from "../../../src/infrastructure/bitunix/spot/adapters/order-requests.js"
import { assertSuccessfulBrokerResult } from "../helpers/create-hypeusdt-order-preflight.js"
import { getBitunixOrderProbe } from "./order-probe-matrix.js"

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

function findAssetBalance({ balances, asset }) {
  const row = balances.find(({ free }) => free?.asset?.code === asset)
  if (!row) {
    throw new Error(`Bitunix order probe requires an explicit ${asset} balance row; missing is not assumed to mean zero`)
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

function assertProbeBalanceIsInsufficient({ probe, freeBase, freeQuote }) {
  if (probe.type === "LIMIT" && probe.side === "BUY" &&
      compareDecimal({
        left: freeQuote,
        right: probe.quoteNotional,
      }) >= 0) {
    throw new Error("Bitunix order probe blocked: free USDT can cover this BUY LIMIT notional")
  }
  if (probe.type === "LIMIT" && probe.side === "SELL" &&
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

function createBalanceSummary({ balances }) {
  const base = findAssetBalance({
    balances,
    asset: "HYPE",
  })
  const quote = findAssetBalance({
    balances,
    asset: "USDT",
  })
  return {
    freeBaseBalance: base.free,
    lockedBaseBalance: base.locked,
    freeQuoteBalance: quote.free,
    lockedQuoteBalance: quote.locked,
  }
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
  const { minimumQuantity, minimumNotional } = validateActiveHypeUsdtMarket({
    markets,
    filters,
  })
  const balances = requireArrayResult({
    result: balancesResult,
    operation: "account balances",
  })
  const balanceSummary = createBalanceSummary({
    balances,
  })
  assertProbeBalanceIsInsufficient({
    probe,
    freeBase: balanceSummary.freeBaseBalance,
    freeQuote: balanceSummary.freeQuoteBalance,
  })
  const openOrders = requireArrayResult({
    result: openOrdersResult,
    operation: "symbol-scoped open orders",
  })
  if (openOrders.length > 0) {
    throw new Error("Bitunix order probe blocked: HYPEUSDT has existing open orders")
  }
  const orderInput = Object.freeze({
    symbol: probe.symbol,
    side: probe.side,
    type: probe.type,
    ...(probe.quantity === undefined ? {} : { quantity: probe.quantity }),
    ...(probe.quoteQuantity === undefined ? {} : { quoteQuantity: probe.quoteQuantity }),
    ...(probe.price === undefined ? {} : { price: probe.price }),
  })
  const request = createSpotOrderRequest({
    input: orderInput,
  })
  return Object.freeze({
    probe,
    orderInput,
    wireRequest: request.body,
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
    openOrderCount: openOrders.length,
  })
}
