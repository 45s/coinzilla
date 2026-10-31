import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"

import {
  reconcileExecutionFill,
  replayExecutionFills,
  toExecutionFill,
  validateOrderFill,
  reconcileFillHistory,
} from "./fill-reconciliation.js"
import { appendFillLedgerEntry } from "./fill-ledger.js"
import { createMarketInventoryLedger } from "./market-inventory-ledger.js"


const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEFDUSD",
  baseAsset,
  quoteAsset,
})

function createCanonicalFill({
  tradeId = "101",
  brokerOrderId = "11",
  side = "BUY",
  price = "0.05",
  quantity = "10",
  quoteQuantity = "0.5",
  commissions = [],
  commissionStatus = "COMPLETE",
  liquidityRole = "MAKER",
} = {}) {
  return new Fill({
    tradeId: String(tradeId),
    brokerOrderId: String(brokerOrderId),
    market,
    side,
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
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
    ledgerEntries: Object.freeze([]),
    marketInventory: createMarketInventoryLedger({
      market: { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT" },
    }).ledger,
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
  const ledger = appendFillLedgerEntry({
    entries: Object.freeze([]),
    fill: createFill(),
  })
  const state = createState({
    processedTradeIds: new Set(["trade-1"]),
    ledgerEntries: ledger.entries,
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

function createLocalExecutionFill(overrides = {}) {
  return {
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
    ...overrides,
  }
}

test("backfills exchange-only fills while preserving matching local fills", () => {
  const knownFill = createCanonicalFill({ tradeId: "100" })
  const missingFill = createCanonicalFill({ tradeId: "101" })
  const result = reconcileFillHistory({
    localFills: [createLocalExecutionFill({ id: "100" })],
    canonicalFills: [knownFill, missingFill],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.missingFills, [missingFill])
  assert.ok(Object.isFrozen(result.missingFills))
})

test("rejects local fills missing from exchange history and changed fill facts", () => {
  const localFill = createLocalExecutionFill()
  const missing = reconcileFillHistory({
    localFills: [localFill],
    canonicalFills: [],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /missing from exchange history/)

  const changed = reconcileFillHistory({
    localFills: [createLocalExecutionFill({ quantity: "9" })],
    canonicalFills: [createCanonicalFill()],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(changed.ok, false)
  assert.match(changed.reason, /quantity differs/)
})

test("rejects duplicate and unsupported exchange fills", () => {
  const fill = createCanonicalFill()
  const duplicate = reconcileFillHistory({
    localFills: [],
    canonicalFills: [fill, fill],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.reason, /duplicate fill/)

  const unresolved = reconcileFillHistory({
    localFills: [],
    canonicalFills: [createCanonicalFill({ commissionStatus: "UNKNOWN" })],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(unresolved.ok, false)
  assert.match(unresolved.reason, /Commission data is unknown/)
})

test("treats zero-fee asset metadata as economically irrelevant", () => {
  const result = reconcileFillHistory({
    localFills: [createLocalExecutionFill({ commissionAsset: "BNB" })],
    canonicalFills: [createCanonicalFill()],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })

  assert.deepEqual(result, { ok: true, missingFills: [] })
})

test("rejects invalid inputs and local fill identity mismatches", () => {
  assert.equal(reconcileFillHistory({}).ok, false)
  assert.equal(toExecutionFill({ fill: {} }).ok, false)

  const identityMismatch = reconcileFillHistory({
    localFills: [createLocalExecutionFill({ isMaker: false })],
    canonicalFills: [createCanonicalFill()],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(identityMismatch.ok, false)
  assert.match(identityMismatch.reason, /identity differs/)
})

test("rejects changed commission assets and malformed exact fill values", () => {
  const commission = new Commission({
    amount: new Money({ amount: "0.01", asset: quoteAsset }),
  })
  const commissionMismatch = reconcileFillHistory({
    localFills: [createLocalExecutionFill({
      commissionAmount: "0.01",
      commissionAsset: "BNB",
    })],
    canonicalFills: [createCanonicalFill({ commissions: [commission] })],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(commissionMismatch.ok, false)
  assert.match(commissionMismatch.reason, /commission asset differs/)

  const malformed = reconcileFillHistory({
    localFills: [createLocalExecutionFill({ quantity: "not-a-quantity" })],
    canonicalFills: [createCanonicalFill()],
    symbol: "DOGEFDUSD",
    order: { id: "11", side: "BUY" },
  })
  assert.equal(malformed.ok, false)
  assert.match(malformed.reason, /invalid exact values/)
})


test("records each accepted execution as an immutable ledger entry", () => {
  const state = createState()
  const fill = createFill()
  const result = reconcileExecutionFill({ fill, state })

  assert.equal(result.ok, true)
  assert.equal(result.recordedFill.id, "trade-1")
  assert.equal(Object.isFrozen(result.recordedFill), true)
  assert.equal(Object.isFrozen(result.updates.ledgerEntries), true)
  assert.equal(result.updates.ledgerEntries.length, 1)
  assert.equal(result.updates.fills.get("trade-1"), result.recordedFill)
  assert.equal(state.ledgerEntries.length, 0)
})

test("fails closed when a fill belongs to a different market ledger", () => {
  const otherMarket = createMarketInventoryLedger({
    market: { symbol: "DOGEFDUSD", baseAsset: "DOGE", quoteAsset: "FDUSD" },
  })
  const state = createState({ marketInventory: otherMarket.ledger })
  const result = reconcileExecutionFill({ fill: createFill(), state })

  assert.equal(result.ok, false)
  assert.match(result.reason, /does not match DOGEFDUSD/)
  assert.equal(result.updates.marketInventory, undefined)
})

test("fails closed when a processed trade is missing from the immutable ledger", () => {
  const state = createState({
    processedTradeIds: new Set(["trade-1"]),
  })
  const result = reconcileExecutionFill({ fill: createFill(), state })

  assert.equal(result.ok, false)
  assert.match(result.reason, /missing from the immutable fill ledger/)
  assert.equal(result.updates, undefined)
})

test("fails closed when the ledger contains a trade missing from the processed index", () => {
  const ledger = appendFillLedgerEntry({
    entries: Object.freeze([]),
    fill: createFill(),
  })
  const state = createState({ ledgerEntries: ledger.entries })
  const result = reconcileExecutionFill({ fill: createFill(), state })

  assert.equal(result.ok, false)
  assert.match(result.reason, /contains unprocessed trade/)
  assert.equal(result.updates, undefined)
})

test("fails closed when a duplicate trade ID carries changed execution facts", () => {
  const state = createState()
  const first = reconcileExecutionFill({ fill: createFill(), state })
  const nextState = { ...state, ...first.updates }
  const conflict = reconcileExecutionFill({
    fill: createFill({ quantity: "9", quoteQuantity: "18" }),
    state: nextState,
  })

  assert.equal(conflict.ok, false)
  assert.match(conflict.reason, /Conflicting facts for trade trade-1/)
  assert.equal(nextState.activeQuantity, "10")
  assert.equal(nextState.ledgerEntries.length, 1)
})

const replayPairState = Object.freeze({
  symbol: "DOGEUSDT",
  orderType: "LIMIT",
  baseAsset: "DOGE",
  quoteAsset: "USDT",
  configuredFeeRate: "0.001",
})

function getReplayProjection(state) {
  return {
    activeQuantity: state.activeQuantity,
    cycleCost: state.cycleCost,
    saleProceeds: state.saleProceeds,
    actualCommissionRate: state.actualCommissionRate,
    feeRate: state.feeRate,
    filledQuantityByOrder: [...state.filledQuantityByOrder],
    commissionTotals: [...state.commissionTotals],
    ledgerEntries: state.ledgerEntries,
    marketInventory: state.marketInventory,
  }
}

test("replays multiple partial fills with exact mixed-asset commissions deterministically", () => {
  const entries = [
    createFill({
      id: "buy-fill-1",
      orderId: "buy-order",
      quantity: "10",
      quoteQuantity: "20",
      commissionAmount: "0.1",
      commissionAsset: "DOGE",
    }),
    createFill({
      id: "buy-fill-2",
      orderId: "buy-order",
      price: "3",
      quantity: "5",
      quoteQuantity: "15",
      commissionAmount: "0.02",
      commissionAsset: "USDT",
    }),
    createFill({
      id: "sell-fill-1",
      orderId: "sell-order",
      side: "SELL",
      price: "4",
      quantity: "4",
      quoteQuantity: "16",
      commissionAmount: "0.04",
      commissionAsset: "USDT",
    }),
  ]
  const original = structuredClone(entries)
  const first = replayExecutionFills({ entries, pairState: replayPairState })
  const second = replayExecutionFills({ entries, pairState: replayPairState })

  assert.equal(first.ok, true)
  assert.equal(first.state.activeQuantity, "10.9")
  assert.equal(first.state.cycleCost, "35.02")
  assert.equal(first.state.saleProceeds, "15.96")
  assert.equal(first.state.filledQuantityByOrder.get("buy-order"), "15")
  assert.equal(first.state.filledQuantityByOrder.get("sell-order"), "4")
  assert.equal(first.state.fillsByOrder.get("buy-order"), 2)
  assert.equal(first.state.commissionTotals.get("DOGE"), "0.1")
  assert.equal(first.state.commissionTotals.get("USDT"), "0.06")
  assert.equal(first.state.marketInventory.strategy.baseQuantity, "10.9")
  assert.equal(first.state.marketInventory.strategy.quoteCashFlow, "-19.06")
  assert.deepEqual(first.state.marketInventory.strategy.commissionsByAsset, [
    { asset: "DOGE", amount: "0.1" },
    { asset: "USDT", amount: "0.06" },
  ])
  assert.equal(first.state.marketInventory.unmanaged.status, "unreconciled")
  assert.equal(first.state.marketInventory.unmanaged.baseQuantity, undefined)
  assert.equal(Object.isFrozen(first.state.ledgerEntries), true)
  assert.deepEqual(getReplayProjection(first.state), getReplayProjection(second.state))
  assert.deepEqual(entries, original)
})

test("replay applies a repeated identical trade ID only once", () => {
  const fill = createFill()
  const result = replayExecutionFills({
    entries: [fill, { ...fill }],
    pairState: replayPairState,
  })

  assert.equal(result.ok, true)
  assert.equal(result.state.activeQuantity, "10")
  assert.equal(result.state.fills.size, 1)
  assert.equal(result.state.ledgerEntries.length, 1)
})

test("replay rejects conflicting duplicate facts without applying them twice", () => {
  const fill = createFill()
  const result = replayExecutionFills({
    entries: [fill, { ...fill, quantity: "9", quoteQuantity: "18" }],
    pairState: replayPairState,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /Conflicting facts for trade trade-1/)
  assert.equal(result.failedFillId, "trade-1")
  assert.equal(result.state.activeQuantity, "10")
  assert.equal(result.state.ledgerEntries.length, 1)
})

test("replay preserves unsupported fee facts and stops before later entries", () => {
  const result = replayExecutionFills({
    entries: [
      createFill(),
      createFill({
        id: "third-asset-fee",
        commissionAmount: "0.01",
        commissionAsset: "BNB",
      }),
      createFill({ id: "must-not-run", orderId: "later-order" }),
    ],
    pairState: replayPairState,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /Unsupported or incomplete commission/)
  assert.equal(result.failedFillId, "third-asset-fee")
  assert.equal(result.state.activeQuantity, "10")
  assert.equal(result.state.commissionTotals.get("BNB"), "0.01")
  assert.equal(result.state.ledgerEntries.length, 2)
  assert.equal(result.state.processedTradeIds.has("must-not-run"), false)
})

test("replay validates entries, pair settings, and exact configured fee rate", () => {
  assert.equal(replayExecutionFills({ entries: null, pairState: replayPairState }).ok, false)
  assert.equal(replayExecutionFills({ entries: [], pairState: null }).ok, false)
  assert.equal(replayExecutionFills({
    entries: [],
    pairState: { ...replayPairState, orderType: "MARKET" },
  }).ok, false)

  const invalidFee = replayExecutionFills({
    entries: [],
    pairState: { ...replayPairState, configuredFeeRate: "not-a-rate" },
  })
  assert.equal(invalidFee.ok, false)
  assert.match(invalidFee.reason, /invalid configured fee rate/)

  const negativeFee = replayExecutionFills({
    entries: [],
    pairState: { ...replayPairState, configuredFeeRate: "-0.001" },
  })
  assert.equal(negativeFee.ok, false)
  assert.match(negativeFee.reason, /must be non-negative/)
})


test("replay keeps explicitly attributed unmanaged movements separate from strategy inventory", () => {
  const result = replayExecutionFills({
    entries: [createFill()],
    pairState: replayPairState,
    unmanagedMovements: [
      {
        id: "deposit-1",
        symbol: "DOGEUSDT",
        asset: "DOGE",
        source: "deposit",
        amount: "2",
      },
      {
        id: "withdrawal-1",
        symbol: "DOGEUSDT",
        asset: "USDT",
        source: "withdrawal",
        amount: "-5",
      },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.state.marketInventory.strategy.baseQuantity, "10")
  assert.equal(result.state.marketInventory.strategy.quoteCashFlow, "-20")
  assert.deepEqual(result.state.marketInventory.unmanaged.byAsset, [
    { asset: "DOGE", amount: "2" },
    { asset: "USDT", amount: "-5" },
  ])
  assert.equal(result.state.marketInventory.unmanaged.status, "unreconciled")
})

test("replay rejects a non-array unmanaged movement history", () => {
  const result = replayExecutionFills({
    entries: [],
    pairState: replayPairState,
    unmanagedMovements: null,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /Unmanaged movement ledger entries must be an array/)
})

test("replay stops on an unmanaged movement assigned to another market", () => {
  const result = replayExecutionFills({
    entries: [createFill()],
    pairState: replayPairState,
    unmanagedMovements: [{
      id: "wrong-market",
      symbol: "DOGEFDUSD",
      asset: "DOGE",
      source: "deposit",
      amount: "1",
    }],
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /does not match DOGEUSDT/)
  assert.equal(result.failedMovementId, "wrong-market")
  assert.equal(result.state.marketInventory.strategy.baseQuantity, "10")
})
