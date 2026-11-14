import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-durable-facts-store.js"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { recordOrderSubmissionOutcome } from "./record-order-submission-outcome.js"

const baseAsset = new Asset({ id: "binance:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const makeOrder = ({ brokerOrderId, status = "PENDING", executedQuantity = "0" } = {}) => new CanonicalOrder({
  clientOrderId: "h-0123456789abcdef012345-1",
  brokerOrderId,
  market,
  side: "BUY",
  type: "LIMIT_MAKER",
  limitPrice: new Money({ amount: "0.099", asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: "100", asset: baseAsset }),
  executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
  status,
  createdAt: brokerOrderId ? 1 : undefined,
  acknowledgedAt: brokerOrderId ? 1 : undefined,
  updatedAt: brokerOrderId ? 1 : undefined,
})

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-order-outcome-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "order-outcome-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}

test("records the broker acknowledgement and canonical execution state as a durable outcome", async (t) => {
  const operationalStateStore = await createStore(t)
  const order = makeOrder({ brokerOrderId: "broker-1", status: "PARTIALLY_FILLED", executedQuantity: "12.5" })
  const result = await recordOrderSubmissionOutcome({
    operationalStateStore,
    order,
    outcome: "ACKNOWLEDGED",
    purpose: "RECOVERY_SELL",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true, "The acknowledged order must be durable before local acknowledgement is committed.")
  assert.equal(result.data.record.factId, "order-submission-outcome:" + order.clientOrderId + ":ACKNOWLEDGED")
  assert.equal(result.data.record.factType, "ORDER_SUBMISSION_OUTCOME")
  assert.deepEqual(result.data.record.data, {
    clientOrderId: order.clientOrderId,
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
    purpose: "RECOVERY_SELL",
    outcome: "ACKNOWLEDGED",
    brokerOrderId: "broker-1",
    status: "PARTIALLY_FILLED",
  }, "The durable acknowledgement must preserve canonical broker identity and any execution already visible in the response.")
})

test("records unknown submission outcomes without inventing a broker order identity", async (t) => {
  const operationalStateStore = await createStore(t)
  const order = makeOrder()
  const result = await recordOrderSubmissionOutcome({
    operationalStateStore,
    order,
    outcome: "UNKNOWN",
    purpose: null,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.equal(result.data.record.data.brokerOrderId, null)
  assert.equal(result.data.record.data.status, "PENDING")
  assert.equal(result.data.record.data.outcome, "UNKNOWN")
})

test("rejects outcome classifications that contradict canonical broker acknowledgement state", async () => {
  let appendCalls = 0
  const operationalStateStore = { append: async () => { appendCalls += 1; return { ok: true, data: { durable: true } } } }
  const pendingOrder = makeOrder()
  const acknowledgedOrder = makeOrder({ brokerOrderId: "broker-1", status: "OPEN" })

  const falseAcknowledgement = await recordOrderSubmissionOutcome({
    operationalStateStore,
    order: pendingOrder,
    outcome: "ACKNOWLEDGED",
    purpose: null,
  })
  const falseUnknown = await recordOrderSubmissionOutcome({
    operationalStateStore,
    order: acknowledgedOrder,
    outcome: "UNKNOWN",
    purpose: null,
  })

  assert.equal(falseAcknowledgement.ok, false, "ACKNOWLEDGED requires a canonical broker order identity and non-PENDING status.")
  assert.equal(falseUnknown.ok, false, "Unknown/rejected outcomes must not discard a known broker acknowledgement.")
  assert.equal(appendCalls, 0, "Contradictory outcomes must be rejected before durable storage is touched.")
})

test("requires a durable store acknowledgement for every submission outcome", async () => {
  const result = await recordOrderSubmissionOutcome({
    operationalStateStore: { append: async () => ({ ok: true, data: { durable: false } }) },
    order: makeOrder(),
    outcome: "REJECTED_OR_UNKNOWN",
    purpose: null,
  })

  assert.equal(result.ok, false, "A non-durable outcome append must not permit local progression.")
  assert.match(result.errors[0].message, /durable|commit/i)
})
