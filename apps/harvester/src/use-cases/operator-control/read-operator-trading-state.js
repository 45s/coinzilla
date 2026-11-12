import { addDecimal, toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "../../application/operator/authorize-operator-actor.js"
import { OperatorQueryError } from "./errors/operator-query-error.js"

function freezeValue(value) {
  if (Array.isArray(value)) { return Object.freeze(value.map(freezeValue)) }
  if (value && typeof value === "object") {
    const copy = {}
    for (const [key, item] of Object.entries(value)) { copy[key] = freezeValue(item) }
    return Object.freeze(copy)
  }
  return value
}

function readFailure(operation, cause) {
  return new OperatorQueryError({
    message: "Harvester operator " + operation.toLowerCase() + " snapshot could not be read",
    code: "HARVESTER_OPERATOR_" + operation + "_READ_FAILED",
    cause,
    context: { operation: "READ_" + operation },
  })
}

/**
 * Create read-only trading visibility queries over application-owned snapshots.
 *
 * Providers are supplied by bootstrap; this use case never reaches into the
 * broker, mutable engine internals, or transport layer.
 *
 * @param {object} options
 * @param {Function} options.getPortfolio - Current canonical Portfolio provider.
 * @param {Function} options.getRecoveryLedger - Recovery ledger provider by market ID.
 * @param {Function} options.getAccountSnapshot - Latest canonical account snapshot provider.
 * @param {object} options.engine - Engine order read-model boundary.
 * @param {Function} options.getOpenOrders - Account-wide normalized exchange open-order provider.
 * @param {Function} options.getObservedAt - Clock returning epoch milliseconds.
 * @returns {Readonly<object>} Authorized trading visibility queries.
 */
export function createReadOperatorTradingState({
  getPortfolio, getRecoveryLedger, getAccountSnapshot, engine, getOpenOrders, getObservedAt = Date.now,
} = {}) {
  for (const [name, provider] of Object.entries({ getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders })) {
    if (typeof provider !== "function") { throw new TypeError("createReadOperatorTradingState requires " + name) }
  }
  if (typeof engine?.getActiveOrders !== "function") {
    throw new TypeError("createReadOperatorTradingState requires engine.getActiveOrders")
  }
  if (typeof getObservedAt !== "function") { throw new TypeError("getObservedAt must be a function") }

  const execute = ({ actor, operation, read }) => {
    try {
      authorizeOperatorActor({ actor })
      const observedAt = getObservedAt()
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
        throw new TypeError("Operator query clock must return a non-negative safe integer")
      }
      return Promise.resolve().then(read).then((data) => {
        if (!data || typeof data !== "object") { throw new TypeError(operation + " provider returned an invalid snapshot") }
        return toResult({ data: freezeValue({ observedAt, ...data }) })
      }).catch((cause) => toResult({ error: readFailure(operation, cause) }))
    } catch (error) {
      return Promise.resolve(toResult({ error }))
    }
  }

  const getPositions = ({ actor } = {}) => execute({
    actor, operation: "POSITIONS",
    read: () => {
      const portfolio = getPortfolio()
      if (!portfolio || !Array.isArray(portfolio.positions)) { throw new TypeError("Canonical Portfolio is unavailable") }
      return {
        positions: portfolio.positions.map((position) => {
          const value = position?.value
          if (!value?.market?.id || !value.market.symbol || !value.baseQuantity || !value.spent) {
            throw new TypeError("Portfolio contains an invalid Position read model")
          }
          const ledger = getRecoveryLedger({ marketId: value.market.id })
          return {
            symbol: value.market.symbol,
            baseAsset: value.market.baseAsset?.code,
            quoteAsset: value.market.quoteAsset?.code,
            activeQuantity: value.baseQuantity.amount,
            freeQuantity: value.freeBaseQuantity?.amount ?? "0",
            totalQuantity: value.totalBaseQuantity?.amount,
            investedQuote: value.spent.amount,
            quoteNetCashFlow: value.quoteNetCashFlow?.amount,
            recovery: ledger ? {
              buyCost: ledger.buyCost,
              netSellProceeds: ledger.netSellProceeds,
              outstandingRecoveryAmount: ledger.outstandingRecoveryAmount,
              realizedNetProfit: ledger.realizedNetProfit,
            } : null,
          }
        }),
      }
    },
  })

  const getOrders = ({ actor } = {}) => execute({
    actor, operation: "ORDERS",
    read: async () => {
      const owned = engine.getActiveOrders()
      if (!Array.isArray(owned)) { throw new TypeError("Engine order snapshot is invalid") }
      const externalResult = await getOpenOrders()
      if (externalResult?.ok !== true || !Array.isArray(externalResult.data)) {
        throw externalResult?.errors?.[0] ?? new TypeError("Account open-order snapshot is unavailable")
      }
      const ownedIds = new Set(owned.map((order) => String(order.brokerOrderId ?? "")).filter(Boolean))
      const ownedClientIds = new Set(owned.map((order) => order.clientOrderId).filter((id) => typeof id === "string" && id.length > 0))
      const ownedOrders = owned.map((order) => ({
        ownership: "HARVESTER",
        symbol: order.market?.symbol ?? order.symbol,
        side: order.side,
        status: order.status,
        brokerOrderId: order.brokerOrderId ?? order.id,
        clientOrderId: order.clientOrderId,
        price: order.limitPrice?.amount ?? order.originalPrice ?? null,
        quantity: order.originalQuantity?.amount ?? order.originalQuantity ?? null,
        executedQuantity: order.executedQuantity?.amount ?? order.executedQuantity ?? null,
      }))
      const externalOrders = externalResult.data
        .filter((order) => !ownedIds.has(String(order.id)) && !ownedClientIds.has(order.clientOrderId))
        .map((order) => ({
          ownership: "EXTERNAL",
          symbol: order.symbol,
          side: order.side,
          status: order.status,
          brokerOrderId: order.id,
          clientOrderId: order.clientOrderId ?? null,
          price: order.originalPrice ?? order.price ?? null,
          quantity: order.originalQuantity ?? order.quantity ?? null,
          executedQuantity: order.executedQuantity ?? null,
        }))
      return { orders: [...ownedOrders, ...externalOrders] }
    },
  })

  const getBalances = ({ actor } = {}) => execute({
    actor, operation: "BALANCES",
    read: () => {
      const snapshot = getAccountSnapshot()
      if (!snapshot || !Number.isSafeInteger(snapshot.sourceTime) || !Array.isArray(snapshot.balances)) {
        throw new TypeError("Canonical account balance snapshot is unavailable or invalid")
      }
      const observedAt = getObservedAt()
      if (!Number.isSafeInteger(observedAt) || observedAt < snapshot.sourceTime) {
        throw new TypeError("Account snapshot source timestamp is invalid or ahead of the operator clock")
      }
      return {
        sourceTime: snapshot.sourceTime,
        ageMs: observedAt - snapshot.sourceTime,
        balances: snapshot.balances.map((balance) => ({
          asset: balance.asset?.code,
          free: balance.free?.amount ?? balance.free,
          locked: balance.locked?.amount ?? balance.locked,
          total: addDecimal({ left: balance.free.amount, right: balance.locked.amount }),
        })),
      }
    },
  })

  return Object.freeze({ getPositions, getOrders, getBalances })
}
