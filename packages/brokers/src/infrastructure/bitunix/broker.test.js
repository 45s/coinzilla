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

test("Bitunix Spot symbol-scoped order reads reject rows for a different symbol", async () => {
  const foreignOrder = {
    orderId: "foreign-order",
    symbol: "ETHUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "0.5",
    dealVolume: "0",
    price: "10",
  }
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": [foreignOrder],
      "/api/spot/v1/order/history/page": {
        total: 1,
        pageNum: "1",
        data: [foreignOrder],
      },
    },
  })

  const pending = await broker.getOpenOrders({ symbol: "BTCUSDT" })
  const history = await broker.getOrderHistory({ symbol: "BTCUSDT" })

  assert.equal(pending.ok, false, "pending-order rows must match the requested symbol")
  assert.equal(history.ok, false, "order-history rows must match the requested symbol")
  assert.match(pending.errors[0].message, /symbol.*does not match/i)
  assert.match(history.errors[0].message, /symbol.*does not match/i)
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

test("Bitunix Spot fill lookup stays unsupported until execution semantics are proven", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.getFills({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false, "unproven matching-order semantics cannot be exposed as canonical fills")
  assert.match(result.errors[0].message, /not supported safely.*quantity denomination.*execution completeness/i)
  assert.equal(calls.length, 0, "unsupported fill lookup must not issue partial or misleading reads")
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
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:01Z",
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


async function assertOrderHistoryPageRejected({ response, requestedPage = 1, message }) {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": response,
    },
  })
  const result = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    page: requestedPage,
  })

  assert.equal(result.ok, false, message)
}

test("Bitunix Spot order history rejects missing or invalid total metadata", async () => {
  const cases = [
    {
      name: "missing total",
      response: {
        pageNum: "1",
        data: [],
      },
    },
    {
      name: "string total",
      response: {
        total: "0",
        pageNum: "1",
        data: [],
      },
    },
    {
      name: "negative total",
      response: {
        total: -1,
        pageNum: "1",
        data: [],
      },
    },
    {
      name: "fractional total",
      response: {
        total: 0.5,
        pageNum: "1",
        data: [],
      },
    },
  ]

  for (const entry of cases) {
    await assertOrderHistoryPageRejected({
      response: entry.response,
      message: `history page with ${entry.name} must fail closed`,
    })
  }
})

test("Bitunix Spot order history rejects missing or invalid page numbers", async () => {
  const cases = [
    {
      name: "missing page number",
      response: {
        total: 0,
        data: [],
      },
    },
    {
      name: "invalid page number",
      response: {
        total: 0,
        pageNum: "one",
        data: [],
      },
    },
    {
      name: "zero page number",
      response: {
        total: 0,
        pageNum: "0",
        data: [],
      },
    },
  ]

  for (const entry of cases) {
    await assertOrderHistoryPageRejected({
      response: entry.response,
      message: `history page with ${entry.name} must fail closed`,
    })
  }
})

test("Bitunix Spot order history rejects a response for a different page", async () => {
  await assertOrderHistoryPageRejected({
    response: {
      total: 0,
      pageNum: "2",
      data: [],
    },
    requestedPage: 1,
    message: "returned pageNum must match the requested page",
  })
})

test("Bitunix Spot order history rejects more rows than the reported total", async () => {
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

  await assertOrderHistoryPageRejected({
    response: {
      total: 0,
      pageNum: "1",
      data: [order],
    },
    message: "page row count cannot exceed the reported total",
  })
})

test("Bitunix Spot order history rejects omitted data when total is positive", async () => {
  await assertOrderHistoryPageRejected({
    response: {
      total: 1,
      pageNum: "1",
    },
    message: "an omitted data array with a positive total must fail closed",
  })
})

test("Bitunix Spot order history accepts a numeric page number", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": {
        total: 0,
        pageNum: 1,
        data: [],
      },
    },
  })

  const result = await broker.getOrderHistory({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "the official Spot WebSocket example uses a numeric pageNum")
  assert.deepEqual(result.data, [], "a numeric pageNum must preserve the one-page order array contract")
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


test("Bitunix Spot symbol metadata rejects ambiguous duplicate catalog entries", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        {
          base: "BTC",
          quote: "USDT",
          isOpen: "1",
          minVolume: "0.001",
        },
        {
          base: "BTC",
          quote: "USDT",
          isOpen: "1",
          minVolume: "0.01",
        },
      ],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, false, "ambiguous market metadata must not silently select one row")
  assert.match(result.errors[0].message, /duplicate.*BTCUSDT|ambiguous.*BTCUSDT/i)
})


test("Bitunix Spot broker exposes legacy Coin assets from free and locked account balances", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/user/account": [
        {
          coin: "BTC",
          balance: "0.2",
          balanceLocked: "0.05",
        },
        {
          coin: "USDT",
          balance: "12.5",
          balanceLocked: "0",
        },
        {
          coin: "ZERO",
          balance: "0",
          balanceLocked: "0",
        },
      ],
    },
  })

  const result = await broker.getAssets()

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [
    {
      ticker: "BTC",
      quantity: 0.25,
    },
    {
      ticker: "USDT",
      quantity: 12.5,
    },
  ])
  assert.deepEqual(calls, [
    {
      method: "GET",
      path: "/api/spot/v1/user/account",
      options: {},
    },
  ])
})

test("Bitunix Spot last price rejects non-positive values and preserves positive decimal strings", async () => {
  for (const invalidPrice of ["0", "-0.01"]) {
    const { broker, calls } = createBroker({
      responses: {
        "/api/spot/v1/market/last_price": invalidPrice,
      },
    })

    const result = await broker.getPrice({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, `last price ${invalidPrice} must be rejected`)
    assert.equal(calls.length, 1)
  }

  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/market/last_price": "0.0000000100",
    },
  })
  const result = await broker.getPrice({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.equal(result.data.price, "0.0000000100")
})

test("Bitunix Spot pending orders reject missing or null response data", async () => {
  const cases = [
    {
      name: "missing data",
      responses: {},
    },
    {
      name: "null data",
      responses: {
        "/api/spot/v1/order/pending/list": null,
      },
    },
  ]

  for (const entry of cases) {
    const { broker, calls } = createBroker({
      responses: entry.responses,
    })
    const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, `pending orders with ${entry.name} must fail closed`)
    assert.match(result.errors[0].message, /pending orders response/i)
    assert.equal(calls.length, 1)
  }
})


test("Bitunix Spot order detail rejects unsafe numeric order IDs before making a request", async () => {
  const { broker, calls } = createBroker()
  const unsafeNumericOrderId = Number.MAX_SAFE_INTEGER + 1

  const result = await broker.getOrder({
    symbol: "BTCUSDT",
    orderId: unsafeNumericOrderId,
  })

  assert.equal(result.ok, false, "An unsafe numeric order ID must not be treated as a reliable broker identity.")
  assert.match(result.errors[0].message, /safe integer/i, "The failure must explain that numeric order IDs require safe integer precision.")
  assert.equal(calls.length, 0, "Invalid numeric order IDs must be rejected before any REST request is sent.")
})


test("Bitunix Spot order history rejects unsafe numeric page and page-size inputs before sending a request", async () => {
  const { broker, calls } = createBroker()
  const unsafeInteger = Number.MAX_SAFE_INTEGER + 1

  const unsafePage = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    page: unsafeInteger,
  })
  const unsafePageSize = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    limit: unsafeInteger,
  })

  assert.equal(unsafePage.ok, false, "an unsafe page number must not be sent with a potentially rounded numeric identity")
  assert.equal(unsafePageSize.ok, false, "an unsafe page size must not be sent with a potentially rounded numeric value")
  assert.match(unsafePage.errors[0].message, /safe integer/i, "the page validation error must identify the safe-integer boundary")
  assert.match(unsafePageSize.errors[0].message, /safe integer/i, "the page-size validation error must identify the safe-integer boundary")
  assert.equal(calls.length, 0, "unsafe history pagination values must be rejected before any exchange request")
})

test("Bitunix Spot order history accepts the largest safely representable page and page-size values", async () => {
  const maximumSafeInteger = Number.MAX_SAFE_INTEGER
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": {
        total: 0,
        pageNum: String(maximumSafeInteger),
        data: [],
      },
    },
  })

  const result = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    page: maximumSafeInteger,
    limit: maximumSafeInteger,
  })

  assert.equal(result.ok, true, "the maximum safe integer remains exactly representable and valid as a numeric request value")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    page: maximumSafeInteger,
    pageSize: maximumSafeInteger,
  }, "safe pagination values must be preserved exactly in the Bitunix request")
})

const EXCHANGE_RATE_PATH = "/api/spot/v1/common/rate/list"

const INVALID_EXCHANGE_RATE_RESPONSES = [
  undefined,
  null,
  {},
  [null],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: 1.5,
    },
  ],
  [
    {
      baseSymbol: "",
      quoteSymbol: "AUD",
      rate: "1.5",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: " ",
      rate: "1.5",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "0",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "-1",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "not-a-rate",
    },
  ],
]

test("Bitunix Spot exchange rates preserve exact decimal strings and immutable records", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [EXCHANGE_RATE_PATH]: [
        {
          baseSymbol: "USDT",
          quoteSymbol: "AUD",
          rate: "1.4452976228500000",
        },
      ],
    },
  })

  const result = await broker.getExchangeRates()

  assert.equal(result.ok, true, "a valid exchange-rate catalog must return a successful result")
  assert.deepEqual(result.data, [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "1.4452976228500000",
    },
  ], "the adapter must preserve the exact rate string without Number conversion")
  assert.equal(Object.isFrozen(result.data), true, "the returned exchange-rate array must be immutable")
  assert.equal(Object.isFrozen(result.data[0]), true, "each returned exchange-rate record must be immutable")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: EXCHANGE_RATE_PATH,
    options: {
      authenticated: false,
    },
  }, "the broker must issue the documented public GET without parameters or authentication")
})

test("Bitunix Spot exchange rates accept an explicitly empty catalog", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [EXCHANGE_RATE_PATH]: [],
    },
  })

  const result = await broker.getExchangeRates()

  assert.equal(result.ok, true, "an explicit empty rate catalog is a valid exchange response")
  assert.deepEqual(result.data, [], "an empty rate catalog must remain an empty array")
  assert.equal(calls.length, 1, "reading the exchange-rate catalog must make exactly one request")
})

test("Bitunix Spot exchange rates reject missing data and malformed or non-positive records", async () => {
  for (const response of INVALID_EXCHANGE_RATE_RESPONSES) {
    const { broker } = createBroker({
      responses: {
        [EXCHANGE_RATE_PATH]: response,
      },
    })
    const result = await broker.getExchangeRates()

    assert.equal(
      result.ok,
      false,
      `invalid exchange-rate response must fail closed: ${JSON.stringify(response)}`,
    )
    assert.ok(result.errors.length > 0, "a malformed exchange-rate response must include a useful error")
  }
})

test("Bitunix Spot exchange rates preserve REST failures instead of returning an empty catalog", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [EXCHANGE_RATE_PATH]: new Error("exchange unavailable"),
    },
  })

  const result = await broker.getExchangeRates()

  assert.equal(result.ok, false, "a failed exchange-rate request must not appear successful")
  assert.match(result.errors[0].message, /exchange unavailable/, "the REST failure must remain visible to the caller")
  assert.equal(calls.length, 1, "a failed exchange-rate request must not trigger retries")
})
