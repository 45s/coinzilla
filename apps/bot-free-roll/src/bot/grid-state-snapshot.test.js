import assert from "node:assert/strict"
import test from "node:test"

import {
  createGridConfigFingerprint,
  restoreGridPairState,
  serializeGridPairState,
  validateGridPairStateSnapshot,
} from "./grid-state-snapshot.js"
import { createGridCycle } from "./grid-cycles.js"
import { createGridOrderIntent } from "./grid-order-intents.js"

function createBuyOrder({ id = "buy-1", symbol = "DOGEFDUSD" } = {}) {
  return {
    id,
    clientOrderId: `client-${id}`,
    symbol,
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "100",
    price: "0.1",
  }
}

function createCycle() {
  return createGridCycle({
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyOrder: createBuyOrder(),
    buyFillIds: ["trade-1"],
    acquiredQuantity: "100",
    recoveryCost: "10",
  }).data
}

function createIntent(overrides = {}) {
  return createGridOrderIntent({
    intentId: "sell-intent-1",
    symbol: "DOGEFDUSD",
    side: "SELL",
    type: "LIMIT_MAKER",
    quantity: "99",
    price: "0.102",
    createdAtServerTime: 1_800_000_000_000,
    cycleId: createCycle().id,
    ...overrides,
  }).data
}

function createState(overrides = {}) {
  return {
    symbol: "DOGEFDUSD",
    mode: "grid",
    settings: { orderQuantity: 100, keepQuantity: 1 },
    buyOrder: null,
    gridCycles: new Map([[createCycle().id, createCycle()]]),
    orderIntents: new Map(),
    ledgerEntries: Object.freeze([]),
    nextIntentSequence: 2,
    referencePrice: 0.1,
    highestPrice: 0.11,
    lastAdjustmentPrice: 0.1,
    lastBuyPrice: "0.1",
    trailingBuy: false,
    paused: false,
    configuredFeeRate: "0",
    ...overrides,
  }
}

const fingerprint = "grid-config-v1"

test("creates stable configuration fingerprints independent of object key order", () => {
  const first = createGridConfigFingerprint({
    symbol: "DOGEFDUSD",
    settings: {
      orderQuantity: 100,
      keepQuantity: 1,
      fees: { maker: 0, taker: 0.075 },
    },
    minProfit: 0.01,
  })
  const reordered = createGridConfigFingerprint({
    symbol: "DOGEFDUSD",
    settings: {
      fees: { taker: 0.075, maker: 0 },
      keepQuantity: 1,
      orderQuantity: 100,
    },
    minProfit: "0.01",
  })
  const changed = createGridConfigFingerprint({
    symbol: "DOGEFDUSD",
    settings: { orderQuantity: 200, keepQuantity: 1 },
    minProfit: "0.01",
  })

  assert.equal(first.ok, true)
  assert.equal(first.data, reordered.data)
  assert.notEqual(first.data, changed.data)
  assert.equal(createGridConfigFingerprint({ symbol: "DOGEFDUSD" }).ok, false)
})

test("serializes durable Grid fields without duplicating derived accounting maps", () => {
  const state = createState()
  const result = serializeGridPairState({
    state,
    configFingerprint: fingerprint,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.mode, "grid")
  assert.equal(result.data.symbol, "DOGEFDUSD")
  assert.equal(result.data.cycles.length, 1)
  assert.equal(result.data.ledgerEntries.length, 0)
  assert.equal("processedTradeIds" in result.data, false)
  assert.equal("activeQuantity" in result.data, false)
})

test("restores cycle and intent maps while clearing derived state for ledger replay", () => {
  const cycle = createCycle()
  const intent = createIntent()
  const snapshot = serializeGridPairState({
    state: createState({
      gridCycles: new Map([[cycle.id, cycle]]),
      orderIntents: new Map([[intent.clientOrderId, intent]]),
      buyOrder: createBuyOrder({ id: "buy-2" }),
    }),
    configFingerprint: fingerprint,
  }).data
  const restored = restoreGridPairState({
    snapshot,
    state: createState(),
    configFingerprint: fingerprint,
  })

  assert.equal(restored.ok, true)
  assert.equal(restored.data.gridCycles.get(cycle.id).id, cycle.id)
  assert.equal(restored.data.orderIntents.get(intent.clientOrderId).intentId, intent.intentId)
  assert.equal(restored.data.buyOrder.id, "buy-2")
  assert.equal(restored.data.sellOrder, null)
  assert.equal(restored.data.activeQuantity, "0")
  assert.equal(restored.data.processedTradeIds.size, 0)
  assert.equal(restored.data.trackedOrderIds.has(cycle.buyOrder.id), true)
})

test("rejects a snapshot when the pair config fingerprint changes", () => {
  const snapshot = serializeGridPairState({
    state: createState(),
    configFingerprint: fingerprint,
  }).data

  const result = restoreGridPairState({
    snapshot,
    state: createState(),
    configFingerprint: "changed-config",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0], /configuration fingerprint/)
})

test("rejects unknown cycle references, duplicate intents, and conflicting BUY state", () => {
  const snapshot = serializeGridPairState({
    state: createState(),
    configFingerprint: fingerprint,
  }).data
  const invalidCycleIntent = {
    ...snapshot,
    orderIntents: [createIntent({ cycleId: "missing-cycle" })],
  }
  const duplicateIntent = {
    ...snapshot,
    orderIntents: [createIntent(), createIntent({ intentId: "sell-intent-2" })],
  }
  const conflictingBuy = {
    ...snapshot,
    buyOrder: createBuyOrder(),
    orderIntents: [createIntent({
      side: "BUY",
      cycleId: null,
      intentId: "buy-intent",
    })],
  }

  assert.equal(validateGridPairStateSnapshot({
    snapshot: invalidCycleIntent,
    symbol: "DOGEFDUSD",
    configFingerprint: fingerprint,
  }).ok, false)
  assert.equal(validateGridPairStateSnapshot({
    snapshot: duplicateIntent,
    symbol: "DOGEFDUSD",
    configFingerprint: fingerprint,
  }).ok, false)
  assert.equal(validateGridPairStateSnapshot({
    snapshot: conflictingBuy,
    symbol: "DOGEFDUSD",
    configFingerprint: fingerprint,
  }).ok, false)
})

test("rejects acknowledged intents that reuse a broker order ID", () => {
  const first = createIntent({
    intentId: "sell-intent-1",
    status: "ACKNOWLEDGED",
    brokerOrderId: "broker-order-shared",
  })
  const second = createIntent({
    intentId: "sell-intent-2",
    status: "ACKNOWLEDGED",
    brokerOrderId: "broker-order-shared",
  })
  const snapshot = serializeGridPairState({
    state: createState({ orderIntents: new Map([
      [first.clientOrderId, first],
      [second.clientOrderId, second],
    ]) }),
    configFingerprint: fingerprint,
  })

  assert.equal(snapshot.ok, false)
  assert.match(snapshot.errors[0], /malformed or mismatched order intent/)
})

test("rejects malformed ledger entries and cross-symbol orders", () => {
  const snapshot = serializeGridPairState({
    state: createState(),
    configFingerprint: fingerprint,
  }).data

  assert.equal(validateGridPairStateSnapshot({
    snapshot: { ...snapshot, ledgerEntries: [{ id: "trade-1", orderId: "buy-1", symbol: "BTCUSDT", side: "BUY" }] },
    symbol: "DOGEFDUSD",
    configFingerprint: fingerprint,
  }).ok, false)
  assert.equal(validateGridPairStateSnapshot({
    snapshot: { ...snapshot, cycles: [{ ...createCycle(), symbol: "BTCUSDT" }] },
    symbol: "DOGEFDUSD",
    configFingerprint: fingerprint,
  }).ok, false)
})
