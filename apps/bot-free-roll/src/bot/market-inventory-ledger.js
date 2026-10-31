import { calculateFillAccountingExact } from "./helpers/accounting.js"
import {
  addDecimal,
  compareDecimal,
  subtractDecimal,
} from "./helpers/decimal.js"

function failure(reason) {
  return { ok: false, reason }
}

function isMarketInventoryLedger(ledger) {
  return Boolean(
    ledger &&
    typeof ledger === "object" &&
    !Array.isArray(ledger) &&
    ledger.market &&
    typeof ledger.market.symbol === "string" &&
    typeof ledger.market.baseAsset === "string" &&
    typeof ledger.market.quoteAsset === "string" &&
    ledger.strategy &&
    typeof ledger.strategy.baseQuantity === "string" &&
    typeof ledger.strategy.quoteCashFlow === "string" &&
    Array.isArray(ledger.strategy.commissionsByAsset) &&
    Array.isArray(ledger.processedTradeIds) &&
    ledger.unmanaged &&
    Array.isArray(ledger.unmanaged.byAsset) &&
    Array.isArray(ledger.unmanaged.movements) &&
    Number.isInteger(ledger.fillCount) &&
    ledger.fillCount >= 0,
  )
}

function freezeAssetTotals(totals) {
  return Object.freeze(
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([asset, amount]) => Object.freeze({ asset, amount })),
  )
}

export function createMarketInventoryLedger({ market } = {}) {
  if (!market || typeof market !== "object" || Array.isArray(market)) {
    return failure("Market inventory ledger requires a market object")
  }

  const symbol = typeof market.symbol === "string" ? market.symbol : ""
  const baseAsset = typeof market.baseAsset === "string" ? market.baseAsset : ""
  const quoteAsset = typeof market.quoteAsset === "string" ? market.quoteAsset : ""
  if (!symbol || !baseAsset || !quoteAsset || baseAsset === quoteAsset) {
    return failure("Market inventory ledger requires distinct symbol, base, and quote assets")
  }

  return {
    ok: true,
    ledger: Object.freeze({
      market: Object.freeze({ symbol, baseAsset, quoteAsset }),
      strategy: Object.freeze({
        baseQuantity: "0",
        quoteCashFlow: "0",
        commissionsByAsset: Object.freeze([]),
      }),
      unmanaged: Object.freeze({
        status: "unreconciled",
        byAsset: Object.freeze([]),
        movements: Object.freeze([]),
      }),
      processedTradeIds: Object.freeze([]),
      fillCount: 0,
    }),
  }
}

// Apply one already-identified market fill. The strategy projection and the
// unmanaged movement bucket remain separate; account activity is never
// silently counted as strategy inventory.
export function applyMarketInventoryFill({ ledger, fill, accounting: suppliedAccounting } = {}) {
  if (!isMarketInventoryLedger(ledger)) {
    return failure("Market inventory ledger is missing or invalid")
  }
  if (!fill || typeof fill !== "object" || Array.isArray(fill)) {
    return failure("Market inventory fill must be an object")
  }

  const fillId = String(fill.id ?? "")
  const orderId = String(fill.orderId ?? "")
  if (
    !fillId ||
    fillId === "-1" ||
    fillId === "undefined" ||
    !orderId ||
    orderId === "undefined"
  ) {
    return failure("Market inventory fill requires stable trade and order IDs")
  }
  if (fill.symbol !== ledger.market.symbol) {
    return failure(`Fill market ${String(fill.symbol ?? "")} does not match ${ledger.market.symbol}`)
  }
  if (ledger.processedTradeIds.includes(fillId)) {
    return failure(`Market inventory ledger already contains trade ${fillId}`)
  }

  if (fill.side !== "BUY" && fill.side !== "SELL") {
    return failure(`Unsupported market fill side for trade ${fillId}`)
  }

  let accounting = suppliedAccounting
  if (!accounting) {
    try {
      accounting = calculateFillAccountingExact({
        side: fill.side,
        quantity: String(fill.quantity ?? ""),
        quoteQuantity: String(fill.quoteQuantity ?? ""),
        commissionAmount: String(fill.commissionAmount ?? ""),
        commissionAsset: fill.commissionAsset ?? null,
        baseAsset: ledger.market.baseAsset,
        quoteAsset: ledger.market.quoteAsset,
      })
    } catch (error) {
      return failure(`Invalid market fill accounting for trade ${fillId}: ${error.message}`)
    }
  }

  try {
    if (
      !accounting ||
      typeof accounting.baseQuantity !== "string" ||
      typeof accounting.quoteQuantity !== "string" ||
      compareDecimal({ left: accounting.baseQuantity, right: "0" }) <= 0 ||
      compareDecimal({ left: accounting.quoteQuantity, right: "0" }) <= 0
    ) {
      return failure(`Market fill accounting is invalid for trade ${fillId}`)
    }
  } catch (error) {
    return failure(`Market fill accounting is invalid for trade ${fillId}: ${error.message}`)
  }

  const commissionAmount = String(fill.commissionAmount ?? "")
  const commissionAsset = fill.commissionAsset ?? null
  let commissionSign
  try {
    commissionSign = compareDecimal({ left: commissionAmount, right: "0" })
  } catch (error) {
    return failure(`Invalid commission amount for trade ${fillId}: ${error.message}`)
  }
  if (commissionSign < 0) {
    return failure(`Negative commission is unsupported for trade ${fillId}`)
  }
  if (
    commissionSign > 0 &&
    commissionAsset !== ledger.market.baseAsset &&
    commissionAsset !== ledger.market.quoteAsset
  ) {
    return failure(`Unsupported commission asset for trade ${fillId}`)
  }

  const baseQuantity = fill.side === "BUY"
    ? addDecimal({
        left: ledger.strategy.baseQuantity,
        right: accounting.baseQuantity,
      })
    : subtractDecimal({
        left: ledger.strategy.baseQuantity,
        right: accounting.baseQuantity,
      })
  if (compareDecimal({ left: baseQuantity, right: "0" }) < 0) {
    return failure(`Market fill ${fillId} would make strategy inventory negative`)
  }

  const quoteCashFlow = fill.side === "BUY"
    ? subtractDecimal({
        left: ledger.strategy.quoteCashFlow,
        right: accounting.quoteQuantity,
      })
    : addDecimal({
        left: ledger.strategy.quoteCashFlow,
        right: accounting.quoteQuantity,
      })

  const commissionTotals = new Map(
    ledger.strategy.commissionsByAsset.map(({ asset, amount }) => [asset, amount]),
  )
  if (compareDecimal({ left: commissionAmount, right: "0" }) > 0) {
    commissionTotals.set(
      commissionAsset,
      addDecimal({
        left: commissionTotals.get(commissionAsset) ?? "0",
        right: commissionAmount,
      }),
    )
  }

  const nextLedger = Object.freeze({
    ...ledger,
    strategy: Object.freeze({
      baseQuantity,
      quoteCashFlow,
      commissionsByAsset: freezeAssetTotals(commissionTotals),
    }),
    processedTradeIds: Object.freeze([...ledger.processedTradeIds, fillId]),
    fillCount: ledger.fillCount + 1,
  })

  return { ok: true, ledger: nextLedger, accounting }
}

// Record only explicitly attributed external activity. It never changes the
// strategy-owned base quantity or quote cash flow. Full account reconciliation
// remains a separate step because these movements may be incomplete.
export function appendUnmanagedMovement({ ledger, movement } = {}) {
  if (!isMarketInventoryLedger(ledger)) {
    return failure("Market inventory ledger is missing or invalid")
  }
  if (!movement || typeof movement !== "object" || Array.isArray(movement)) {
    return failure("Unmanaged movement must be an object")
  }

  const id = String(movement.id ?? "")
  const symbol = String(movement.symbol ?? "")
  const asset = String(movement.asset ?? "")
  const source = String(movement.source ?? "")
  const amount = String(movement.amount ?? "")
  if (!id || id === "-1" || id === "undefined" || !source) {
    return failure("Unmanaged movement requires stable source ID and source type")
  }
  if (symbol !== ledger.market.symbol) {
    return failure(`Unmanaged movement market ${symbol} does not match ${ledger.market.symbol}`)
  }
  if (asset !== ledger.market.baseAsset && asset !== ledger.market.quoteAsset) {
    return failure(`Unmanaged movement asset ${asset} is outside market ${ledger.market.symbol}`)
  }

  let amountSign
  try {
    amountSign = compareDecimal({ left: amount, right: "0" })
  } catch (error) {
    return failure(`Unmanaged movement has an invalid amount: ${error.message}`)
  }
  if (amountSign === 0) {
    return failure("Unmanaged movement amount must be non-zero")
  }

  const existing = ledger.unmanaged.movements.find((entry) => entry.id === id)
  if (existing) {
    const sameAmount = compareDecimal({
      left: existing.amount,
      right: amount,
    }) === 0
    if (
      existing.symbol !== symbol ||
      existing.asset !== asset ||
      existing.source !== source ||
      !sameAmount
    ) {
      return failure(`Conflicting unmanaged movement facts for source ID ${id}`)
    }
    return { ok: true, duplicate: true, ledger }
  }

  const byAsset = new Map(
    ledger.unmanaged.byAsset.map(({ asset: itemAsset, amount: itemAmount }) => [
      itemAsset,
      itemAmount,
    ]),
  )
  byAsset.set(
    asset,
    addDecimal({
      left: byAsset.get(asset) ?? "0",
      right: amount,
    }),
  )

  const nextMovement = Object.freeze({ id, symbol, asset, source, amount })
  const nextLedger = Object.freeze({
    ...ledger,
    unmanaged: Object.freeze({
      status: "unreconciled",
      byAsset: freezeAssetTotals(byAsset),
      movements: Object.freeze([...ledger.unmanaged.movements, nextMovement]),
    }),
  })

  return { ok: true, duplicate: false, ledger: nextLedger }
}
