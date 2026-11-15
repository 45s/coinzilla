import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

function createBroker({ responses = {} } = {}) {
  const calls = []
  const restClient = {
    async request(method, path, options = {}) {
      calls.push({ method, path, options })
      const key = path
      if (responses[key] instanceof Error) throw responses[key]
      return { data: responses[key] }
    },
  }
  const broker = new BitunixSpotBroker(
    { apiKey: "key", apiSecret: "secret", tradingMode: "live" },
    { restClientFactory: () => restClient },
  )
  return { broker, calls }
}

test("Bitunix Spot broker loads canonical Spot markets", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { symbol: "BTCUSDT", base: "BTC", quote: "USDT", isOpen: "1" },
        { symbol: "ETHUSDT", base: "ETH", quote: "USDT", isOpen: "1" },
      ],
    },
  })

  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.map(({ venue, symbol }) => [venue, symbol]), [
    ["bitunix", "BTCUSDT"],
    ["bitunix", "ETHUSDT"],
  ])
  assert.equal(calls[0].method, "GET")
})

test("Bitunix Spot broker reads balances without inventing an account snapshot timestamp", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/user/account": [
        { coin: "USDT", balance: "12.3400", balanceLocked: "1.25" },
      ],
    },
  })

  const balances = await broker.getBalances()
  const snapshot = await broker.getAccountSnapshot()

  assert.equal(balances.ok, true)
  assert.equal(balances.data[0].free.amount, "12.3400")
  assert.equal(balances.data[0].locked.amount, "1.25")
  assert.equal(snapshot.ok, false)
  assert.match(snapshot.errors[0].message, /source timestamp/i)
  assert.equal(calls.length, 1)
})

test("Bitunix Spot broker requires a symbol for open orders and history", async () => {
  const { broker, calls } = createBroker()

  const openOrders = await broker.getOpenOrders()
  const history = await broker.getOrderHistory()

  assert.equal(openOrders.ok, false)
  assert.equal(history.ok, false)
  assert.match(openOrders.errors[0].message, /symbol/i)
  assert.match(history.errors[0].message, /symbol/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot broker fetches pending orders for one symbol", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": [],
    },
  })

  const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [])
  assert.deepEqual(calls[0].options.body, { symbol: "BTCUSDT" })
})

test("Bitunix Spot broker fetches canonical fills for a specific order", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/detail": {
        orderId: "123",
        symbol: "BTCUSDT",
        side: "2",
        type: "1",
        status: "2",
        volume: "0.5",
        dealVolume: "0.5",
        price: "10",
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:01Z",
      },
      "/api/spot/v1/common/coin_pair/list": [
        { symbol: "BTCUSDT", base: "BTC", quote: "USDT", isOpen: "1" },
      ],
      "/api/spot/v1/order/deal/list": {
        id: "trade-1",
        volume: "0.5",
        price: "10",
        fee: "0.001",
        feeCoin: "BTC",
        role: "1",
        ctime: "2026-11-15T12:00:01Z",
      },
    },
  })

  const result = await broker.getFills({ symbol: "BTCUSDT", orderId: "123" })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].tradeId, "trade-1")
  assert.equal(result.data[0].brokerOrderId, "123")
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/spot/v1/order/detail",
    "/api/spot/v1/common/coin_pair/list",
    "/api/spot/v1/order/deal/list",
  ])
})

test("Bitunix Spot broker never submits or cancels orders without safe identity and stream guarantees", async () => {
  const { broker, calls } = createBroker()

  const created = await broker.createOrder({ symbol: "BTCUSDT", side: "BUY" })
  const cancelled = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: "123" })

  assert.equal(created.ok, false)
  assert.equal(cancelled.ok, false)
  assert.match(created.errors[0].message, /client order identity/i)
  assert.equal(cancelled.cancellationOutcome, "NOT_SENT")
  assert.equal(calls.length, 0)
})
