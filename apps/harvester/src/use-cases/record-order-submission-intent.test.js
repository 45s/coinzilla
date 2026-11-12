import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { recordOrderSubmissionIntent } from "./record-order-submission-intent.js"

const baseAsset = new Asset({ id: "binance:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const order = new CanonicalOrder({
  clientOrderId: "h-0123456789abcdef012345-1",
  market,
  side: "BUY",
  type: "LIMIT_MAKER",
  limitPrice: new Money({ amount: "0.099000", asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: "100.000", asset: baseAsset }),
  executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
  status: "PENDING",
})

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-order-intent-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "order-intent-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}

test("records the canonical immutable order intent and requires a durable append acknowledgement", async (t) => {
  const durableFactsStore = await createStore(t)
  const result = await recordOrderSubmissionIntent({
    durableFactsStore,
    order,
    purpose: "RECOVERY_SELL",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true, "Order submission must proceed only after the durable store confirms its committed fact.")
  assert.equal(result.data.record.factId, "order-submission-intent:" + order.clientOrderId)
  assert.equal(result.data.record.factType, "ORDER_SUBMISSION_INTENT")
  assert.deepEqual(result.data.record.data, {
    clientOrderId: order.clientOrderId,
    marketId: market.id,
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAssetId: "binance:DOGE",
    quoteAssetId: "binance:USDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "0.099000",
    quantity: "100.000",
    purpose: "RECOVERY_SELL",
  }, "The fact must preserve canonical market/order identities, exact decimal strings, and strategy purpose.")
})

test("rejects a successful-shaped append that does not confirm durable commitment", async () => {
  const result = await recordOrderSubmissionIntent({
    durableFactsStore: { append: async () => ({ ok: true, data: { durable: false } }) },
    order,
    purpose: null,
  })

  assert.equal(result.ok, false, "A non-durable append response must never authorize broker submission.")
  assert.match(result.errors[0].message, /durable|commit/i)
})

test("rejects non-canonical orders and unsupported strategy purposes before appending", async () => {
  let appendCalls = 0
  const durableFactsStore = { append: async () => { appendCalls += 1; return { ok: true, data: { durable: true } } } }

  const invalidOrder = await recordOrderSubmissionIntent({
    durableFactsStore,
    order: { ...order },
    purpose: null,
  })
  const invalidPurpose = await recordOrderSubmissionIntent({
    durableFactsStore,
    order,
    purpose: "UNRECOGNIZED_PURPOSE",
  })

  assert.equal(invalidOrder.ok, false, "Only a canonical pending order may become a durable submission intent.")
  assert.equal(invalidPurpose.ok, false, "Only a declared strategy purpose or null may be persisted.")
  assert.equal(appendCalls, 0, "Invalid order intent data must be rejected before durable storage is touched.")
})

test("durable store rejects malformed order submission fact payloads", async (t) => {
  const store = await createStore(t)
  const malformedFacts = [
    { factId: "bad-order:1", factType: "ORDER_SUBMISSION_INTENT", data: {} },
    {
      factId: "bad-order:2",
      factType: "ORDER_SUBMISSION_INTENT",
      data: {
        clientOrderId: "client-2",
        marketId: "market-1",
        venue: "binance",
        symbol: "DOGEUSDT",
        baseAssetId: "binance:DOGE",
        quoteAssetId: "binance:USDT",
        side: "BUY",
        type: "LIMIT_MAKER",
        price: 0.099,
        quantity: "100",
        purpose: null,
      },
    },
    {
      factId: "bad-order:3",
      factType: "ORDER_SUBMISSION_INTENT",
      data: {
        clientOrderId: "client-3",
        marketId: "market-1",
        venue: "binance",
        symbol: "DOGEUSDT",
        baseAssetId: "binance:DOGE",
        quoteAssetId: "binance:USDT",
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "0.099",
        quantity: "100",
        purpose: null,
        apiKey: "must-not-persist",
      },
    },
  ]

  for (const fact of malformedFacts) {
    const result = await store.append(fact)
    assert.equal(result.ok, false, "Malformed or secret-bearing order facts must be rejected by the durable store.")
  }
})
