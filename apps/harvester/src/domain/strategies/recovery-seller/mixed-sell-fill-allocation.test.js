import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { addDecimal } from "@coinzilla/utils"
import { StrategyId } from "../strategy-ids.js"
import { createOrderOwnership } from "../../orders/order-ownership.js"
import { createFillFingerprint } from "../../fills/fill-fingerprint.js"
import { createMixedSellFillAllocation } from "./mixed-sell-fill-allocation.js"

const baseAsset = new Asset({ id: "binance:ZRO", code: "ZRO" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const feeAsset = new Asset({ id: "binance:BNB", code: "BNB" })
const market = new Market({ venue: "binance", symbol: "ZROUSDT", baseAsset, quoteAsset })

function makeFill(overrides = {}) {
  return new Fill({
    tradeId: "trade-1",
    brokerOrderId: "broker-1",
    clientOrderId: "exchange-client-id",
    market,
    side: "SELL",
    price: new Money({ amount: "2", asset: quoteAsset }),
    quantity: new Quantity({ amount: "5.01", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10.02", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 103,
    commissions: [
      new Commission({ amount: new Money({ amount: "0.005", asset: baseAsset }) }),
      new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      new Commission({
        amount: new Money({ amount: "0.02", asset: feeAsset }),
        quoteValue: new Money({ amount: "0.05", asset: quoteAsset }),
      }),
    ],
    commissionStatus: "COMPLETE",
    ...overrides,
  })
}

function makeOrder(overrides = {}) {
  const quantity = overrides.quantity ?? "5.01"
  const brokerOrderId = overrides.brokerOrderId ?? "broker-1"
  return new CanonicalOrder({
    clientOrderId: overrides.clientOrderId ?? "harvester-rs-sell",
    brokerOrderId,
    market: overrides.market ?? market,
    side: overrides.side ?? "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "2", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity, asset: baseAsset }),
    executedQuantity: new Quantity({ amount: overrides.executedQuantity ?? quantity, asset: baseAsset }),
    status: overrides.status ?? "FILLED",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 103,
  })
}

function makeOwnership(overrides = {}) {
  return createOrderOwnership({
    ownership: {
      strategyId: overrides.strategyId ?? StrategyId.RECOVERY_SELLER,
      positionId: overrides.positionId ?? "rs-position-1",
      purpose: overrides.purpose ?? "RECOVERY_SELL",
      cycleId: "rs-cycle-1",
    },
    clientOrderId: overrides.clientOrderId ?? "harvester-rs-sell",
    brokerOrderId: overrides.brokerOrderId ?? "broker-1",
  })
}

function makeInput(overrides = {}) {
  const fill = overrides.fill ?? makeFill()
  const order = overrides.order ?? makeOrder()
  const ownership = overrides.ownership ?? makeOwnership()
  return {
    fill,
    order,
    ownership,
    recoveryQuantity: overrides.recoveryQuantity ?? "5",
    legacyQuantity: overrides.legacyQuantity ?? "0.01",
  }
}

function sum(left, right) {
  return addDecimal({ left, right })
}

test("allocates one canonical mixed SELL Fill across recovery and legacy without synthetic fills", () => {
  const input = makeInput()
  const allocation = createMixedSellFillAllocation(input)

  assert.equal(allocation.fillId, input.fill.id, "Allocation must reference the original canonical Fill ID.")
  assert.equal(allocation.fillFingerprint, createFillFingerprint({ fill: input.fill }), "Allocation must bind the complete canonical execution facts.")
  assert.equal(allocation.marketId, market.id, "Allocation must retain the canonical market identity.")
  assert.equal(allocation.orderOwnership.clientOrderId, "harvester-rs-sell", "Allocation must retain the original Harvester client order identity.")
  assert.equal(allocation.orderOwnership.brokerOrderId, "broker-1", "Allocation must retain the acknowledged broker order identity.")
  assert.equal(allocation.orderOwnership.positionId, "rs-position-1", "Recovery allocation must retain its registered Position owner.")
  assert.equal(allocation.orderOwnership.purpose, input.ownership.purpose, "Allocation must preserve the registered order purpose without inventing a new purpose enum.")
  assert.equal(allocation.recovery.grossBaseQuantity, "5", "Recovery receives only its explicitly allocated gross base quantity.")
  assert.equal(allocation.legacy.grossBaseQuantity, "0.01", "Legacy receives only its explicitly allocated gross base quantity.")
  assert.equal(allocation.recovery.quoteProceeds, "10", "Recovery proceeds must be split from actual canonical quote proceeds.")
  assert.equal(allocation.legacy.quoteProceeds, "0.02", "Legacy proceeds must be split from actual canonical quote proceeds.")
  assert.equal(sum(allocation.recovery.grossBaseQuantity, allocation.legacy.grossBaseQuantity), input.fill.quantity.amount)
  assert.equal(sum(allocation.recovery.quoteProceeds, allocation.legacy.quoteProceeds), input.fill.quoteQuantity.amount)
})

test("allocates every actual commission amount and quote valuation without losing canonical facts", () => {
  const input = makeInput()
  const allocation = createMixedSellFillAllocation(input)

  for (const commission of input.fill.commissions) {
    const recovery = allocation.recovery.commissions.find((item) => item.assetId === commission.amount.asset.id)
    const legacy = allocation.legacy.commissions.find((item) => item.assetId === commission.amount.asset.id)
    assert.ok(recovery, "Recovery allocation must retain each canonical commission asset.")
    assert.ok(legacy, "Legacy allocation must retain each canonical commission asset.")
    assert.equal(sum(recovery.amount, legacy.amount), commission.amount.amount, "Allocated commission amounts must sum exactly to the canonical amount.")
    if (commission.quoteValue) {
      assert.equal(sum(recovery.quoteValue.amount, legacy.quoteValue.amount), commission.quoteValue.amount, "Allocated quote valuations must sum exactly to the canonical valuation.")
    }
  }

  const baseCommission = input.fill.commissions.find((item) => item.amount.asset.id === baseAsset.id)
  assert.equal(
    sum(allocation.recovery.baseDebit, allocation.legacy.baseDebit),
    sum(input.fill.quantity.amount, baseCommission.amount.amount),
    "Recovery and legacy base debits together must equal executed base plus actual base commission exactly once.",
  )
})

test("creates deterministic deeply immutable allocation metadata", () => {
  const input = makeInput()
  const first = createMixedSellFillAllocation(input)
  const second = createMixedSellFillAllocation(input)

  assert.equal(first.allocationFingerprint, second.allocationFingerprint, "Identical Fill, ownership and split facts must produce the same allocation fingerprint.")
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.orderOwnership), true)
  assert.equal(Object.isFrozen(first.recovery), true)
  assert.equal(Object.isFrozen(first.legacy), true)
  assert.equal(Object.isFrozen(first.recovery.commissions), true)
  assert.equal(Object.isFrozen(first.recovery.commissions[0]), true)
})

test("supports a recovery-only SELL after legacy quantity is exhausted", () => {
  const fill = makeFill({
    quantity: new Quantity({ amount: "5", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    commissions: [],
  })
  const order = makeOrder({ quantity: "5", executedQuantity: "5" })
  const allocation = createMixedSellFillAllocation({
    fill,
    order,
    ownership: makeOwnership(),
    recoveryQuantity: "5",
    legacyQuantity: "0",
  })

  assert.equal(allocation.recovery.grossBaseQuantity, "5")
  assert.equal(allocation.legacy.grossBaseQuantity, "0")
  assert.equal(allocation.recovery.quoteProceeds, "10")
  assert.equal(allocation.legacy.quoteProceeds, "0")
  assert.equal(allocation.recovery.baseDebit, "5")
  assert.equal(allocation.legacy.baseDebit, "0")
})

test("rejects legacy-only SELL allocation and quantity splits that do not conserve the Fill", () => {
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ recoveryQuantity: "0", legacyQuantity: "5.01" })),
    /recoveryQuantity must be greater than zero/i,
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ recoveryQuantity: "4", legacyQuantity: "0.01" })),
    /sum to the canonical Fill quantity/i,
  )
})

test("requires SELL-side registered ownership that matches the canonical order and Fill", () => {
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ order: makeOrder({ side: "BUY" }) })),
    /SELL/i,
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ fill: makeFill({ side: "BUY" }) })),
    /SELL/i,
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ fill: makeFill({ brokerOrderId: "other-broker" }) })),
    /broker order identity/i,
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ ownership: makeOwnership({ strategyId: StrategyId.COIN_GRABBER }) })),
    /Recovery Seller/i,
  )
})

test("rejects incomplete commissions and third-asset fees without quote valuation", () => {
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ fill: makeFill({ commissionStatus: "UNKNOWN" }) })),
    /commission/i,
  )
  const missingThirdAssetValue = makeFill({
    commissions: [new Commission({ amount: new Money({ amount: "0.02", asset: feeAsset }) })],
  })
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ fill: missingThirdAssetValue })),
    /quote-currency valuation/i,
  )
})


test("allocation fingerprint is stable when canonical commission entries are reordered", () => {
  const input = makeInput()
  const reorderedFill = makeFill({
    commissions: [...input.fill.commissions].reverse(),
  })
  const first = createMixedSellFillAllocation(input)
  const reordered = createMixedSellFillAllocation({
    ...input,
    fill: reorderedFill,
  })

  assert.equal(first.fillFingerprint, reordered.fillFingerprint)
  assert.equal(first.allocationFingerprint, reordered.allocationFingerprint)
})

test("rejects an order from another market or a Fill larger than its registered order", () => {
  const otherMarket = new Market({
    venue: "other",
    symbol: "ZROUSDT",
    baseAsset,
    quoteAsset,
  })
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ order: makeOrder({ market: otherMarket }) })),
    /market identity/i,
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ order: makeOrder({ quantity: "5", executedQuantity: "5" }) })),
    /exceeds registered order quantity/i,
  )
})
