import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { recordRecoverySellerMixedSellReconciled } from "./record-recovery-seller-mixed-sell-reconciled.js"

const baseAsset = new Asset({
  id: "binance:ZRO",
  code: "ZRO",
})
const quoteAsset = new Asset({
  id: "binance:USDT",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})

function makeOrder({ status = "FILLED" } = {}) {
  return new CanonicalOrder({
    clientOrderId: "rs-sell-1",
    brokerOrderId: "broker-sell-1",
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "5",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "5",
      asset: baseAsset,
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 4,
  })
}

function makeFill({ clientOrderId = "rs-sell-1", brokerOrderId = "broker-sell-1", tradeId = "trade-1" } = {}) {
  return new Fill({
    tradeId,
    brokerOrderId,
    clientOrderId,
    market,
    side: "SELL",
    price: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "5",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

const ownership = {
  strategyId: StrategyId.RECOVERY_SELLER,
  purpose: "RECOVERY_SELL",
  cycleId: "rs-cycle-1",
  positionId: "rs-position-1",
}

test("persists a durable reconciliation boundary for the exact terminal RS SELL and fill set", async () => {
  let appended
  const result = await recordRecoverySellerMixedSellReconciled({
    operationalStateStore: {
      append: async (fact) => {
        appended = fact
        return { ok: true, data: { durable: true } }
      },
    },
    terminalOrder: makeOrder(),
    ownership,
    canonicalFills: [makeFill()],
    accountingApplied: true,
    eligible: false,
  })

  assert.equal(result.ok, true)
  assert.equal(appended.factType, "RECOVERY_SELLER_MIXED_SELL_RECONCILED")
  assert.equal(appended.data.terminalStatus, "FILLED")
  assert.deepEqual(appended.data.appliedFillIds, [makeFill().id])
  assert.equal(appended.data.accountingApplied, true)
  assert.equal(appended.data.eligible, false)
})

test("does not persist a terminal boundary for incomplete or foreign accounting evidence", async () => {
  let appendCount = 0
  const operationalStateStore = {
    append: async () => {
      appendCount += 1
      return { ok: true, data: { durable: true } }
    },
  }
  const missingFill = await recordRecoverySellerMixedSellReconciled({
    operationalStateStore,
    terminalOrder: makeOrder(),
    ownership,
    canonicalFills: [],
    accountingApplied: true,
    eligible: true,
  })
  const foreignFill = await recordRecoverySellerMixedSellReconciled({
    operationalStateStore,
    terminalOrder: makeOrder(),
    ownership,
    canonicalFills: [makeFill({ brokerOrderId: "foreign-broker-order" })],
    accountingApplied: true,
    eligible: true,
  })
  const uncommitted = await recordRecoverySellerMixedSellReconciled({
    operationalStateStore,
    terminalOrder: makeOrder(),
    ownership,
    canonicalFills: [makeFill()],
    accountingApplied: false,
    eligible: true,
  })

  assert.equal(missingFill.ok, false)
  assert.equal(foreignFill.ok, false)
  assert.equal(uncommitted.ok, false)
  assert.equal(appendCount, 0)
})
