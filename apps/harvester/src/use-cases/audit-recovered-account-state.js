import { Market } from "@coinzilla/entities"
import { AccountSnapshot } from "../domain/account/account-snapshot.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { addDecimal, assertDecimalString, compareDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"

function addAmount({ amounts, asset, amount }) {
  const current = amounts.get(asset) ?? "0"
  amounts.set(asset, addDecimal({ left: current, right: amount }))
}

function requireAmount({ value, field }) {
  if (typeof value !== "string") throw new TypeError(field + " must be an exact decimal string")
  assertDecimalString({ value, field })
  return value
}

function getOrderPrice({ order }) {
  const value = order.originalPrice ?? order.limitPrice?.amount ?? order.price?.amount ?? order.price
  return typeof value === "number" ? String(value) : value
}

function getOpenOrderIdentity({ order }) {
  return {
    brokerOrderId: order.brokerOrderId ?? order.id,
    symbol: order.market?.symbol ?? order.symbol,
    clientOrderId: order.clientOrderId,
    originalQuantity: order.originalQuantity?.amount ?? order.originalQuantity,
    executedQuantity: order.executedQuantity?.amount ?? order.executedQuantity,
  }
}

function normalizeOrderStatus({ status }) {
  return status === "NEW" ? "OPEN" : status
}

function getInitialTradingSnapshot({ projection }) {
  const firstTradingSession = projection.data.sessions.find((session) =>
    session.tradingEnabled || session.hasTradingActivity
  )
  if (!firstTradingSession) return undefined
  return projection.data.accountSnapshots.find((snapshot) =>
    snapshot.fileName === firstTradingSession.fileName && snapshot.phase === "PREFLIGHT"
  )
}

/**
 * Compare replayed strategy-owned inventory and commitments with a fresh,
 * read-only exchange account snapshot and the complete account open-order set.
 * Any unexplained asset movement, unowned order, or reservation mismatch fails
 * closed. This function performs no broker calls and no exchange mutations.
 */
export function auditRecoveredAccountState({
  projection,
  recoveredState,
  currentAccountSnapshot,
  openOrders,
  markets,
} = {}) {
  try {
    if (projection?.ok !== true || !projection.data) {
      throw new TypeError("auditRecoveredAccountState requires a successful Journal recovery projection")
    }
    if (!(recoveredState?.portfolio instanceof Portfolio)) {
      throw new TypeError("auditRecoveredAccountState requires a restored Portfolio")
    }
    if (!(recoveredState.orderRegistry instanceof OrderRegistry)) {
      throw new TypeError("auditRecoveredAccountState requires a restored OrderRegistry")
    }
    if (!(currentAccountSnapshot instanceof AccountSnapshot)) {
      throw new TypeError("auditRecoveredAccountState requires a canonical current AccountSnapshot")
    }
    if (!Array.isArray(openOrders)) throw new TypeError("openOrders must be an array")
    if (!Array.isArray(markets)) throw new TypeError("markets must be an array")

    if (!projection.data.requiresExchangeReconciliation) {
      return toResult({ data: Object.freeze({ skipped: true, reason: "NO_PRIOR_TRADING_STATE" }) })
    }

    const baseline = getInitialTradingSnapshot({ projection })
    if (!baseline) {
      throw new Error("Initial trading-session PREFLIGHT account snapshot is missing; account ownership cannot be proven")
    }
    const latestRecordedSourceTime = projection.data.accountSnapshots.reduce(
      (latest, snapshot) => Math.max(latest, snapshot.sourceTime),
      baseline.sourceTime,
    )
    if (currentAccountSnapshot.sourceTime < latestRecordedSourceTime) {
      throw new Error("Current exchange account snapshot is older than the latest durable Journal account snapshot")
    }

    const baselineByAsset = new Map(baseline.balances.map((balance) => [balance.asset, balance.total]))
    const currentByAsset = new Map()
    for (const balance of currentAccountSnapshot.balances) {
      const code = balance.asset.code
      if (currentByAsset.has(code)) throw new Error("Current account snapshot contains duplicate asset code " + code)
      currentByAsset.set(code, {
        total: addDecimal({ left: balance.free.amount, right: balance.locked.amount }),
        locked: balance.locked.amount,
      })
    }

    const expectedDeltas = new Map()
    const marketsById = new Map()
    for (const position of recoveredState.portfolio.value.positions) {
      if (!markets.some((market) => market.id === position.market.id)) {
        throw new Error("Canonical Market metadata is missing for restored Position " + position.market.symbol)
      }
    }
    for (const order of recoveredState.orderRegistry.orders) {
      if (!markets.some((market) => market.id === order.market.id)) {
        throw new Error("Canonical Market metadata is missing for restored order " + order.clientOrderId)
      }
    }
    for (const market of markets) {
      if (!(market instanceof Market)) {
        throw new TypeError("markets must contain canonical Market values")
      }
      if (marketsById.has(market.id)) throw new Error("Duplicate canonical Market metadata for " + market.id)
      marketsById.set(market.id, market)
      const position = recoveredState.portfolio.getPosition({ marketId: market.id })
      if (!position) continue
      addAmount({
        amounts: expectedDeltas,
        asset: market.baseAsset.code,
        amount: requireAmount({ value: position.totalBaseQuantity.amount, field: market.symbol + ".totalBaseQuantity" }),
      })
      addAmount({
        amounts: expectedDeltas,
        asset: market.quoteAsset.code,
        amount: requireAmount({ value: position.quoteNetCashFlow.amount, field: market.symbol + ".quoteNetCashFlow" }),
      })
    }

    const assetCodes = new Set([
      ...baselineByAsset.keys(),
      ...currentByAsset.keys(),
      ...expectedDeltas.keys(),
    ])
    for (const asset of assetCodes) {
      const initial = baselineByAsset.get(asset) ?? "0"
      const delta = expectedDeltas.get(asset) ?? "0"
      const expected = addDecimal({ left: initial, right: delta })
      if (compareDecimal({ left: expected, right: "0" }) < 0) {
        throw new Error("Replayed strategy accounting predicts a negative account balance for " + asset)
      }
      const actual = currentByAsset.get(asset)?.total ?? "0"
      if (compareDecimal({ left: actual, right: expected }) !== 0) {
        throw new Error(
          "Exchange balance does not match replayed Harvester ownership for " + asset +
          ": expected " + expected + ", received " + actual,
        )
      }
    }

    const expectedOpenOrders = recoveredState.orderRegistry.getActiveOrders({})
    const expectedByBrokerId = new Map()
    const expectedLocked = new Map()
    for (const order of expectedOpenOrders) {
      if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status)) {
        throw new Error("Recovered active order remains unresolved and cannot pass account audit: " + order.clientOrderId)
      }
      if (typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
        throw new Error("Recovered active order has no brokerOrderId: " + order.clientOrderId)
      }
      if (expectedByBrokerId.has(order.brokerOrderId)) {
        throw new Error("Recovered OrderRegistry contains duplicate brokerOrderId " + order.brokerOrderId)
      }
      expectedByBrokerId.set(order.brokerOrderId, order)
      const remainingQuantity = subtractDecimal({
        left: order.originalQuantity.amount,
        right: order.executedQuantity.amount,
      })
      if (compareDecimal({ left: remainingQuantity, right: "0" }) <= 0) {
        throw new Error("Recovered active order has no remaining quantity: " + order.clientOrderId)
      }
      if (order.type !== "LIMIT" || !order.limitPrice) {
        throw new Error("Recovered active order is not a supported LIMIT commitment: " + order.clientOrderId)
      }
      if (order.side === "BUY") {
        addAmount({
          amounts: expectedLocked,
          asset: order.market.quoteAsset.code,
          amount: multiplyDecimal({
            left: remainingQuantity,
            right: order.limitPrice.amount,
          }),
        })
      } else if (order.side === "SELL") {
        addAmount({
          amounts: expectedLocked,
          asset: order.market.baseAsset.code,
          amount: remainingQuantity,
        })
      } else {
        throw new Error("Recovered active order has an unsupported side: " + order.clientOrderId)
      }
    }

    const actualOpenByBrokerId = new Map()
    for (const order of openOrders) {
      const identity = getOpenOrderIdentity({ order })
      const { brokerOrderId, symbol } = identity
      if (typeof brokerOrderId !== "string" || !brokerOrderId.trim() ||
          typeof symbol !== "string" || !symbol.trim()) {
        throw new Error("Exchange open-order snapshot contains an order without canonical identity")
      }
      if (actualOpenByBrokerId.has(brokerOrderId)) {
        throw new Error("Exchange open-order snapshot contains duplicate brokerOrderId " + brokerOrderId)
      }
      const expected = expectedByBrokerId.get(brokerOrderId)
      if (!expected) {
        throw new Error("Exchange contains an open order not owned by the recovered Harvester registry: " + brokerOrderId)
      }
      const actualPrice = getOrderPrice({ order })
      const expectedPrice = expected.limitPrice?.amount
      const actualStatus = order.status === "NEW" ? "OPEN" : order.status
      const expectedStatus = normalizeOrderStatus({ status: expected.status })
      if (
        expected.clientOrderId !== identity.clientOrderId ||
        expected.market.symbol !== symbol ||
        expected.side !== order.side ||
        expected.type !== order.type ||
        expectedStatus !== actualStatus ||
        compareDecimal({ left: expected.originalQuantity.amount, right: identity.originalQuantity }) !== 0 ||
        compareDecimal({ left: expected.executedQuantity.amount, right: identity.executedQuantity }) !== 0 ||
        compareDecimal({ left: expectedPrice, right: actualPrice }) !== 0
      ) {
        throw new Error("Exchange open-order facts contradict recovered ownership for broker order " + brokerOrderId)
      }
      actualOpenByBrokerId.set(brokerOrderId, order)
    }
    if (actualOpenByBrokerId.size !== expectedByBrokerId.size) {
      const missing = [...expectedByBrokerId.keys()].filter((id) => !actualOpenByBrokerId.has(id))
      throw new Error("Recovered active orders are missing from the exchange open-order snapshot: " + missing.join(", "))
    }

    for (const [asset, expected] of expectedLocked) {
      const actual = currentByAsset.get(asset)?.locked ?? "0"
      if (compareDecimal({ left: actual, right: expected }) !== 0) {
        throw new Error(
          "Exchange locked balance does not match recovered order commitments for " + asset +
          ": expected " + expected + ", received " + actual,
        )
      }
    }
    for (const [asset, actual] of currentByAsset) {
      const expected = expectedLocked.get(asset) ?? "0"
      if (compareDecimal({ left: actual.locked, right: expected }) !== 0) {
        throw new Error(
          "Exchange has unexplained locked funds for " + asset +
          ": expected " + expected + ", received " + actual.locked,
        )
      }
    }

    return toResult({
      data: Object.freeze({
        skipped: false,
        balancesChecked: assetCodes.size,
        openOrdersChecked: openOrders.length,
        reservationsChecked: expectedLocked.size,
        sourceTime: currentAccountSnapshot.sourceTime,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
