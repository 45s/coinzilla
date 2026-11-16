import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

function createBroker({ responses = {} } = {}) {
  const calls = []
  const restClient = {
    async request(input = {}) {
      const { method, path, ...options } = input
      calls.push({
        method,
        path,
        options,
      })
      const key = path
      if (responses[key] instanceof Error) {
        throw responses[key]
      }
      return { data: responses[key] }
    },
  }
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => restClient,
    },
  })
  return { broker,
    calls }
}

test("Bitunix Spot broker loads canonical Spot markets", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { base: "BTC",
          quote: "USDT",
          isOpen: "1" },
        { base: "ETH",
          quote: "USDT",
          isOpen: "1" },
        { base: "OLD",
          quote: "USDT",
          isOpen: "0" },
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
        { coin: "USDT",
          balance: "12.3400",
          balanceLocked: "1.25" },
      ],
    },
  })

  const balances = await broker.getBalances()
  const snapshot = await broker.getAccountSnapshot()

  assert.equal(balances.ok, true)
  assert.equal(balances.data[0].free.amount, "12.34")
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
        { base: "BTC",
          quote: "USDT",
          isOpen: "1" },
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

  const result = await broker.getFills({ symbol: "BTCUSDT",
    orderId: "123" })

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

  const created = await broker.createOrder({ symbol: "BTCUSDT",
    side: "BUY" })
  const canonicalCreated = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "caller-order-1",
  })
  const cancelled = await broker.cancelOrder({ symbol: "BTCUSDT",
    orderId: "123" })
  const cancelledAll = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })

  assert.equal(created.ok, false)
  assert.equal(canonicalCreated.ok, false)
  assert.equal(cancelled.ok, false)
  assert.equal(cancelledAll.ok, false)
  assert.match(created.errors[0].message, /client order identity/i)
  assert.match(canonicalCreated.errors[0].message, /clientOrderId/i)
  assert.equal(cancelled.cancellationOutcome, "NOT_SENT")
  assert.equal(calls.length, 0)
})


test("Bitunix Spot broker exposes symbol metadata, price, order detail and history reads", async () => {
  const order = {
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
  }
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { base: "BTC",
          quote: "USDT",
          basePrecision: 8,
          isOpen: "1" },
      ],
      "/api/spot/v1/market/last_price": "10.25",
      "/api/spot/v1/order/detail": order,
      "/api/spot/v1/order/history/page": { data: [order],
        total: 1,
        pageNum: "1" },
    },
  })

  const metadata = await broker.getSymbolFilters({ symbol: "btcusdt" })
  const price = await broker.getPrice({ symbol: "btcusdt" })
  const detail = await broker.getOrder({ symbol: "BTCUSDT",
    orderId: "123" })
  const history = await broker.getOrderHistory({ symbol: "BTCUSDT",
    limit: 25 })

  assert.equal(metadata.data.basePrecision, 8)
  assert.equal(metadata.data.symbol, "BTCUSDT")
  assert.equal(price.data.symbol, "BTCUSDT")
  assert.equal(price.data.price, "10.25")
  assert.equal(detail.data.id, "123")
  assert.equal(history.data.length, 1)
  assert.equal(history.data[0].id, "123")
  assert.deepEqual(calls[3].options.body, { symbol: "BTCUSDT",
    page: 1,
    pageSize: 25 })
})

test("Bitunix Spot broker validates order history query boundaries", async () => {
  const { broker, calls } = createBroker()

  const missingSymbol = await broker.getOrderHistory()
  const exactOrderId = await broker.getOrderHistory({ symbol: "BTCUSDT",
    orderId: "123" })
  const invalidLimit = await broker.getOrderHistory({ symbol: "BTCUSDT",
    limit: 0 })
  const invalidRange = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    startTime: 20,
    endTime: 10,
  })

  assert.equal(missingSymbol.ok, false)
  assert.equal(exactOrderId.ok, false)
  assert.equal(invalidLimit.ok, false)
  assert.equal(invalidRange.ok, false)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot broker keeps lifecycle and unsupported read capabilities explicit", async () => {
  const { broker, calls } = createBroker()

  await broker.connect()
  assert.equal(broker.connected, true)
  await broker.disconnect()
  assert.equal(broker.connected, false)

  const unsupportedResults = await Promise.all([
    broker.getAssets(),
    broker.getMyTrades(),
    broker.getCanonicalOrder(),
    broker.getCanonicalOrderHistory(),
    broker.getServerTime(),
    broker.getCandles(),
  ])
  for (const result of unsupportedResults) {
    assert.equal(result.ok, false)
  }
  await assert.rejects(broker.subscribeForUserData(), /private Spot WebSocket/i)
  await assert.rejects(broker.subscribeForBookTicker(), /order-book subscription/i)
  await assert.rejects(broker.subscribeForPrices(), /continuous price subscription/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot broker rejects order detail identity mismatches", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/detail": {
        orderId: "different",
        symbol: "BTCUSDT",
        side: "2",
        type: "1",
        status: "2",
        volume: "1",
        dealVolume: "1",
        price: "10",
      },
    },
  })

  const result = await broker.getOrder({ symbol: "BTCUSDT",
    orderId: "123" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /identity/i)
})


test("Bitunix Spot broker normalizes a single pending-order response row", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": {
        orderId: "123",
        symbol: "BTCUSDT",
        side: "2",
        type: "1",
        status: "1",
        volume: "1",
        dealVolume: "0",
        price: "10",
      },
    },
  })

  const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].id, "123")
})

test("Bitunix Spot broker supports explicit history page selection", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": { data: [],
        total: 0,
        pageNum: "3" },
    },
  })

  const result = await broker.getOrderHistory({ symbol: "BTCUSDT",
    page: 3,
    limit: 20 })

  assert.equal(result.ok, true)
  assert.deepEqual(calls[0].options.body, { symbol: "BTCUSDT",
    page: 3,
    pageSize: 20 })
})


test("Bitunix Spot order history maps exchange-neutral filters to documented API codes", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": { data: [],
        total: 0,
        pageNum: "1" },
    },
  })

  const result = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    status: "PARTIALLY_FILLED",
    side: "BUY",
    type: "LIMIT",
  })

  assert.equal(result.ok, true, "valid canonical history filters must return a successful broker result")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    page: 1,
    status: "3",
    side: "2",
    type: "1",
  }, "history filters must be translated to Bitunix wire codes without leaking exchange codes to callers")
})

test("Bitunix Spot order history rejects unsupported canonical filters before sending a request", async () => {
  const { broker, calls } = createBroker()

  const unsupportedStatus = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    status: "UNKNOWN",
  })
  const unsupportedSide = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    side: "BID",
  })
  const unsupportedType = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    type: "STOP_LIMIT",
  })

  assert.equal(unsupportedStatus.ok, false, "unknown order statuses must not be sent as undocumented Bitunix filters")
  assert.equal(unsupportedSide.ok, false, "unknown order sides must not be sent as undocumented Bitunix filters")
  assert.equal(unsupportedType.ok, false, "unknown order types must not be sent as undocumented Bitunix filters")
  assert.equal(calls.length, 0, "invalid history filters must be rejected before any exchange request")
})


test("Bitunix Spot market catalog excludes pairs without an explicit open status", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { base: "BTC",
          quote: "USDT",
          isOpen: "1" },
        { base: "OLD",
          quote: "USDT",
          isOpen: "0" },
        { base: "UNKNOWN",
          quote: "USDT" },
        { base: "UNSURE",
          quote: "USDT",
          isOpen: "unknown" },
      ],
    },
  })

  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, true, "a catalog containing unknown market states should remain readable")
  assert.deepEqual(result.data.map(({ symbol }) => symbol), ["BTCUSDT"], "only explicitly open Bitunix markets may enter the active catalog")
})


test("Bitunix Spot order history rejects missing or inconsistent pagination metadata", async () => {
  const order = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "2",
    volume: "1",
    dealVolume: "1",
    price: "10",
  }
  const cases = [
    {
      name: "missing total",
      response: { pageNum: "1", data: [] },
    },
    {
      name: "string total",
      response: { total: "0", pageNum: "1", data: [] },
    },
    {
      name: "negative total",
      response: { total: -1, pageNum: "1", data: [] },
    },
    {
      name: "fractional total",
      response: { total: 0.5, pageNum: "1", data: [] },
    },
    {
      name: "missing page number",
      response: { total: 0, data: [] },
    },
    {
      name: "invalid page number",
      response: { total: 0, pageNum: "one", data: [] },
    },
    {
      name: "numeric page number conflicts with documented string type",
      response: { total: 0, pageNum: 1, data: [] },
    },
    {
      name: "wrong returned page",
      response: { total: 0, pageNum: "2", data: [] },
    },
    {
      name: "more rows than total",
      response: { total: 0, pageNum: "1", data: [order] },
    },
  ]
  const unexpectedSuccesses = []

  for (const entry of cases) {
    const { broker } = createBroker({
      responses: {
        "/api/spot/v1/order/history/page": entry.response,
      },
    })
    const result = await broker.getOrderHistory({
      symbol: "BTCUSDT",
      page: 1,
    })
    if (result.ok) {
      unexpectedSuccesses.push(entry.name)
    }
  }

  assert.deepEqual(
    unexpectedSuccesses,
    [],
    "history pages with missing, invalid, or inconsistent metadata must fail closed",
  )
})

test("Bitunix Spot order history accepts an omitted data array only for an empty result set", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": {
        total: 0,
        pageNum: "1",
      },
    },
  })

  const result = await broker.getOrderHistory({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "an omitted optional data array is valid when total is zero")
  assert.deepEqual(result.data, [], "an empty history page must normalize to an empty order array")
  assert.equal(calls.length, 1, "history validation must not trigger extra exchange requests")
})
