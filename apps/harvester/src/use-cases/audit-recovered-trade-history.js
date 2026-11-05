import { Fill } from "@coinzilla/entities"
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
 * Prove that complete account-wide exchange trade history since the durable
 * baseline is exactly represented by Journal-applied fills.
 *
 * The caller must only set complete=true after enumerating every relevant
 * exchange symbol and exhausting every history page. Partial history is never
 * accepted as evidence that no external/manual execution occurred.
 */
export function auditRecoveredTradeHistory({
  journalFills,
  exchangeFills,
  complete = false,
  marketUniverseComplete = false,
} = {}) {
  try {
    if (complete !== true) {
      throw new Error("Account-wide exchange trade history pages are incomplete; external execution ownership cannot be proven")
    }
    const journalRecords = requireArray({ value: journalFills, field: "journalFills" })
    const exchangeRecords = requireArray({ value: exchangeFills, field: "exchangeFills" })

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
        throw new Error("Exchange account trade history contains an execution absent from the Harvester Journal: " + fillId)
      }
      assertFillParity({ journalFill, exchangeFill })
    }
    for (const fillId of journalById.keys()) {
      if (!exchangeById.has(fillId)) {
        throw new Error("Durable Journal execution is missing from complete exchange account trade history: " + fillId)
      }
    }

    if (marketUniverseComplete !== true) {
      throw new Error("Account-wide exchange market universe is incomplete; unenumerated external executions cannot be excluded")
    }

    return toResult({
      data: Object.freeze({
        complete: true,
        marketUniverseComplete: true,
        fillsChecked: exchangeById.size,
        journalFillsChecked: journalById.size,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
