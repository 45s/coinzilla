import { CanonicalOrder, Fill, Market } from "@coinzilla/entities"
import { compareDecimal, toResult } from "@coinzilla/utils"

function requireArray({ value, field }) {
  if (!Array.isArray(value)) throw new TypeError(field + " must be an array")
  return value
}

function requireString({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value
}

function getJournalCommissionFacts({ commissions }) {
  return commissions.map((commission, index) => ({
    amount: requireString({ value: commission?.amount, field: "Journal commissions[" + index + "].amount" }),
    assetId: requireString({ value: commission?.assetId, field: "Journal commissions[" + index + "].assetId" }),
    asset: requireString({ value: commission?.asset, field: "Journal commissions[" + index + "].asset" }),
  })).sort(compareCommissionFacts)
}

function getExchangeCommissionFacts({ fill }) {
  return fill.commissions.map((commission, index) => ({
    amount: requireString({
      value: commission?.amount?.amount,
      field: "Exchange fill commissions[" + index + "].amount",
    }),
    assetId: requireString({
      value: commission?.amount?.asset?.id,
      field: "Exchange fill commissions[" + index + "].assetId",
    }),
    asset: requireString({
      value: commission?.amount?.asset?.code,
      field: "Exchange fill commissions[" + index + "].asset",
    }),
  })).sort(compareCommissionFacts)
}

function compareCommissionFacts(left, right) {
  return (left.assetId + ":" + left.asset + ":" + left.amount)
    .localeCompare(right.assetId + ":" + right.asset + ":" + right.amount)
}

function assertFillParity({ journalFill, exchangeFill }) {
  const mismatch = (field) => {
    throw new Error("Account trade history conflicts with durable Journal " + field + " for execution " + journalFill.fillId)
  }
  if (
    exchangeFill.id !== journalFill.fillId ||
    String(exchangeFill.tradeId) !== journalFill.tradeId ||
    exchangeFill.brokerOrderId !== journalFill.brokerOrderId ||
    (exchangeFill.clientOrderId !== undefined &&
      exchangeFill.clientOrderId !== journalFill.clientOrderId) ||
    exchangeFill.market.symbol !== journalFill.symbol ||
    exchangeFill.side !== journalFill.side ||
    exchangeFill.liquidityRole !== journalFill.liquidityRole ||
    exchangeFill.commissionStatus !== journalFill.commissionStatus
  ) mismatch("identity or execution metadata")

  for (const [field, actual, expected] of [
    ["price", exchangeFill.price.amount, journalFill.price],
    ["quantity", exchangeFill.quantity.amount, journalFill.quantity],
    ["quoteQuantity", exchangeFill.quoteQuantity.amount, journalFill.quoteQuantity],
  ]) {
    if (compareDecimal({ left: actual, right: expected }) !== 0) mismatch(field)
  }
  if (journalFill.executedAt !== undefined && exchangeFill.executedAt !== journalFill.executedAt) {
    mismatch("transaction timestamp")
  }

  const expectedCommissions = getJournalCommissionFacts({ commissions: journalFill.commissions })
  const actualCommissions = getExchangeCommissionFacts({ fill: exchangeFill })
  if (JSON.stringify(actualCommissions) !== JSON.stringify(expectedCommissions)) {
    mismatch("commission facts")
  }
}

/**
 * Prove that exchange trade history is represented by Journal-applied fills.
 *
 * ACCOUNT scope requires exhaustive history pages and an independently
 * established complete market universe. MARKET scope proves only the requested
 * canonical Market and requires the structured evidence returned by
 * fetchAccountTradeHistory; it never claims account-wide completeness.
 */
export function auditRecoveredTradeHistory({
  journalFills,
  exchangeFills,
  complete = false,
  marketUniverseComplete = false,
  ownedOrders = [],
  scope = "ACCOUNT",
  market,
  historyEvidence,
  historyRetentionEvidence,
} = {}) {
  try {
    if (!["ACCOUNT", "MARKET"].includes(scope)) {
      throw new TypeError('scope must be "ACCOUNT" or "MARKET"')
    }
    if (scope === "ACCOUNT" && complete !== true) {
      throw new Error("Account-wide exchange trade history pages are incomplete; external execution ownership cannot be proven")
    }
    if (scope === "MARKET" && !(market instanceof Market)) {
      throw new TypeError("MARKET trade-history scope requires a canonical Market")
    }
    if (scope === "ACCOUNT" && marketUniverseComplete === true) {
      throw new Error("Caller-supplied marketUniverseComplete is not authoritative evidence; account-wide history cannot be certified from the current exchange catalog")
    }
    if (scope === "MARKET") {
      if (marketUniverseComplete === true) {
        throw new Error("Single-market trade history cannot prove account-wide market-universe completeness")
      }
      if (historyEvidence?.historyPagesComplete !== true ||
          historyEvidence?.marketHistoryPagesComplete !== true ||
          historyEvidence?.historyScope !== "MARKET" ||
          !Array.isArray(historyEvidence.marketsQueried) ||
          historyEvidence.marketsQueried.length !== 1 ||
          historyEvidence.marketsQueried[0] !== market.symbol ||
          !Number.isSafeInteger(historyEvidence.historyStartTime) ||
          historyEvidence.historyStartTime < 0) {
        throw new Error("Single-market trade-history pagination evidence is missing or does not cover " + market.symbol)
      }
      if (!historyRetentionEvidence ||
          historyRetentionEvidence.factType !== "MARKET_HISTORY_COVERAGE_CONFIRMED" ||
          typeof historyRetentionEvidence.baselineFactId !== "string" ||
          !historyRetentionEvidence.baselineFactId.trim() ||
          historyRetentionEvidence.symbol !== market.symbol ||
          !Number.isSafeInteger(historyRetentionEvidence.coveredFromTime) ||
          historyRetentionEvidence.coveredFromTime < 0 ||
          historyRetentionEvidence.coveredFromTime > historyEvidence.historyStartTime ||
          !Number.isSafeInteger(historyRetentionEvidence.verifiedAt) ||
          historyRetentionEvidence.verifiedAt < historyRetentionEvidence.coveredFromTime) {
        throw new Error("Durable market-history retention evidence is missing or does not cover " + market.symbol)
      }
    }
    const allJournalRecords = requireArray({ value: journalFills, field: "journalFills" })
    const allExchangeRecords = requireArray({ value: exchangeFills, field: "exchangeFills" })
    const allOwnedOrderRecords = requireArray({ value: ownedOrders, field: "ownedOrders" })
    if (scope === "MARKET") {
      for (const [index, fill] of allJournalRecords.entries()) {
        requireString({ value: fill?.symbol, field: "journalFills[" + index + "].symbol" })
      }
      for (const [index, fill] of allExchangeRecords.entries()) {
        if (!(fill instanceof Fill)) {
          throw new TypeError("exchangeFills[" + index + "] must be a canonical Fill")
        }
        if (fill.market.symbol !== market.symbol) {
          throw new Error("Single-market exchange history contains a fill for another market: " + fill.market.symbol)
        }
      }
      for (const [index, order] of allOwnedOrderRecords.entries()) {
        if (!(order instanceof CanonicalOrder)) {
          throw new TypeError("ownedOrders[" + index + "] must be a canonical order")
        }
      }
    }
    const journalRecords = scope === "MARKET"
      ? allJournalRecords.filter((fill) => fill?.symbol === market.symbol)
      : allJournalRecords
    const exchangeRecords = scope === "MARKET"
      ? allExchangeRecords.filter((fill) => fill?.market?.symbol === market.symbol)
      : allExchangeRecords
    const ownedOrderRecords = scope === "MARKET"
      ? allOwnedOrderRecords.filter((order) => order?.market?.symbol === market.symbol)
      : allOwnedOrderRecords
    const ownedOrdersByBrokerId = new Map()
    for (const [index, order] of ownedOrderRecords.entries()) {
      if (!(order instanceof CanonicalOrder) ||
          typeof order.brokerOrderId !== "string" ||
          !order.brokerOrderId.trim()) {
        throw new TypeError("ownedOrders[" + index + "] must be a canonical acknowledged order")
      }
      if (ownedOrdersByBrokerId.has(order.brokerOrderId)) {
        throw new Error("Recovered order registry contains duplicate broker order ID " + order.brokerOrderId)
      }
      ownedOrdersByBrokerId.set(order.brokerOrderId, order)
    }

    const journalById = new Map()
    const journalTradeIds = new Map()
    for (const [index, fill] of journalRecords.entries()) {
      const fillId = requireString({ value: fill?.fillId, field: "journalFills[" + index + "].fillId" })
      const tradeId = requireString({ value: fill?.tradeId, field: "journalFills[" + index + "].tradeId" })
      const tradeKey = fill.symbol + ":" + tradeId
      if (journalById.has(fillId)) throw new Error("Journal contains duplicate execution identity " + fillId)
      if (journalTradeIds.has(tradeKey)) throw new Error("Journal maps one exchange trade ID to multiple execution identities " + tradeKey)
      journalById.set(fillId, fill)
      journalTradeIds.set(tradeKey, fillId)
    }

    const exchangeById = new Map()
    const exchangeTradeIds = new Map()
    let reconciledOwnedOrderFills = 0
    for (const [index, fill] of exchangeRecords.entries()) {
      if (!(fill instanceof Fill)) {
        throw new TypeError("exchangeFills[" + index + "] must be a canonical Fill")
      }
      if (exchangeById.has(fill.id)) throw new Error("Exchange trade history contains duplicate execution identity " + fill.id)
      const tradeKey = fill.market.symbol + ":" + fill.tradeId
      if (exchangeTradeIds.has(tradeKey)) {
        throw new Error("Exchange trade history maps one trade ID to multiple execution identities " + tradeKey)
      }
      exchangeById.set(fill.id, fill)
      exchangeTradeIds.set(tradeKey, fill.id)
    }

    for (const [fillId, exchangeFill] of exchangeById) {
      const journalFill = journalById.get(fillId)
      if (!journalFill) {
        const ownedOrder = ownedOrdersByBrokerId.get(exchangeFill.brokerOrderId)
        if (
          !ownedOrder ||
          ownedOrder.market.symbol !== exchangeFill.market.symbol ||
          ownedOrder.side !== exchangeFill.side ||
          (exchangeFill.clientOrderId !== undefined &&
            exchangeFill.clientOrderId !== ownedOrder.clientOrderId)
        ) {
          throw new Error("Exchange account trade history contains an execution absent from the Harvester Journal and recovered order registry: " + fillId)
        }
        reconciledOwnedOrderFills += 1
        continue
      }
      assertFillParity({ journalFill, exchangeFill })
    }
    for (const fillId of journalById.keys()) {
      if (!exchangeById.has(fillId)) {
        throw new Error("Durable Journal execution is missing from complete exchange account trade history: " + fillId)
      }
    }

    if (scope === "ACCOUNT" && marketUniverseComplete !== true) {
      throw new Error("Account-wide exchange market universe is incomplete; unenumerated external executions cannot be excluded")
    }

    return toResult({
      data: Object.freeze({
        complete: true,
        scope,
        marketUniverseComplete: scope === "ACCOUNT",
        ...(scope === "MARKET" ? {
          marketSymbol: market.symbol,
          historyStartTime: historyEvidence.historyStartTime,
          historyRetentionBaselineFactId: historyRetentionEvidence.baselineFactId,
          historyRetentionFactType: historyRetentionEvidence.factType,
          historyRetentionVerifiedAt: historyRetentionEvidence.verifiedAt,
        } : {}),
        fillsChecked: exchangeById.size,
        journalFillsChecked: journalById.size,
        reconciledOwnedOrderFills,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
