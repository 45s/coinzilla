import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { addDecimal } from "@coinzilla/utils"
import { OrderRegistry } from "../../../src/domain/orders/order-registry.js"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { createMixedSellFillAllocation } from "../../../src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js"

const clientOrderId = "rs-doge-mixed-sell-001"
const brokerOrderId = "binance-order-001"
const positionId = "rs-doge-position-001"
const cycleId = "rs-doge-cycle-001"

function createMarket() {
  const baseAsset = new Asset({
    id: "doge-asset",
    code: "DOGE",
  })
  const quoteAsset = new Asset({
    id: "usdt-asset",
    code: "USDT",
  })
  const market = new Market({
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAsset,
    quoteAsset,
  })
  return {
    baseAsset,
    quoteAsset,
    market,
  }
}

function createRegisteredSellOrder({ market, baseAsset, quoteAsset }) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "401",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "401",
      asset: baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 3,
  })
}

function createOrderRegistry({ order }) {
  return new OrderRegistry({
    orders: [order],
    ownerships: [{
      clientOrderId,
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId,
      purpose: "RECOVERY_SELL",
      cycleId,
    }],
  })
}

function createCanonicalSellFill({ market, baseAsset, quoteAsset }) {
  return new Fill({
    tradeId: "trade-001",
    brokerOrderId,
    clientOrderId,
    market,
    side: "SELL",
    price: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "401",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "4010",
      asset: quoteAsset,
    }),
    liquidityRole: "MAKER",
    executedAt: 4,
    commissions: [
      new Commission({
        amount: new Money({
          amount: "4.01",
          asset: quoteAsset,
        }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function createMixedSellAllocationFixture() {
  const marketData = createMarket()
  const order = createRegisteredSellOrder(marketData)
  const orderRegistry = createOrderRegistry({ order })
  const fill = createCanonicalSellFill(marketData)
  const allocation = createMixedSellFillAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: "400",
    legacyQuantity: "1",
  })
  return {
    fill,
    allocation,
  }
}

test("RS-003-008: one canonical SELL Fill is split exactly between recovery and legacy with quantity conservation", () => {
  const { fill, allocation } = createMixedSellAllocationFixture()

  assert.equal(allocation.fillId, fill.id,
    "Both ownership allocations must remain tied to the original canonical Fill identity.")
  assert.equal(allocation.orderOwnership.cycleId, cycleId,
    "The recovery allocation must retain its registered cycle identity.")
  assert.equal(allocation.orderOwnership.positionId, positionId,
    "The recovery allocation must retain its registered Position identity.")
  assert.deepEqual(allocation.recovery, {
    grossBaseQuantity: "400",
    baseDebit: "400",
    quoteProceeds: "4000",
    commissions: [{
      assetId: "usdt-asset",
      assetCode: "USDT",
      amount: "4",
    }],
  })
  assert.deepEqual(allocation.legacy, {
    grossBaseQuantity: "1",
    baseDebit: "1",
    quoteProceeds: "10",
    commissions: [{
      assetId: "usdt-asset",
      assetCode: "USDT",
      amount: "0.01",
    }],
  })
  assert.equal(addDecimal({
    left: allocation.recovery.grossBaseQuantity,
    right: allocation.legacy.grossBaseQuantity,
  }), fill.quantity.amount,
  "Recovery and legacy gross base allocations must sum exactly to the canonical SELL Fill.")
  assert.equal(addDecimal({
    left: allocation.recovery.quoteProceeds,
    right: allocation.legacy.quoteProceeds,
  }), fill.quoteQuantity.amount,
  "Recovery and legacy quote proceeds must sum exactly to the canonical Fill proceeds.")
  assert.equal(addDecimal({
    left: allocation.recovery.commissions[0].amount,
    right: allocation.legacy.commissions[0].amount,
  }), "4.01",
  "Recovery and legacy commission allocations must conserve the actual canonical quote commission.")
})
