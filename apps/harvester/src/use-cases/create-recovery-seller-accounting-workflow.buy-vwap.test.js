import assert from "node:assert/strict"
import test from "node:test"
import {
  CanonicalOrder,
  Asset,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { createOrderOwnership } from "../domain/orders/order-ownership.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createRecoverySellerAccountingWorkflow } from "./create-recovery-seller-accounting-workflow.js"

const baseAsset = new Asset({ id: "base", code: "BASE" })
const quoteAsset = new Asset({ id: "quote", code: "QUOTE" })
const market = new Market({
  venue: "test",
  symbol: "BASEQUOTE",
  baseAsset,
  quoteAsset,
})

function createBuyOrder({ suffix, cycleId }) {
  const clientOrderId = `rs-buy-${suffix}`
  const brokerOrderId = `broker-buy-${suffix}`
  const order = new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "2.2", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "10", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 2,
  })
  const ownership = createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      purpose: "RECOVERY_BUY",
      cycleId,
    },
    clientOrderId,
    brokerOrderId,
  })
  return { order, ownership }
}

function createBuyFill({ order, tradeId, quantity, quoteQuantity }) {
  return new Fill({
    tradeId,
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market,
    side: "BUY",
    price: new Money({ amount: "2.2", asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissionStatus: "COMPLETE",
  })
}

function createWorkflow() {
  const first = createBuyOrder({ suffix: "1", cycleId: "cycle-1" })
  const second = createBuyOrder({ suffix: "2", cycleId: "cycle-1" })
  const otherCycle = createBuyOrder({ suffix: "3", cycleId: "cycle-2" })
  const sharedState = {
    portfolio: new Portfolio(),
    orderRegistry: new OrderRegistry({
      orders: [first.order, second.order, otherCycle.order],
      ownerships: [first.ownership, second.ownership, otherCycle.ownership],
    }),
    legacyPositions: new Map(),
    updateQueue: Promise.resolve(),
  }
  return {
    workflow: createRecoverySellerAccountingWorkflow({ sharedState }),
    orders: [first.order, second.order, otherCycle.order],
  }
}

test("exposes exact per-cycle BUY execution VWAP and ignores duplicate fills", async () => {
  const { workflow, orders } = createWorkflow()
  const firstFill = createBuyFill({
    order: orders[0],
    tradeId: "trade-1",
    quantity: "2",
    quoteQuantity: "4.2",
  })
  const secondFill = createBuyFill({
    order: orders[1],
    tradeId: "trade-2",
    quantity: "3",
    quoteQuantity: "6.6",
  })
  const otherCycleFill = createBuyFill({
    order: orders[2],
    tradeId: "trade-3",
    quantity: "10",
    quoteQuantity: "25",
  })

  assert.equal(workflow.getBuyExecutionVwap({ cycleId: "cycle-1" }), undefined,
    "A cycle without accepted BUY fills must not invent a reference price.")
  assert.equal((await workflow.applyBuyFill({ fill: firstFill })).data.applied, true)
  assert.equal((await workflow.applyBuyFill({ fill: secondFill })).data.applied, true)
  assert.equal((await workflow.applyBuyFill({ fill: otherCycleFill })).data.applied, true)
  assert.equal(workflow.getBuyExecutionVwap({ cycleId: "cycle-1" }), "2.16",
    "The next BUY reference must use aggregate actual quote divided by aggregate executed base.")
  assert.equal(workflow.getBuyExecutionVwap({ cycleId: "cycle-2" }), "2.5",
    "BUY execution prices must remain isolated by RS cycle.")

  const duplicate = await workflow.applyBuyFill({ fill: firstFill })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(workflow.getBuyExecutionVwap({ cycleId: "cycle-1" }), "2.16",
    "Replayed canonical fills must not change the cycle VWAP.")
})
