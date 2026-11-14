import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { recordOrderCancellationIntent } from "./record-order-cancellation-intent.js"
import { recordOrderCancellationOutcome } from "./record-order-cancellation-outcome.js"

const baseAsset = new Asset({ id: "binance:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const makeOrder = ({ status = "OPEN", executedQuantity = "0" } = {}) => new CanonicalOrder({
  clientOrderId: "h-0123456789abcdef012345-1",
  brokerOrderId: "broker-1",
  market,
  side: "BUY",
  type: "LIMIT_MAKER",
  limitPrice: new Money({ amount: "0.099", asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: "100", asset: baseAsset }),
  executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
  status,
  createdAt: 1,
  acknowledgedAt: 1,
  updatedAt: 1,
})
const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-order-cancellation-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "order-cancellation-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}

test("records the canonical expected order state before cancellation is attempted", async (t) => {
  const operationalStateStore = await createStore(t)
  const order = makeOrder({ status: "PARTIALLY_FILLED", executedQuantity: "12.5" })
  const result = await recordOrderCancellationIntent({
    operationalStateStore,
    order,
    reason: "TRAILING_BUY_REPRICE",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.equal(result.data.record.factType, "ORDER_CANCELLATION_INTENT")
  assert.equal(result.data.record.factId, "order-cancellation-intent:" + order.clientOrderId + ":TRAILING_BUY_REPRICE:PARTIALLY_FILLED:12.5")
  assert.deepEqual(result.data.record.data, {
    clientOrderId: order.clientOrderId,
    brokerOrderId: "broker-1",
    marketId: market.id,
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAssetId: "binance:DOGE",
    quoteAssetId: "binance:USDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "0.099",
    quantity: "100",
    executedQuantity: "12.5",
    reason: "TRAILING_BUY_REPRICE",
    status: "PARTIALLY_FILLED",
  })
})

test("records a confirmed cancellation outcome with the canonical terminal state", async (t) => {
  const operationalStateStore = await createStore(t)
  const order = makeOrder()
  const canceledOrder = new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: order.executedQuantity,
    status: "CANCELED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const result = await recordOrderCancellationOutcome({
    operationalStateStore,
    order,
    canceledOrder,
    reason: "TRAILING_BUY_REPRICE",
    outcome: "CANCELED",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.equal(result.data.record.factType, "ORDER_CANCELLATION_OUTCOME")
  assert.equal(result.data.record.factId, "order-cancellation-outcome:" + order.clientOrderId + ":TRAILING_BUY_REPRICE:CANCELED")
  assert.equal(result.data.record.data.status, "CANCELED")
  assert.equal(result.data.record.data.executedQuantity, "0")
})

test("records NOT_SENT without inventing a canceled state or changing the expected order", async (t) => {
  const operationalStateStore = await createStore(t)
  const order = makeOrder()
  const result = await recordOrderCancellationOutcome({
    operationalStateStore,
    order,
    reason: "TRAILING_BUY_REPRICE",
    outcome: "NOT_SENT",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.record.data.status, null)
  assert.equal(result.data.record.data.executedQuantity, null)
})

test("rejects a cancellation response that changes canonical order identity", async () => {
  let appendCalls = 0
  const order = makeOrder()
  const mismatched = new CanonicalOrder({
    clientOrderId: "other-client-order",
    brokerOrderId: "broker-1",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: order.executedQuantity,
    status: "CANCELED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const result = await recordOrderCancellationOutcome({
    operationalStateStore: { append: async () => { appendCalls += 1; return { ok: true, data: { durable: true } } } },
    order,
    canceledOrder: mismatched,
    reason: "TRAILING_BUY_REPRICE",
    outcome: "CANCELED",
  })

  assert.equal(result.ok, false)
  assert.equal(appendCalls, 0)
})

test("rejects non-canonical cancellation intents and requires durable append acknowledgement", async () => {
  const order = makeOrder()
  let appendCalls = 0
  const invalid = await recordOrderCancellationIntent({
    operationalStateStore: { append: async () => { appendCalls += 1; return { ok: true, data: { durable: true } } } },
    order: { ...order },
    reason: "TRAILING_BUY_REPRICE",
  })
  const uncommitted = await recordOrderCancellationIntent({
    operationalStateStore: { append: async () => ({ ok: true, data: { durable: false } }) },
    order,
    reason: "TRAILING_BUY_REPRICE",
  })

  assert.equal(invalid.ok, false)
  assert.equal(uncommitted.ok, false)
  assert.equal(appendCalls, 0)
})
