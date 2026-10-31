import assert from "node:assert/strict"
import test from "node:test"

import { createGridCycle, appendGridCycleSellOrder, recordGridCycleSellFill, completeGridCycle } from "./grid-cycles.js"
import {
  projectGridPairAccounting,
  replayGridFillLedger,
} from "./grid-state-runtime.js"

function createCycle() {
  return createGridCycle({
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyOrder: {
      id: "buy-1",
      clientOrderId: "client-buy-1",
      symbol: "DOGEFDUSD",
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: "100",
      price: "0.1",
    },
    buyFillIds: ["buy-trade-1"],
    acquiredQuantity: "100",
    recoveryCost: "10",
  }).data
}

function createBuyFill() {
  return {
    id: "buy-trade-1",
    orderId: "buy-1",
    symbol: "DOGEFDUSD",
    side: "BUY",
    price: "0.1",
    quantity: "100",
    quoteQuantity: "10",
    commissionAmount: "0",
    commissionAsset: null,
    isMaker: true,
  }
}

function createSellFill() {
  return {
    id: "sell-trade-1",
    orderId: "sell-1",
    symbol: "DOGEFDUSD",
    side: "SELL",
    price: "0.102",
    quantity: "99",
    quoteQuantity: "10.098",
    commissionAmount: "0",
    commissionAsset: null,
    isMaker: true,
  }
}

function createState({ cycle, buyOrder = null } = {}) {
  return {
    symbol: "DOGEFDUSD",
    mode: "grid",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    orderType: "LIMIT_MAKER",
    configuredFeeRate: "0",
    buyOrder,
    gridCycles: new Map(cycle ? [[cycle.id, cycle]] : []),
    ledgerEntries: Object.freeze([]),
    processedTradeIds: new Set(),
    fills: new Map(),
    fillsByOrder: new Map(),
    filledQuantityByOrder: new Map(),
    commissionTotals: new Map(),
    marketInventory: null,
    activeQuantity: "0",
    cycleCost: "0",
    saleProceeds: "0",
    freeQuantity: "0",
    actualCommissionRate: "0",
    feeRate: "0",
  }
}

function createCompletedCycle() {
  const initial = createCycle()
  const withSell = appendGridCycleSellOrder({
    cycle: initial,
    orderId: "sell-1",
    clientOrderId: "client-sell-1",
    type: "LIMIT_MAKER",
    price: "0.102",
    quantity: "99",
    reservedQuantity: "99",
  })
  const filled = recordGridCycleSellFill({
    cycle: withSell.data,
    fill: {
      id: "sell-trade-1",
      orderId: "sell-1",
      side: "SELL",
      quantity: "99",
      commissionAmount: "0",
      commissionAsset: null,
    },
    accounting: {
      baseQuantity: "99",
      quoteQuantity: "10.098",
    },
  })
  return completeGridCycle({
    cycle: filled.data,
    keepQuantity: "1",
    minProfit: "0.01",
  }).data
}

test("replays canonical BUY and SELL fills into derived accounting maps", () => {
  const cycle = createCompletedCycle()
  const replayed = replayGridFillLedger({
    state: createState({ cycle }),
    ledgerEntries: [createSellFill(), createBuyFill()],
  })

  assert.equal(replayed.ok, true)
  assert.equal(replayed.data.activeQuantity, "0")
  assert.equal(replayed.data.marketInventory.strategy.baseQuantity, "1")
  assert.equal(replayed.data.fills.size, 2)
  assert.equal(replayed.data.filledQuantityByOrder.get("buy-1"), "100")
  assert.equal(replayed.data.filledQuantityByOrder.get("sell-1"), "99")
})

test("projects completed free inventory separately from active cycle exposure", () => {
  const cycle = createCompletedCycle()
  const replayed = replayGridFillLedger({
    state: createState({ cycle }),
    ledgerEntries: [createBuyFill(), createSellFill()],
  })
  const projected = projectGridPairAccounting({ state: replayed.data })

  assert.equal(projected.ok, true)
  assert.equal(projected.data.activeQuantity, "0")
  assert.equal(projected.data.freeQuantity, "1")
  assert.equal(projected.data.estimatedRealizedProfit, "0.098")
  assert.equal(projected.data.profitableCycles, 1)
  assert.equal(projected.data.sellFills, 1)
})

test("includes partial fills on the currently working BUY outside cycle inventory", () => {
  const pendingBuyOrder = {
    id: "buy-pending",
    clientOrderId: "client-pending",
    symbol: "DOGEFDUSD",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "100",
    price: "0.1",
    status: "NEW",
  }
  const pendingFill = {
    ...createBuyFill(),
    id: "pending-trade-1",
    orderId: "buy-pending",
    quantity: "40",
    quoteQuantity: "4",
  }
  const replayed = replayGridFillLedger({
    state: createState({ buyOrder: pendingBuyOrder }),
    ledgerEntries: [pendingFill],
  })
  const projected = projectGridPairAccounting({ state: replayed.data })

  assert.equal(projected.ok, true)
  assert.equal(projected.data.activeQuantity, "40")
  assert.equal(projected.data.cycleCost, "4")
})

test("fails closed when ledger fills do not map to persisted cycle orders", () => {
  const cycle = createCompletedCycle()
  const result = replayGridFillLedger({
    state: createState({ cycle }),
    ledgerEntries: [{
      ...createSellFill(),
      id: "unknown-trade",
      orderId: "unknown-order",
    }, createBuyFill()],
  })

  assert.equal(result.ok, false)
})

test("fails closed when cycle snapshots reference missing canonical fills", () => {
  const cycle = createCompletedCycle()
  const result = replayGridFillLedger({
    state: createState({ cycle }),
    ledgerEntries: [createBuyFill()],
  })

  assert.equal(result.ok, false)
})

test("fails closed when pair active/free totals do not match market inventory", () => {
  const cycle = createCompletedCycle()
  const replayed = replayGridFillLedger({
    state: createState({ cycle }),
    ledgerEntries: [createBuyFill(), createSellFill()],
  })
  const invalidState = {
    ...replayed.data,
    marketInventory: {
      ...replayed.data.marketInventory,
      strategy: {
        ...replayed.data.marketInventory.strategy,
        baseQuantity: "2",
      },
    },
  }

  assert.equal(projectGridPairAccounting({ state: invalidState }).ok, false)
})
