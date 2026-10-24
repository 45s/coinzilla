import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { BinanceSdkBroker } from "./broker.js"
import { BinanceSdkConfig } from "./binance-sdk-config.js"

const symbol = "DOGEFDUSD"
const price = 0.05
const quantity = 1_000

const broker = new BinanceSdkBroker(
  new BinanceSdkConfig({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET_KEY,
  }),
)

describe("BinanceSdkBroker integration (TESTNET)", () => {
  before(async () => {
    await broker.connect()
  })

  after(async () => {
    await broker.disconnect()
  })

  it("fetches account assets", async () => {
    const { ok, data: assets } = await broker.getAssets()
    assert.ok(ok)
    assert.ok(Array.isArray(assets))
  })

  it("fetches open orders", async () => {
    const { ok, data: orders } = await broker.getOpenOrders({
      symbol,
    })
    assert.ok(ok)
    assert.ok(Array.isArray(orders))
  })

  it("fetches ticker price", async () => {
    const { ok, data } = await broker.getPrices({ symbol })
    assert.ok(ok)
    assert.ok(data.symbol === symbol)
  })

  it("creates, checks, and cancels a test order", async (t) => {
    let order

    try {
      const { ok, data } = await broker.createOrder({
        symbol,
        side: "BUY",
        price,
        quantity,
      })
      order = data
      assert.ok(ok)
      assert.ok(order.id)
      assert.equal(order.symbol, symbol)

      const r = await broker.getOrder({
        symbol,
        orderId: order.id,
      })
      assert.ok(r.ok)
      assert.equal(r.data.id, order.id)
    } finally {
      if (order?.id) {
        const r = await broker.cancelOrder({
          symbol,
          orderId: order.id,
        })
        assert.ok(r.ok)
        assert.equal(order.id, r.data.id)
      }
    }
  })
})
