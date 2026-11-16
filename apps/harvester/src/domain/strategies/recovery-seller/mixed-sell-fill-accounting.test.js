import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { StrategyId } from "../strategy-ids.js"
import { Portfolio } from "../../portfolio/portfolio.js"
import { createOrderOwnership } from "../../orders/order-ownership.js"
import { OrderRegistry } from "../../orders/order-registry.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "./legacy-position.js"
import { createMixedSellFillAllocation } from "./mixed-sell-fill-allocation.js"
import {
  createMixedSellFillReconciliation,
  reconcileMixedSellFillOrder,
  stageMixedSellFillAllocation,
} from "./mixed-sell-fill-reconciliation.js"
import { applyReconciledMixedSellOrder } from "./mixed-sell-fill-accounting.js"

const baseAsset = new Asset({ id: "binance:ZRO", code: "ZRO" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})
const positionId = "rs-position-1"
const strategyId = StrategyId.RECOVERY_SELLER

function makeFill({
  tradeId = "sell-1",
  side = "SELL",
  quantity = "5.01",
  quoteQuantity = "10.02",
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "broker-sell-1",
    clientOrderId: "rs-sell-1",
    market,
    side,
    price: new Money({ amount: "2", asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeOrder({ status = "OPEN", executedQuantity = "0" } = {}) {
  return new CanonicalOrder({
    clientOrderId: "rs-sell-1",
    brokerOrderId: "broker-sell-1",
    market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "2", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "5.01", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    ...(status === "OPEN" ? {} : { completedAt: 103 }),
  })
}

function makeOrderRegistry(order) {
  const ownership = createOrderOwnership({
    ownership: {
      strategyId,
      positionId,
      purpose: "RECOVERY_SELL",
      cycleId: "rs-cycle-1",
    },
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
  })
  return new OrderRegistry({
    orders: [order],
    ownerships: [ownership],
  })
}

function makeBuyFill() {
  return new Fill({
    tradeId: "buy-1",
    brokerOrderId: "broker-buy-1",
    clientOrderId: "rs-buy-1",
    market,
    side: "BUY",
    price: new Money({ amount: "2", asset: quoteAsset }),
    quantity: new Quantity({ amount: "5.01", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10.02", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeAccountingContext({ legacyQuantity = "50" } = {}) {
  const buyFill = makeBuyFill()
  const portfolio = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  }).portfolio
  const legacyPosition = createLegacyPosition({
    invested: "100",
    quantity: legacyQuantity,
  })
  const legacyAccounting = createLegacyPositionAccounting()
  const fill = makeFill()
  const openOrder = makeOrder()
  const openRegistry = makeOrderRegistry(openOrder)
  const terminalOrder = makeOrder({
    status: "FILLED",
    executedQuantity: "5.01",
  })
  const terminalRegistry = makeOrderRegistry(terminalOrder)
  const allocation = createMixedSellFillAllocation({
    fill,
    orderRegistry: terminalRegistry,
    recoveryQuantity: "5",
    legacyQuantity: "0.01",
  })
  const staged = stageMixedSellFillAllocation({
    reconciliation: createMixedSellFillReconciliation({
      order: openOrder,
      orderRegistry: openRegistry,
    }),
    allocation,
  }).reconciliation
  const reconciled = reconcileMixedSellFillOrder({
    reconciliation: staged,
    terminalOrder,
    orderRegistry: terminalRegistry,
    canonicalFillAllocations: [allocation],
  }).reconciliation
  return {
    portfolio,
    legacyPosition,
    legacyAccounting,
    reconciliation: reconciled,
    terminalOrder,
    orderRegistry: terminalRegistry,
    canonicalFills: [fill],
    canonicalFillAllocations: [allocation],
  }
}

test("commits a fully reconciled mixed SELL to recovery and legacy projections together", () => {
  const context = makeAccountingContext()
  const result = applyReconciledMixedSellOrder(context)

  assert.equal(result.applied, true, "A new terminal reconciliation must commit both RS accounting projections.")
  assert.equal(result.reconciliation.status, "RECONCILED", "The committed result must retain terminal reconciliation.")
  assert.equal(result.portfolio.appliedFillIds.includes(context.canonicalFills[0].id), true, "The recovery Portfolio must record the canonical SELL Fill exactly once.")
  assert.equal(result.legacyAccounting.appliedFillIds.includes(context.canonicalFills[0].id), true, "The legacy projection must record the same canonical SELL Fill exactly once.")
  assert.equal(
    result.portfolio.appliedFillFingerprints.find((item) => item.id === context.canonicalFills[0].id).allocationFingerprint,
    context.canonicalFillAllocations[0].allocationFingerprint,
    "The recovery projection must retain the immutable full allocation fingerprint.",
  )
  assert.ok(
    Number(result.legacyPosition.remainingQuantity) < Number(context.legacyPosition.remainingQuantity),
    "The legacy remaining quantity must decrease by its allocated base debit only after terminal reconciliation.",
  )
  assert.equal(result.legacyPosition.averageCost, context.legacyPosition.averageCost, "Legacy average cost must remain fixed after disposal.")
  assert.equal(result.legacyPosition.invested, context.legacyPosition.invested, "Original legacy investment must remain unchanged.")
})

test("treats a repeated complete mixed SELL accounting commit as an exact no-op", () => {
  const context = makeAccountingContext()
  const first = applyReconciledMixedSellOrder(context)
  const replay = applyReconciledMixedSellOrder({
    ...context,
    portfolio: first.portfolio,
    legacyPosition: first.legacyPosition,
    legacyAccounting: first.legacyAccounting,
    reconciliation: first.reconciliation,
  })

  assert.equal(replay.applied, false, "An identical terminal replay must not apply either projection twice.")
  assert.equal(replay.duplicate, true, "An identical terminal replay must be explicitly classified.")
  assert.equal(replay.portfolio, first.portfolio, "A duplicate must preserve the exact Portfolio snapshot.")
  assert.equal(replay.legacyPosition, first.legacyPosition, "A duplicate must preserve the exact legacy Position snapshot.")
  assert.equal(replay.legacyAccounting, first.legacyAccounting, "A duplicate must preserve the exact legacy P&L snapshot.")
})

test("rejects a partial projection replay instead of silently repairing split accounting history", () => {
  const context = makeAccountingContext()
  const first = applyReconciledMixedSellOrder(context)
  assert.throws(
    () => applyReconciledMixedSellOrder({
      ...context,
      portfolio: first.portfolio,
    }),
    /projection histories|already applied|exact-once/i,
    "A Fill present in only one projection must fail closed; the orchestrator must not guess which side is authoritative.",
  )
})

test("does not expose partially updated projections when the legacy debit cannot be applied", () => {
  const context = makeAccountingContext({ legacyQuantity: "0.005" })
  const portfolioBefore = context.portfolio
  const legacyPositionBefore = context.legacyPosition
  const legacyAccountingBefore = context.legacyAccounting

  assert.throws(
    () => applyReconciledMixedSellOrder(context),
    /legacy|remaining quantity|base quantity/i,
    "A legacy accounting failure must reject the complete transition.",
  )
  assert.equal(context.portfolio, portfolioBefore, "A failed transition must leave the caller's Portfolio snapshot unchanged.")
  assert.equal(context.legacyPosition, legacyPositionBefore, "A failed transition must leave the caller's legacy Position unchanged.")
  assert.equal(context.legacyAccounting, legacyAccountingBefore, "A failed transition must leave the caller's legacy P&L snapshot unchanged.")
})
