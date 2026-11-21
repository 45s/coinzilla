import assert from "node:assert/strict"
import test from "node:test"

import { createBitunixFuturesMarketDataClient } from "./bitunix-futures-market-data.js"

function createResponse(data) {
  return {
    ok: true,
    async json() {
      return data
    },
  }
}

function createContractResponse() {
  return createResponse({
    code: 0,
    data: [{
      symbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
      symbolStatus: "OPEN",
      isApiSupported: true,
      maxLeverage: 125,
    }],
  })
}

function createTickerResponse() {
  return createResponse({
    code: 0,
    data: [{
      symbol: "BTCUSDT",
      lastPrice: "67000.10",
      markPrice: "67001.20",
      open: "65000.00",
      high: "68000.00",
      low: "64000.00",
      quoteVol: "123456.78",
      baseVol: "12.5",
    }],
  })
}

function createFetchImpl(requests) {
  return async (...requestArguments) => {
    const [url, options] = requestArguments
    requests.push({
      url: String(url),
      options,
    })
    return String(url).endsWith("/trading_pairs")
      ? createContractResponse()
      : createTickerResponse()
  }
}

function createExpectedMarket() {
  return {
    symbol: "BTCUSDT",
    base: "BTC",
    quote: "USDT",
    symbolStatus: "OPEN",
    isApiSupported: true,
    maxLeverage: 125,
    lastPrice: "67000.10",
    markPrice: "67001.20",
    open: "65000.00",
    high: "68000.00",
    low: "64000.00",
    quoteVol: "123456.78",
    baseVol: "12.5",
    change5m: null,
    change1h: null,
    change4h: null,
    change24h: null,
  }
}

class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.listeners = new Map()
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.emit("open", {}))
  }

  addEventListener(...argumentsList) {
    const [type, listener] = argumentsList
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(payload) {
    this.subscription = JSON.parse(payload)
    queueMicrotask(() => this.emit("message", {
      data: JSON.stringify({
        ch: "tickers",
        data: [{
          s: "BTCUSDT",
          r: "-0.7097029863",
        }],
      }),
    }))
  }

  close() {
    this.closed = true
  }

  emit(...argumentsList) {
    const [type, event] = argumentsList
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

test("loads Bitunix Futures REST fields without deriving missing movement percentages", async () => {
  const requests = []
  const client = createBitunixFuturesMarketDataClient({
    now: () => new Date("2026-11-21T12:00:00.000Z"),
    fetchImpl: createFetchImpl(requests),
    WebSocketImpl: null,
  })

  assert.equal(Object.isFrozen(client), true, "The public market-data client facade must be immutable.")
  const snapshot = await client.getBitunixFuturesMarkets()

  assert.equal(requests.length, 2, "The client must fetch contracts and tickers from the two public REST endpoints.")
  assert.ok(requests.every((request) => request.options.method === "GET"), "Market data must use read-only GET requests.")
  assert.ok(requests.every((request) => !("authorization" in request.options.headers)), "Public market-data requests must not require credentials.")
  assert.deepEqual(snapshot, {
    provider: "bitunix",
    marketType: "futures",
    observedAt: "2026-11-21T12:00:00.000Z",
    markets: [createExpectedMarket()],
  }, "The client must expose only returned exchange fields and keep unavailable percentages null.")
})

test("passes through Bitunix's native rolling 24-hour WebSocket fluctuation unchanged", async () => {
  FakeWebSocket.instances = []
  const client = createBitunixFuturesMarketDataClient({
    fetchImpl: createFetchImpl([]),
    WebSocketImpl: FakeWebSocket,
  })

  const snapshot = await client.getBitunixFuturesMarkets()
  const [socket] = FakeWebSocket.instances

  assert.equal(snapshot.markets[0].change24h, "-0.7097029863", "The native exchange percentage must be passed through without rounding or calculation.")
  assert.equal(snapshot.markets[0].change5m, null, "A 5-minute movement must remain unavailable when the API does not provide it.")
  assert.equal(snapshot.markets[0].change1h, null, "A 1-hour movement must remain unavailable when the API does not provide it.")
  assert.equal(snapshot.markets[0].change4h, null, "A 4-hour movement must remain unavailable when the API does not provide it.")
  assert.equal(socket.url, "wss://fapi.bitunix.com/public/", "The client must use Bitunix's public Futures WebSocket endpoint.")
  assert.deepEqual(socket.subscription, {
    op: "subscribe",
    args: [{
      symbol: "BTCUSDT",
      ch: "tickers",
    }],
  }, "The client must subscribe only to the public ticker channel for listed symbols.")
  assert.equal(socket.closed, true, "The one-shot ticker snapshot connection must be closed after receiving the data.")
})

test("rejects malformed Bitunix REST envelopes instead of returning an empty market list", async () => {
  const client = createBitunixFuturesMarketDataClient({
    fetchImpl: async () => createResponse({
      code: 0,
      data: null,
    }),
    WebSocketImpl: null,
  })

  await assert.rejects(
    () => client.getBitunixFuturesMarkets(),
    /invalid trading-pairs response/,
    "A malformed contracts response must be surfaced as an upstream failure.",
  )
})

test("rejects non-HTTPS REST, non-WSS streaming origins, and invalid timeouts", () => {
  assert.throws(
    () => createBitunixFuturesMarketDataClient({
      baseUrl: "http://fapi.bitunix.com",
    }),
    /HTTPS/,
    "Public exchange REST market data must never use plaintext HTTP.",
  )
  assert.throws(
    () => createBitunixFuturesMarketDataClient({
      websocketUrl: "ws://fapi.bitunix.com/public/",
    }),
    /WSS/,
    "Public exchange ticker streams must use secure WebSockets.",
  )
  assert.throws(
    () => createBitunixFuturesMarketDataClient({
      timeoutMs: 0,
    }),
    /timeout/,
    "The upstream request timeout must be bounded and positive.",
  )
  assert.throws(
    () => createBitunixFuturesMarketDataClient({
      websocketTimeoutMs: 0,
    }),
    /WebSocket timeout/,
    "The public ticker snapshot timeout must be bounded and positive.",
  )
})
