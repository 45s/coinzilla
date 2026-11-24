import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"
import { Fill } from "@coinzilla/entities"

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
          const path = new URL(url).pathname
          requests.push({
            url: String(url),
            options,
          })
          const data = path === "/api/v1/futures/market/trading_pairs"
            ? [{
              symbol: "BTCUSDT",
              base: "BTC",
              quote: "USDT",
              symbolStatus: "OPEN",
              isApiSupported: true,
            }]
            : {
              tradeList: rows,
              total,
            }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data,
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


test("Bitunix Futures getFills maps stable trade IDs into exact canonical Fill values", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFills({
    symbol: "BTCUSDT",
    orderId: "order-456",
    limit: 50,
    skip: 100,
  })

  assert.equal(result.ok, true, "documented Futures trade history should provide canonical fills")
  assert.equal(result.data.length, 1, "one exchange trade should produce one canonical fill")
  assert.ok(result.data[0] instanceof Fill, "canonical fill reads must return the shared Fill entity")
  assert.equal(result.data[0].tradeId, "trade-123", "the exchange trade ID must remain the canonical fill identity")
  assert.equal(result.data[0].brokerOrderId, "order-456", "the fill must retain its exchange order identity")
  assert.equal(result.data[0].clientOrderId, "client-789", "the fill must retain the optional client order identity")
  assert.equal(result.data[0].quantity.amount, "0.125000000000000001", "base quantity must remain an exact decimal string")
  assert.equal(result.data[0].price.amount, "65000.123456789012345", "execution price must remain an exact decimal string")
  assert.equal(result.data[0].quoteQuantity.amount, "8125.015432098626608125123457", "quote notional must be derived with exact decimal arithmetic")
  assert.equal(result.data[0].liquidityRole, "MAKER", "the exchange roleType must map to the canonical liquidity role")
  assert.equal(result.data[0].commissionStatus, "UNKNOWN", "the fee asset is not supplied by the exchange response")
  assert.equal(result.data[0].commissions.length, 0, "unknown fee denomination must not be fabricated")
  assert.equal(result.data[0].executedAt, 1_700_000_000_123, "the exchange execution timestamp must be preserved")
  assert.equal(requests.filter(({ options }) => options.method === "GET").length, 2, "fill mapping must read the trade page and canonical market metadata")
})
