import { CanonicalOrder } from "@coinzilla/entities"
import { addDecimal, multiplyDecimal, toResult } from "@coinzilla/utils"
import { Portfolio } from "../portfolio/portfolio.js"

function addAmount({ values, assetId, amount, field }) {
  if (typeof assetId !== "string" || !assetId.trim()) {
    throw new TypeError(field + " requires a non-empty asset ID")
  }
  values.set(assetId, addDecimal({ left: values.get(assetId) ?? "0", right: amount }))
}

function toRecords(values) {
  return Object.freeze([...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, amount]) => Object.freeze({ assetId, amount })))
}

/**
 * Capture the Portfolio and active-order accounting state represented by an
 * exchange account snapshot. The caller captures this synchronously after the
 * broker balance response; recovery event-sequence fencing discards the whole
 * attempt if a user-data event crosses the REST snapshot boundary.
 */
export function calculateAccountSnapshotBaselines({ portfolio, activeOrders } = {}) {
  try {
    if (!(portfolio instanceof Portfolio)) {
      throw new TypeError("calculateAccountSnapshotBaselines requires a Portfolio")
    }
    if (!Array.isArray(activeOrders) || activeOrders.some((order) => !(order instanceof CanonicalOrder))) {
      throw new TypeError("calculateAccountSnapshotBaselines activeOrders must contain CanonicalOrder values")
    }

    const quoteCashFlow = new Map()
    const portfolioBaseQuantity = new Map()
    const committedQuoteBalance = new Map()
    const committedBaseBalance = new Map()

    for (const position of portfolio.positions) {
      addAmount({
        values: quoteCashFlow,
        assetId: position.market.quoteAsset.id,
        amount: position.quoteNetCashFlow.amount,
        field: "Portfolio quote cash flow",
      })
      addAmount({
        values: portfolioBaseQuantity,
        assetId: position.market.baseAsset.id,
        amount: position.totalBaseQuantity.amount,
        field: "total Portfolio base quantity",
      })
    }

    for (const order of activeOrders) {
      if (!["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status)) {
        throw new TypeError("calculateAccountSnapshotBaselines activeOrders must contain only active orders")
      }
      if (order.side === "BUY") {
        if (!order.limitPrice) {
          throw new Error("Cannot capture an active BUY commitment without a canonical limit price: " + order.clientOrderId)
        }
        addAmount({
          values: committedQuoteBalance,
          assetId: order.market.quoteAsset.id,
          amount: multiplyDecimal({
            left: order.remainingQuantity.amount,
            right: order.limitPrice.amount,
          }),
          field: "Active BUY quote commitment",
        })
        continue
      }
      addAmount({
        values: committedBaseBalance,
        assetId: order.market.baseAsset.id,
        amount: order.remainingQuantity.amount,
        field: "Active SELL base commitment",
      })
    }

    return toResult({
      data: Object.freeze({
        quoteCashFlowBaseline: toRecords(quoteCashFlow),
        portfolioBaseQuantityBaseline: toRecords(portfolioBaseQuantity),
        committedQuoteBalanceBaseline: toRecords(committedQuoteBalance),
        committedBaseBalanceBaseline: toRecords(committedBaseBalance),
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
