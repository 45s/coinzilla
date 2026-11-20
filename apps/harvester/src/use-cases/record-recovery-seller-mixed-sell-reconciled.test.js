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
        return {
          ok: true,
          data: { durable: true },
        }
      },
    },
    terminalOrder: makeOrder(),
    ownership,
    canonicalFills: [makeFill()],
    accountingApplied: true,
    eligible: false,
  })

  assert.equal(result.ok, true, "A complete canonical terminal SELL must persist its reconciliation boundary.")
  assert.equal(appended.factType, "RECOVERY_SELLER_MIXED_SELL_RECONCILED", "The writer must append the dedicated RS reconciliation fact.")
  assert.equal(appended.data.terminalStatus, "FILLED", "The fact must preserve the terminal broker order status.")
  assert.deepEqual(appended.data.appliedFillIds, [makeFill().id], "The fact must bind the exact canonical SELL fill set.")
  assert.equal(appended.data.accountingApplied, true, "The fact may only be written after both accounting projections commit.")
  assert.equal(appended.data.eligible, false, "The fact must preserve the explicit profitability eligibility result.")
})

test("does not persist a terminal boundary for incomplete or foreign accounting evidence", async () => {
  let appendCount = 0
  const operationalStateStore = {
    append: async () => {
      appendCount += 1
      return {
          ok: true,
          data: { durable: true },
        }
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

  assert.equal(missingFill.ok, false, "An empty terminal fill set must not release the SELL reservation.")
  assert.equal(missingFill.errors[0].code, "RS_MIXED_SELL_RECONCILIATION_INVALID", "Missing fills must produce the stable RS reconciliation error code.")
  assert.equal(foreignFill.ok, false, "A fill owned by another broker order must not be accepted.")
  assert.equal(foreignFill.errors[0].code, "RS_MIXED_SELL_RECONCILIATION_INVALID", "Foreign fills must produce the stable RS reconciliation error code.")
  assert.equal(uncommitted.ok, false, "Accounting that did not commit must not produce a terminal fact.")
  assert.equal(uncommitted.errors[0].code, "RS_MIXED_SELL_ACCOUNTING_NOT_COMMITTED", "Uncommitted accounting must produce its distinct stable error code.")
  assert.equal(appendCount, 0, "Invalid reconciliation evidence must be rejected before any durable append.")
})
