import test from "node:test"
import assert from "node:assert/strict"

import {
  calculateGridCycleSellPlan,
  createGridCycleFromBuyFills,
} from "./grid-cycle-planning.js"
import {
  appendGridCycleSellOrder,
  closeGridCycleSellOrder,
  createGridCycle,
  recordGridCycleSellFill,
} from "./grid-cycles.js"

function createBuyFill(overrides = {}) {
  return {
    id: "trade-1",
    orderId: "buy-1",
    symbol: "DOGEFDUSD",
    side: "BUY",
    quantity: "100",
    quoteQuantity: "10",
    commissionAmount: "0",
    commissionAsset: null,
    ...overrides,
  }
}

function createCycle(overrides = {}) {
  const result = createGridCycle({
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyFillIds: ["trade-1"],
    acquiredQuantity: "100",
    recoveryCost: "10",
    ...overrides,
  })
  assert.equal(result.ok, true)
  return result.data
}

test("builds a cycle from actual multi-fill BUY accounting and fee facts", () => {
  const result = createGridCycleFromBuyFills({
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyFills: [
      createBuyFill({
        id: "trade-1",
        quantity: "50",
        quoteQuantity: "5",
        commissionAmount: "0.01",
        commissionAsset: "DOGE",
      }),
      createBuyFill({
        id: "trade-2",
        quantity: "50",
        quoteQuantity: "5",
        commissionAmount: "0.01",
        commissionAsset: "FDUSD",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.acquiredQuantity, "99.99")
  assert.equal(result.data.recoveryCost, "10.01")
  assert.deepEqual(result.data.buyFillIds, ["trade-1", "trade-2"])
  assert.deepEqual(result.data.commissionTotals, { DOGE: "0.01", FDUSD: "0.01" })
})

test("derives identical cycles from identical canonical fill facts", () => {
  const input = {
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyFills: [createBuyFill()],
  }
  const first = createGridCycleFromBuyFills(input)
  const repeated = createGridCycleFromBuyFills(input)

  assert.equal(first.ok, true)
  assert.deepEqual(first, repeated)
  assert.equal(first.data.id, "grid-cycle:9:DOGEFDUSD:5:buy-1")
})

test("rejects missing, duplicate, mismatched, or non-BUY fill history", () => {
  const base = {
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
  }
  const invalid = [
    { ...base, buyFills: [] },
    { ...base, buyFills: [createBuyFill(), createBuyFill()] },
    { ...base, buyFills: [createBuyFill({ orderId: "other-order" })] },
    { ...base, buyFills: [createBuyFill({ symbol: "BTCUSDT" })] },
    { ...base, buyFills: [createBuyFill({ side: "SELL" })] },
    { ...base, buyFills: [createBuyFill({ id: "" })] },
    { ...base, buyFills: [createBuyFill({ quantity: "invalid" })] },
  ]

  for (const input of invalid) assert.equal(createGridCycleFromBuyFills(input).ok, false)
})

test("rejects third-asset BUY commissions rather than guessing their value", () => {
  const result = createGridCycleFromBuyFills({
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyFills: [createBuyFill({
      commissionAmount: "0.01",
      commissionAsset: "BNB",
    })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0], /Unsupported commission asset/)
})

test("plans an independent SELL from only the owning cycle's cost and proceeds", () => {
  const result = calculateGridCycleSellPlan({
    cycle: createCycle(),
    keepQuantity: "1",
    minProfit: "0.01",
    feeRate: "0",
    priceTickSize: "0.001",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    quantity: "99",
    price: "0.102",
    requiredNetProceeds: "10.01",
  })
})

test("includes reconciled partial-sale proceeds when replanning a canceled cycle SELL", () => {
  const initial = appendGridCycleSellOrder({
    cycle: createCycle(),
    orderId: "sell-1",
    quantity: "99",
    reservedQuantity: "99",
  })
  const partial = recordGridCycleSellFill({
    cycle: initial.data,
    fill: {
      id: "sell-trade-1",
      orderId: "sell-1",
      side: "SELL",
      quantity: "50",
      commissionAmount: "0",
      commissionAsset: null,
    },
    accounting: { baseQuantity: "50", quoteQuantity: "5" },
  })
  const canceled = closeGridCycleSellOrder({
    cycle: partial.data,
    orderId: "sell-1",
    status: "CANCELED",
    reconciled: true,
  })
  const result = calculateGridCycleSellPlan({
    cycle: canceled.data,
    keepQuantity: "1",
    minProfit: "0.01",
    feeRate: "0",
    priceTickSize: "0.001",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.quantity, "49")
  assert.equal(result.data.requiredNetProceeds, "5.01")
  assert.equal(result.data.price, "0.103")
})

test("refuses to plan a replacement while a cycle SELL is still live", () => {
  const cycle = createCycle()
  const withSell = {
    ...cycle,
    sellOrders: [{
      id: "sell-1",
      quantity: "99",
      filledQuantity: "0",
      reservedQuantity: "99",
      status: "OPEN",
    }],
    currentSellOrderId: "sell-1",
  }
  const result = calculateGridCycleSellPlan({
    cycle: withSell,
    keepQuantity: "1",
    minProfit: "0.01",
    feeRate: "0",
    priceTickSize: "0.001",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0], /already has a live SELL/)
})

test("returns a successful no-sellable-quantity plan when only keep inventory remains", () => {
  const result = calculateGridCycleSellPlan({
    cycle: createCycle({
      acquiredQuantity: "1",
      recoveryCost: "1",
    }),
    keepQuantity: "1",
    minProfit: "0.01",
    feeRate: "0",
    priceTickSize: "0.001",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.quantity, "0")
  assert.equal(result.data.price, null)
})
