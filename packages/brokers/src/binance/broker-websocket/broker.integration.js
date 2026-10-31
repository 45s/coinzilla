import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { BinanceWebSocketBroker } from "./broker.js"
import { BinanceWebSocketConfig } from "./config/binance-websocket-config.js"

if (process.env.NODE_ENV === "production") {
  throw new Error(
    "Refusing to run Binance WebSocket integration tests with NODE_ENV=production",
  )
}

const hasTestnetCredentials =
  Boolean(process.env.BINANCE_API_KEY) &&
  Boolean(process.env.BINANCE_API_SECRET_KEY) &&
  !/replace-with|mock/i.test(process.env.BINANCE_API_KEY) &&
  !/replace-with|mock/i.test(process.env.BINANCE_API_SECRET_KEY)

const symbol = "DOGEFDUSD"
const price = 0.05
const quantity = 1_000

let broker

describe(
  "BinanceWebSocketBroker native WebSocket integration (TESTNET)",
  { skip: !hasTestnetCredentials && "Set Binance TESTNET credentials to run these tests" },
  () => {
    before(async () => {
      const config = new BinanceWebSocketConfig({
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET_KEY,
      })

      assert.match(
        config.websocketApiUrl,
        /^wss:\/\/ws-api\.testnet\.binance\.vision\//,
        "Broker integration tests must never connect to the production WebSocket API",
      )
      assert.match(
        config.websocketStreamsUrl,
        /^wss:\/\/stream\.testnet\.binance\.vision\//,
        "Broker integration tests must never connect to production WebSocket Streams",
      )

      broker = new BinanceWebSocketBroker(config)
      await broker.connect()
    })

    after(async () => {
      await broker?.disconnect()
    })

    it("fetches account assets", async () => {
      const { ok, data: assets } = await broker.getAssets()
      assert.ok(ok)
      assert.ok(Array.isArray(assets))
    })

    it("fetches open orders", async () => {
      const { ok, data: orders } = await broker.getOpenOrders({ symbol })
      assert.ok(ok)
      assert.ok(Array.isArray(orders))
    })

    it("fetches symbol price filters", async () => {
      const { ok, data } = await broker.getSymbolFilters({ symbol })
      assert.ok(ok)
      assert.equal(data.symbol, symbol)
      assert.ok(Number.isFinite(Number(data.tickSize)) && Number(data.tickSize) > 0)
      assert.ok(Number.isFinite(Number(data.stepSize)) && Number(data.stepSize) > 0)
    })

    it("fetches ticker price", async () => {
      const { ok, data } = await broker.getPrices({ symbol })
      assert.ok(ok)
      assert.equal(data.symbol, symbol)
    })

    it("creates, checks, and cancels a test order", async () => {
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

        const result = await broker.getOrder({ symbol, orderId: order.id })
        assert.ok(result.ok)
        assert.equal(result.data.id, order.id)
      } finally {
        if (order?.id) {
          const result = await broker.cancelOrder({
            symbol,
            orderId: order.id,
          })
          assert.ok(result.ok)
          assert.equal(order.id, result.data.id)
        }
      }
    })
  },
)
