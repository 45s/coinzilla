import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"

import {
  reconcileExecutionFill,
  toExecutionFill,
  validateOrderFill,
} from "./fill-reconciliation.js"


const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEFDUSD",
  baseAsset,
  quoteAsset,
})

function createCanonicalFill({
  commissions = [],
  commissionStatus = "COMPLETE",
  liquidityRole = "MAKER",
} = {}) {
  return new Fill({
    tradeId: "101",
    brokerOrderId: "11",
    market,
    side: "BUY",
    price: new Money({ amount: "0.05", asset: quoteAsset }),
    quantity: new Quantity({ amount: "10", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "0.5", asset: quoteAsset }),
    liquidityRole,
    executedAt: 1000,
    commissions,
    commissionStatus,
  })
}

function createState(overrides = {}) {
  return {
    orderType: "LIMIT",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
    configuredFeeRate: "0.001",
    feeRate: "0.001",
    actualCommissionRate: "0",
    activeQuantity: "0",
    cycleCost: "0",
    saleProceeds: "0",
    processedTradeIds: new Set(),
    fills: new Map(),
    fillsByOrder: new Map(),
    filledQuantityByOrder: new Map(),
    commissionTotals: new Map(),
    ...overrides,
  }
}

function createFill(overrides = {}) {
  return {
    id: "trade-1",
    orderId: "order-1",
    symbol: "DOGEUSDT",
    side: "BUY",
    price: "2",
    quantity: "10",
    quoteQuantity: "20",
    commissionAmount: "0",
    commissionAsset: null,
    isMaker: true,
    ...overrides,
  }
}


test("converts a complete canonical Fill to the existing exact accounting input", () => {
  const result = toExecutionFill({ fill: createCanonicalFill() })

  assert.equal(result.ok, true)
  assert.deepEqual(result.fill, {
    id: "101",
    orderId: "11",
    symbol: "DOGEFDUSD",
    side: "BUY",
    price: "0.05",
    quantity: "10",
    quoteQuantity: "0.5",
    commissionAmount: "0",
    commissionAsset: null,
    isMaker: true,
  })
})

test("preserves one known commission and liquidity role", () => {
  const commission = new Commission({
    amount: new Money({ amount: "0.02", asset: quoteAsset }),
  })
  const result = toExecutionFill({
    fill: createCanonicalFill({
      commissions: [commission],
      liquidityRole: "TAKER",
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.fill.commissionAmount, "0.02")
  assert.equal(result.fill.commissionAsset, "FDUSD")
  assert.equal(result.fill.isMaker, false)
})

test("fails closed for unresolved fees, multiple commission assets, or unknown liquidity", () => {
  const commission = new Commission({
    amount: new Money({ amount: "0.01", asset: quoteAsset }),
  })
  assert.equal(toExecutionFill({
    fill: createCanonicalFill({ commissionStatus: "UNKNOWN" }),
  }).ok, false)
  assert.equal(toExecutionFill({
    fill: createCanonicalFill({ commissions: [commission], commissionStatus: "PARTIAL" }),
  }).ok, false)
  assert.equal(toExecutionFill({
    fill: createCanonicalFill({ commissions: [commission, commission] }),
  }).ok, false)
  assert.equal(toExecutionFill({
    fill: createCanonicalFill({ liquidityRole: "UNKNOWN" }),
  }).ok, false)
})

test("reconciles a BUY fill into new state without mutating the input", () => {
  const state = createState()
  const result = reconcileExecutionFill({ fill: createFill(), state })

  assert.equal(result.ok, true)
  assert.equal(result.duplicate, false)
  assert.equal(result.updates.activeQuantity, "10")
  assert.equal(result.updates.cycleCost, "20")
  assert.equal(result.updates.filledQuantityByOrder.get("order-1"), "10")
  assert.equal(state.activeQuantity, "0")
  assert.equal(state.cycleCost, "0")
  assert.equal(state.processedTradeIds.size, 0)
  assert.equal(result.updates.processedTradeIds.has("trade-1"), true)
})

test("accounts for base-asset BUY commission as reduced received inventory", () => {
  const result = reconcileExecutionFill({
    fill: createFill({
      commissionAmount: "0.1",
      commissionAsset: "DOGE",
    }),
    state: createState(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.updates.activeQuantity, "9.9")
  assert.equal(result.updates.cycleCost, "20")
})

test("accounts for quote-asset SELL commission as reduced net proceeds", () => {
  const result = reconcileExecutionFill({
    fill: createFill({
      side: "SELL",
      commissionAmount: "0.2",
      commissionAsset: "USDT",
    }),
    state: createState({ activeQuantity: "10" }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.updates.activeQuantity, "0")
  assert.equal(result.updates.saleProceeds, "19.8")
})

test("deduplicates a fill already processed from another source", () => {
  const state = createState({
    processedTradeIds: new Set(["trade-1"]),
  })

  const result = reconcileExecutionFill({ fill: createFill(), state })

  assert.equal(result.ok, true)
  assert.equal(result.duplicate, true)
  assert.equal(result.updates, undefined)
})

test("preserves reported commission facts when a third-asset fee makes accounting unsupported", () => {
  const fill = createFill({
    commissionAmount: "0.01",
    commissionAsset: "BNB",
  })
  const result = reconcileExecutionFill({ fill, state: createState() })

  assert.equal(result.ok, false)
  assert.match(result.reason, /Unsupported or incomplete commission/)
  assert.equal(result.updates.processedTradeIds.has("trade-1"), true)
  assert.equal(result.updates.commissionTotals.get("BNB"), "0.01")
  assert.equal(result.recordedFill.commissionAsset, "BNB")
})

test("rejects SELL fills that exceed strategy-owned inventory", () => {
  const result = reconcileExecutionFill({
    fill: createFill({ side: "SELL", quantity: "11", quoteQuantity: "22" }),
    state: createState({ activeQuantity: "10" }),
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /consumes more base inventory/)
  assert.equal(result.updates.activeQuantity, undefined)
  assert.equal(result.updates.processedTradeIds.has("trade-1"), true)
})

test("rejects malformed fill identity without recording or mutating state", () => {
  const state = createState()
  const result = reconcileExecutionFill({
    fill: createFill({ id: "-1" }),
    state,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /stable trade or order ID/)
  assert.equal(result.updates, undefined)
  assert.equal(state.processedTradeIds.size, 0)
})

test("rejects taker fills for LIMIT_MAKER orders while retaining the reported fill", () => {
  const result = reconcileExecutionFill({
    fill: createFill({ isMaker: false }),
    state: createState({ orderType: "LIMIT_MAKER" }),
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /taker fill/)
  assert.equal(result.updates.processedTradeIds.has("trade-1"), true)
  assert.equal(result.updates.filledQuantityByOrder, undefined)
})

test("validates history fills against the requested order, symbol, and side", () => {
  const order = { id: "order-1", side: "BUY" }
  const fill = createFill()

  assert.deepEqual(
    validateOrderFill({ fill, symbol: "DOGEUSDT", order }),
    { ok: true },
  )
  assert.equal(
    validateOrderFill({ fill: { ...fill, orderId: "other" }, symbol: "DOGEUSDT", order }).ok,
    false,
  )
  assert.equal(
    validateOrderFill({ fill, symbol: "BTCUSDT", order }).ok,
    false,
  )
  assert.equal(
    validateOrderFill({ fill: { ...fill, side: "SELL" }, symbol: "DOGEUSDT", order }).ok,
    false,
  )
})


test("rejects missing state and non-object fills without throwing or recording data", () => {
  const state = createState()
  const expected = {
    ok: false,
    duplicate: false,
    reason: "Execution fill or pair state is missing",
  }

  assert.deepEqual(
    reconcileExecutionFill({ fill: createFill(), state: null }),
    expected,
  )
  assert.deepEqual(
    reconcileExecutionFill({ fill: null, state }),
    expected,
  )
  assert.deepEqual(
    reconcileExecutionFill({ fill: "not-a-fill", state }),
    expected,
  )

  assert.equal(state.processedTradeIds.size, 0)
  assert.equal(state.fills.size, 0)
})
