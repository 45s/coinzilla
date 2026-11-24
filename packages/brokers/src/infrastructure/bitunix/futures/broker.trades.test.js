import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-trades-test-key",
  apiSecret: "bitunix-futures-trades-test-secret",
}

const tradeRow = {
  tradeId: "trade-123",
  orderId: "order-456",
  clientId: "client-789",
  symbol: "BTCUSDT",
  qty: "0.125000000000000001",
  price: "65000.123456789012345",
  side: "BUY",
  orderType: "LIMIT",
  positionMode: "HEDGE",
  marginMode: "ISOLATION",
  leverage: 10,
  effect: "GTC",
  reduceOnly: false,
  fee: "0.000125",
  realizedPNL: "-0.25",
  ctime: 1_700_000_000_123,
  roleType: "MAKER",
}

function createBroker({ rows = [tradeRow], total = rows.length } = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...args) => {
          const [url, options] = args
          requests.push({
            url: String(url),
            options,
          })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data: {
                tradeList: rows,
                total,
              },
            }),
          }
        },
      },
    },
  })
  return {
    broker,
    requests,
  }
}

test("Bitunix Futures trade history preserves execution, fee and realized PnL decimals without claiming canonical fills", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesTradeHistory({
    symbol: "btcusdt",
    orderId: "order-456",
    limit: 50,
    skip: 100,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.total, 1)
  assert.deepEqual(result.data.trades[0], {
    tradeId: "trade-123",
    orderId: "order-456",
    clientId: "client-789",
    symbol: "BTCUSDT",
    quantity: "0.125000000000000001",
    price: "65000.123456789012345",
    side: "BUY",
    orderType: "LIMIT",
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    effect: "GTC",
    reduceOnly: false,
    fee: "0.000125",
    realizedPNL: "-0.25",
    executedAt: 1_700_000_000_123,
    liquidityRole: "MAKER",
  })
  const query = new URL(requests[0].url).searchParams
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/futures/trade/get_history_trades")
  assert.equal(query.get("symbol"), "BTCUSDT")
  assert.equal(query.get("orderId"), "order-456")
  assert.equal(query.get("limit"), "50")
  assert.equal(query.get("skip"), "100")
})

test("Bitunix Futures trade history rejects malformed identity and financial fields", async () => {
  const { broker } = createBroker({
    rows: [{
      ...tradeRow,
      tradeId: "",
      fee: "NaN",
    }],
  })
  const result = await broker.getFuturesTradeHistory({
    symbol: "BTCUSDT",
  })
  assert.equal(result.ok, false)
})

test("Bitunix Futures trade history requires a bounded filter and validates pagination", async () => {
  const { broker, requests } = createBroker()
  const noFilter = await broker.getFuturesTradeHistory({})
  const invalidLimit = await broker.getFuturesTradeHistory({
    symbol: "BTCUSDT",
    limit: 101,
  })
  assert.equal(noFilter.ok, false)
  assert.equal(invalidLimit.ok, false)
  assert.equal(requests.length, 0)
})
