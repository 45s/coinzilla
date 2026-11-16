import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { createOrderOwnership } from "../domain/orders/order-ownership.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../domain/strategies/recovery-seller/legacy-position.js"
import { createMixedSellFillAllocation } from "../domain/strategies/recovery-seller/mixed-sell-fill-allocation.js"
import {
  createMixedSellFillReconciliation,
  stageMixedSellFillAllocation,
} from "../domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js"
import { createRecoverySellerAccountingWorkflow } from "./create-recovery-seller-accounting-workflow.js"

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

function makeFill({ tradeId = "sell-1", quantity = "5.01", quoteQuantity = "10.5" } = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "broker-sell-1",
    clientOrderId: "rs-sell-1",
    market,
    side: "SELL",
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

function makeRegistry(order) {
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
  return new OrderRegistry({ orders: [order], ownerships: [ownership] })
}

function makeContext() {
  const buyFill = new Fill({
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
  const { portfolio } = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  })
  const openOrder = makeOrder()
  const terminalOrder = makeOrder({ status: "FILLED", executedQuantity: "5.01" })
  const openRegistry = makeRegistry(openOrder)
  const terminalRegistry = makeRegistry(terminalOrder)
  const fill = makeFill()
  const allocation = createMixedSellFillAllocation({
    fill,
    orderRegistry: terminalRegistry,
    recoveryQuantity: "5",
    legacyQuantity: "0.01",
  })
  const reconciliation = stageMixedSellFillAllocation({
    reconciliation: createMixedSellFillReconciliation({
      order: openOrder,
      orderRegistry: openRegistry,
    }),
    allocation,
  }).reconciliation
  return {
    portfolio,
    openRegistry,
    terminalOrder,
    reconciliation,
    fill,
    allocation,
    legacyPosition: createLegacyPosition({ invested: "100", quantity: "50" }),
    legacyAccounting: createLegacyPositionAccounting(),
  }
}

function makeWorkflow(context) {
  return createRecoverySellerAccountingWorkflow({
    initialPortfolio: context.portfolio,
    initialOrderRegistry: context.openRegistry,
    initialLegacyPositions: [{
      market,
      position: context.legacyPosition,
      accounting: context.legacyAccounting,
    }],
  })
}

test("commits reconciled RS projections and releases the shared SELL reservation atomically", async () => {
  const context = makeContext()
  const workflow = makeWorkflow(context)

  assert.equal(workflow.getOrderRegistry().getActiveOrders().length, 1,
    "An open RS SELL must remain in the shared reservation registry before terminal reconciliation.")

  const result = await workflow.reconcileTerminalMixedSell({
    reconciliation: context.reconciliation,
    terminalOrder: context.terminalOrder,
    canonicalFills: [context.fill],
    canonicalFillAllocations: [context.allocation],
    minProfit: "0.2",
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.applied, true,
    "A fully reconciled mixed SELL must apply both immutable accounting projections.")
  assert.equal(result.data.profitability.recovery.eligible, true,
    "The recovery gate must use allocated net recovery proceeds and the pre-commit recovery cost basis.")
  assert.equal(result.data.profitability.legacy.eligible, true,
    "The legacy gate must independently use the fixed average cost and allocated legacy debit/proceeds.")
  assert.equal(workflow.getPortfolio().getPosition({ positionId }).baseQuantity.amount, "0.01",
    "Only the recovery-allocated SELL quantity may debit the recovery Position.")
  assert.equal(workflow.getLegacyPosition({ marketId: market.id }).remainingQuantity, "49.99",
    "Only the legacy-allocated SELL quantity may debit authorized legacy inventory.")
  assert.equal(workflow.getOrderRegistry().getActiveOrders().length, 0,
    "The central SELL reservation must be released only after both projections commit.")
})

test("keeps the SELL reservation and both projections unchanged when terminal fill history is incomplete", async () => {
  const context = makeContext()
  const workflow = makeWorkflow(context)
  const portfolioBefore = workflow.getPortfolio()
  const legacyBefore = workflow.getLegacyPosition({ marketId: market.id })
  const registryBefore = workflow.getOrderRegistry()

  const result = await workflow.reconcileTerminalMixedSell({
    reconciliation: context.reconciliation,
    terminalOrder: context.terminalOrder,
    canonicalFills: [],
    canonicalFillAllocations: [],
    minProfit: "0.2",
  })

  assert.equal(result.ok, false, "An executed terminal order without its complete canonical Fill history must fail closed.")
  assert.equal(workflow.getPortfolio(), portfolioBefore,
    "Failed terminal reconciliation must not mutate the shared Portfolio.")
  assert.equal(workflow.getLegacyPosition({ marketId: market.id }), legacyBefore,
    "Failed terminal reconciliation must not mutate the legacy projection.")
  assert.equal(workflow.getOrderRegistry(), registryBefore,
    "A failed projection commit must keep the order active so its base reservation is not released.")
  assert.equal(workflow.getOrderRegistry().getActiveOrders().length, 1,
    "The unresolved SELL must continue reserving its unfilled quantity.")
})

test("exposes separately tracked legacy quote proceeds to the shared account snapshot baseline", async () => {
  const context = makeContext()
  const workflow = makeWorkflow(context)
  const result = await workflow.reconcileTerminalMixedSell({
    reconciliation: context.reconciliation,
    terminalOrder: context.terminalOrder,
    canonicalFills: [context.fill],
    canonicalFillAllocations: [context.allocation],
    minProfit: "0.2",
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(workflow.getAdditionalTrackedQuoteCashFlow(), [{
    assetId: quoteAsset.id,
    amount: result.data.legacyAccounting.realizedQuoteProceeds,
  }], "The snapshot baseline must include net legacy proceeds without seeding them into Portfolio.")
})
