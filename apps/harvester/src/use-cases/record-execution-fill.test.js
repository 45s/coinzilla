import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { recordExecutionFill } from "./record-execution-fill.js"

const baseAsset = new Asset({ id: "binance:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const feeAsset = new Asset({ id: "binance:BNB", code: "BNB" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const fill = new Fill({
  tradeId: "trade-123",
  brokerOrderId: "broker-order-9",
  clientOrderId: "client-order-9",
  market,
  side: "BUY",
  price: new Money({ amount: "0.1", asset: quoteAsset }),
  quantity: new Quantity({ amount: "100", asset: baseAsset }),
  quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
  liquidityRole: "MAKER",
  executedAt: 1762905600000,
  commissions: [
    new Commission({
      amount: new Money({ amount: "0.001", asset: feeAsset }),
      quoteValue: new Money({ amount: "0.02", asset: quoteAsset }),
    }),
  ],
  commissionStatus: "COMPLETE",
})

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-execution-fill-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "execution-fill-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}

test("records complete canonical fill identity, exact amounts, and commission quote valuation", async (t) => {
  const durableFactsStore = await createStore(t)
  const result = await recordExecutionFill({ durableFactsStore, fill })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.equal(result.data.record.factId, "execution-fill-applied:" + fill.id)
  assert.equal(result.data.record.factType, "EXECUTION_FILL_APPLIED")
  assert.deepEqual(result.data.record.data, {
    fillId: fill.id,
    tradeId: "trade-123",
    brokerOrderId: "broker-order-9",
    clientOrderId: "client-order-9",
    marketId: market.id,
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAssetId: "binance:DOGE",
    quoteAssetId: "binance:USDT",
    side: "BUY",
    price: "0.1",
    quantity: "100",
    quoteQuantity: "10",
    liquidityRole: "MAKER",
    executedAt: 1762905600000,
    commissionStatus: "COMPLETE",
    commissions: [{
      amount: "0.001",
      assetId: "binance:BNB",
      assetCode: "BNB",
      quoteValue: { amount: "0.02", assetId: "binance:USDT", assetCode: "USDT" },
    }],
  })
})

test("does not report a fill durable when the append is not committed", async () => {
  const result = await recordExecutionFill({
    durableFactsStore: { append: async () => ({ ok: true, data: { durable: false } }) },
    fill,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /durable|commit/i)
})

test("rejects non-canonical fills before appending", async () => {
  let appendCalls = 0
  const result = await recordExecutionFill({
    durableFactsStore: { append: async () => { appendCalls += 1; return { ok: true, data: { durable: true } } } },
    fill: { ...fill },
  })

  assert.equal(result.ok, false)
  assert.equal(appendCalls, 0)
})


test("durable store rejects malformed or secret-bearing execution fill facts", async (t) => {
  const durableFactsStore = await createStore(t)
  const malformedFacts = [
    { factId: "execution-fill-applied:bad", factType: "EXECUTION_FILL_APPLIED", data: {} },
    {
      factId: "execution-fill-applied:bad-2",
      factType: "EXECUTION_FILL_APPLIED",
      data: {
        fillId: "binance:DOGEUSDT:trade-2",
        tradeId: "trade-2",
        brokerOrderId: "broker-2",
        clientOrderId: null,
        marketId: "binance:DOGEUSDT",
        venue: "binance",
        symbol: "DOGEUSDT",
        baseAssetId: "binance:DOGE",
        quoteAssetId: "binance:USDT",
        side: "BUY",
        price: 0.1,
        quantity: "100",
        quoteQuantity: "10",
        liquidityRole: "MAKER",
        executedAt: null,
        commissionStatus: "COMPLETE",
        commissions: [],
      },
    },
    {
      factId: "execution-fill-applied:bad-3",
      factType: "EXECUTION_FILL_APPLIED",
      data: {
        fillId: "binance:DOGEUSDT:trade-3",
        tradeId: "trade-3",
        brokerOrderId: "broker-3",
        clientOrderId: null,
        marketId: "binance:DOGEUSDT",
        venue: "binance",
        symbol: "DOGEUSDT",
        baseAssetId: "binance:DOGE",
        quoteAssetId: "binance:USDT",
        side: "BUY",
        price: "0.1",
        quantity: "100",
        quoteQuantity: "10",
        liquidityRole: "MAKER",
        executedAt: null,
        commissionStatus: "COMPLETE",
        commissions: [],
        apiSecret: "never persist",
      },
    },
  ]

  for (const fact of malformedFacts) {
    const result = await durableFactsStore.append(fact)
    assert.equal(result.ok, false, "Malformed or secret-bearing fill facts must fail closed.")
  }
})
