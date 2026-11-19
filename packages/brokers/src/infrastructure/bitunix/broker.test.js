import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"
import { BrokerUnsupportedOperationError } from "../../broker/errors/broker-unsupported-operation-error.js"

function createBroker({ responses = {}, allowLiveOrderMutations = true, allowLiveFundsMutations = false } = {}) {
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
    allowLiveOrderMutations,
    allowLiveFundsMutations,
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

test("Bitunix Spot live order mutations stay disabled by default and send no requests", async () => {
  const { broker, calls } = createBroker({
    allowLiveOrderMutations: false,
  })

  const created = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })
  const cancelled = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })
  const cancelledAll = await broker.cancelAllOpenOrders({
    symbol: "BTCUSDT",
  })

  for (const result of [created, cancelled, cancelledAll]) {
    assert.equal(result.ok, false)
    assert.equal(result.mutationOutcome, "NOT_SENT")
    assert.match(result.errors[0].message, /disabled by default/i)
  }
  assert.equal(cancelled.cancellationOutcome, "NOT_SENT")
  assert.equal(cancelledAll.cancellationOutcome, "NOT_SENT")
  assert.equal(broker.capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "UNSUPPORTED")
  assert.equal(broker.capabilities.getStatus({ type: "CANCEL_ORDER" }), "UNSUPPORTED")
  assert.equal(calls.length, 0)
})

test("Bitunix Spot LIMIT placement converts base quantity to quote volume on single-order REST", async () => {
  const detail = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "1",
    dealVolume: "0",
    price: "100",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:00:00Z",
  }
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "123",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "100",
        price: "100",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": detail,
    },
  })

  const result = await broker.createOrder({
    symbol: "btcusdt",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.id, "123")
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    side: 2,
    type: 1,
    volume: "100",
    price: "100",
  })
  assert.equal(calls[0].path, "/api/spot/v1/order/place_order")
  assert.equal(calls[0].options.stateChanging, true)
  assert.deepEqual(calls[1].options.queryParams, { orderId: "123" })
})

test("Bitunix Spot MARKET placement submits base quantity and zero price on single-order REST", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "124",
        symbol: "BTCUSDT",
        side: 1,
        type: 2,
        volume: "0.01",
        price: "0",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": {
        orderId: "124",
        symbol: "BTCUSDT",
        side: "1",
        type: "2",
        status: "2",
        volume: "0.01",
        dealVolume: "0.01",
        price: "100",
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:01Z",
        avgPrice: "100",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "0.01",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "FILLED")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    side: 1,
    type: 2,
    volume: "0.01",
    price: "0",
  })
})

test("Bitunix Spot numeric scientific-notation quantities are expanded before exact REST serialization", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "126",
        symbol: "BTCUSDT",
        side: 2,
        type: 2,
        volume: "0.00000001",
        price: "0",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": {
        orderId: "126",
        symbol: "BTCUSDT",
        side: "2",
        type: "2",
        status: "1",
        volume: "0.00000001",
        dealVolume: "0",
        price: "100",
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:00Z",
        avgPrice: "100",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: 1e-8,
  })

  assert.equal(result.ok, true)
  assert.equal(calls[0].options.body.volume, "0.00000001")
})

test("Bitunix Spot placement reports exchange rejection as REJECTED", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "127",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "100",
        price: "100",
        placeStatus: "0",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.match(result.errors[0].message, /rejected the order placement/i)
})

test("Bitunix Spot placement rejects unsupported identity and order fields before dispatch", async () => {
  const { broker, calls } = createBroker()

  const withClientId = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "1",
    price: "100",
    clientOrderId: "caller-order-1",
  })
  const unsupportedType = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "STOP_LIMIT",
    quantity: "1",
    price: "100",
  })
  const missingType = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "1",
    price: "100",
  })

  assert.equal(withClientId.ok, false)
  assert.equal(withClientId.mutationOutcome, "NOT_SENT")
  assert.match(withClientId.errors[0].message, /does not accept a caller-supplied client order ID/i)
  assert.equal(unsupportedType.ok, false)
  assert.equal(unsupportedType.mutationOutcome, "NOT_SENT")
  assert.equal(missingType.ok, false)
  assert.equal(missingType.mutationOutcome, "NOT_SENT")
  assert.match(missingType.errors[0].message, /supports only LIMIT and MARKET orders/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot placement reports unknown after a dispatched transport failure and never retries", async () => {
  const { broker } = createBroker()
  broker.restClient.request = async () => {
    throw Object.assign(new Error("placement response timeout"), {
      outcomeUnknown: true,
    })
  }

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: "0.001",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /placement response timeout/i)
})

test("Bitunix Spot placement reports confirmed acceptance if order-detail reconciliation fails", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "125",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "100",
        price: "100",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": new Error("order detail unavailable"),
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.data.orderId, "125")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.match(result.errors[0].message, /order detail unavailable/i)
})

test("Bitunix Spot canonical placement remains unsupported because client order identity is absent", async () => {
  const { broker, calls } = createBroker()
  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "caller-order-1",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.match(result.errors[0].message, /clientOrderId/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot cancels a known order and verifies its terminal exchange status", async () => {
  const cancelledOrder = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "4",
    volume: "1",
    dealVolume: "0.25",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:01:00Z",
  }
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": cancelledOrder,
    },
  })

  const result = await broker.cancelOrder({
    symbol: "btcusdt",
    orderId: "123",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "CANCELED")
  assert.equal(result.data.executedQuantity, "0.25")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/spot/v1/order/cancel",
    options: {
      body: {
        orderIdList: [{
          orderId: "123",
          symbol: "BTCUSDT",
        }],
      },
      authenticated: true,
      stateChanging: true,
    },
  })
  assert.equal(calls[1].method, "GET")
  assert.equal(calls[1].path, "/api/spot/v1/order/detail")
  assert.deepEqual(calls[1].options.queryParams, { orderId: "123" })
})

test("Bitunix Spot cancellation reports unknown when the order remains open after acknowledgement", async () => {
  const openOrder = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "1",
    dealVolume: "0",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:01:00Z",
  }
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": openOrder,
    },
  })

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /reconcile order 123/i)
})

test("Bitunix Spot cancellation reports an exchange rejection after dispatch without claiming NOT_SENT", async () => {
  const { broker, calls } = createBroker()
  broker.restClient.request = async (input) => {
    calls.push({
      method: input.method,
      path: input.path,
      options: {
        ...(input.body === undefined ? {} : { body: input.body }),
        authenticated: input.authenticated,
        stateChanging: input.stateChanging,
      },
    })
    if (input.path === "/api/spot/v1/order/cancel") {
      throw Object.assign(new Error("exchange rejected cancellation"), {
        kind: "exchange",
      })
    }
    throw new Error("unexpected request")
  }

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(calls.length, 1)
})

test("Bitunix Spot cancellation preserves acknowledged mutation when detail verification fails", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": new Error("detail endpoint unavailable"),
    },
  })

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /detail endpoint unavailable/i)
})

test("Bitunix Spot cancellation validates identity before sending a mutation", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.cancelOrder({ symbol: "BTCUSDT" })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(calls.length, 0)
})

test("Bitunix Spot cancelAllOpenOrders cancels and verifies every open order for one symbol", async () => {
  const order = (orderId) => ({
    orderId,
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "1",
    dealVolume: "0",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:00:01Z",
  })
  const cancelled = (orderId) => ({
    ...order(orderId),
    status: "4",
    utime: "2026-11-15T12:01:00Z",
  })
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": [order("101"), order("102")],
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": cancelled("102"),
    },
  })
  let detailReads = 0
  const originalRequest = broker.restClient.request.bind(broker.restClient)
  broker.restClient.request = async (input) => {
    if (input.path === "/api/spot/v1/order/detail") {
      detailReads += 1
      return { data: cancelled(detailReads === 1 ? "101" : "102") }
    }
    return originalRequest(input)
  }

  const result = await broker.cancelAllOpenOrders({ symbol: "btcusdt" })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 2)
  assert.deepEqual(result.data.map((item) => item.status), ["CANCELED", "CANCELED"])
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(calls.filter((call) => call.path === "/api/spot/v1/order/cancel").length, 2)
})

test("Bitunix Spot cancelAllOpenOrders requires a symbol and sends no request", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
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
  const unsupportedSubscriptions = await Promise.all([
    broker.subscribeForUserData(),
    broker.subscribeForBookTicker(),
    broker.subscribeForCandles(),
    broker.subscribeForPrices(),
  ])
  for (const result of unsupportedSubscriptions) {
    assert.equal(result.ok, false)
    assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
    assert.equal(result.errors[0].code, "BROKER_OPERATION_UNSUPPORTED")
    assert.equal(result.errors[0].retryable, false)
  }
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


function createSymbolMetadata({ overrides = {} } = {}) {
  return {
    base: "BTC",
    quote: "USDT",
    isOpen: "1",
    minPrice: "0.01",
    minVolume: "0.001",
    basePrecision: "8",
    quotePrecision: "2",
    precisions: ["0.01", "0.001"],
    ...overrides,
  }
}

test("Bitunix Spot market catalog reads use unsigned public GET requests", async () => {
  const symbolMetadata = createSymbolMetadata()
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [symbolMetadata],
    },
  })

  const markets = await broker.getExchangeMarkets()
  const filters = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(markets.ok, true, "the public market catalog must remain readable without private signing")
  assert.equal(filters.ok, true, "symbol metadata must remain readable without private signing")
  assert.equal(calls.length, 2, "each catalog operation must issue exactly one request")
  for (const call of calls) {
    assert.equal(call.method, "GET", "the public coin-pair catalog must use GET")
    assert.deepEqual(call.options, {
      authenticated: false,
    }, "the public coin-pair catalog must not request private authentication or signing")
  }
})

test("Bitunix Spot symbol metadata selects the matching pair and preserves exact exchange fields", async () => {
  const expectedMetadata = createSymbolMetadata({
    overrides: {
      symbol: "btcusdt",
      minPrice: "0",
      minVolume: "0",
      basePrecision: 0,
      quotePrecision: "0",
      precisions: ["0.01", "0.001"],
      maxAmount: "500000",
      maxLimitOrderAmount: "1500000",
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        createSymbolMetadata({
          overrides: {
            base: "ETH",
          },
        }),
        expectedMetadata,
      ],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "btcusdt" })

  assert.equal(result.ok, true, "a unique valid matching pair must be returned")
  assert.deepEqual(result.data, {
    ...expectedMetadata,
    symbol: "BTCUSDT",
  }, "the matching raw row must retain exact values while exposing the normalized requested symbol")
  assert.equal(Object.hasOwn(result.data, "tickSize"), false, "precision metadata must not be invented as a tick size")
  assert.equal(Object.hasOwn(result.data, "stepSize"), false, "precision metadata must not be invented as a quantity step")
  assert.equal(Object.hasOwn(result.data, "maxQuantity"), false, "reference-only maximum amount fields must not become canonical maximum quantity")
  assert.equal(result.data.minPrice, "0", "an explicitly documented zero minimum trading value must remain zero")
  assert.equal(result.data.minVolume, "0", "an explicitly documented zero minimum trading quantity must remain zero")
})

test("Bitunix Spot symbol metadata leaves omitted optional trading rules unknown", async () => {
  const symbolMetadata = createSymbolMetadata({
    overrides: {
      minPrice: undefined,
      minVolume: undefined,
      basePrecision: undefined,
      quotePrecision: undefined,
      precisions: undefined,
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [symbolMetadata],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "optional Bitunix metadata may be absent without fabricating trading rules")
  assert.equal(result.data.minPrice, undefined, "an omitted minimum trading value must remain unknown rather than becoming zero")
  assert.equal(result.data.minVolume, undefined, "an omitted minimum trading quantity must remain unknown rather than becoming zero")
  assert.equal(result.data.basePrecision, undefined, "an omitted base precision must remain absent")
  assert.equal(result.data.quotePrecision, undefined, "an omitted quote precision must remain absent")
})

test("Bitunix Spot symbol metadata preserves explicit null optional fields as unknown", async () => {
  const symbolMetadata = createSymbolMetadata({
    overrides: {
      minPrice: null,
      minVolume: null,
      basePrecision: null,
      quotePrecision: null,
      precisions: null,
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [symbolMetadata],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "explicit null optional metadata must remain unknown rather than being coerced")
  assert.equal(result.data.minPrice, null, "a null minimum trading value must remain null")
  assert.equal(result.data.minVolume, null, "a null minimum quantity must remain null")
  assert.equal(result.data.basePrecision, null, "a null base precision must remain null")
  assert.equal(result.data.quotePrecision, null, "a null quote precision must remain null")
  assert.equal(result.data.precisions, null, "a null precision list must remain null")
})

test("Bitunix Spot symbol metadata preserves a closed pair without advertising it as an active market", async () => {
  const closedMetadata = createSymbolMetadata({
    overrides: {
      isOpen: "0",
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [closedMetadata],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
  const markets = await broker.getExchangeMarkets()

  assert.equal(result.ok, true, "read-only metadata lookup must preserve a known closed pair")
  assert.equal(result.data.isOpen, "0", "the source closed-market status must remain unchanged")
  assert.deepEqual(markets.data, [], "closed pairs must remain excluded from the active market catalog")
})


const invalidSymbolMetadataCases = [
  {
    field: "minPrice",
    value: "NaN",
    name: "non-finite minimum trading values",
  },
  {
    field: "minPrice",
    value: "-0.01",
    name: "negative minimum trading values",
  },
  {
    field: "minPrice",
    value: 0.01,
    name: "numeric minimum trading values that could lose decimal precision",
  },
  {
    field: "minVolume",
    value: "Infinity",
    name: "non-finite minimum quantities",
  },
  {
    field: "minVolume",
    value: "-0.001",
    name: "negative minimum quantities",
  },
  {
    field: "basePrecision",
    value: "-1",
    name: "negative base precision counts",
  },
  {
    field: "basePrecision",
    value: "1.5",
    name: "fractional base precision counts",
  },
  {
    field: "basePrecision",
    value: Infinity,
    name: "non-finite base precision numbers",
  },
  {
    field: "quotePrecision",
    value: 9007199254740992,
    name: "unsafe quote precision integers",
  },
  {
    field: "precisions",
    value: "0.01",
    name: "non-array trading precision metadata",
  },
  {
    field: "precisions",
    value: ["0.01", "NaN"],
    name: "malformed trading precision entries",
  },
  {
    field: "precisions",
    value: ["0.01", 0.001],
    name: "non-string trading precision entries",
  },
  {
    field: "precisions",
    value: ["-0.001"],
    name: "negative trading precision entries",
  },
  {
    field: "symbol",
    value: 42,
    name: "non-string compatibility symbols",
  },
  {
    field: "symbol",
    value: "ETHUSDT",
    name: "symbols that conflict with base and quote identity",
  },
  {
    field: "base",
    value: undefined,
    name: "missing base asset codes",
  },
  {
    field: "quote",
    value: undefined,
    name: "missing quote asset codes",
  },
]

for (const scenario of invalidSymbolMetadataCases) {
  test(`Bitunix Spot symbol metadata rejects ${scenario.name}`, async () => {
    const { broker } = createBroker({
      responses: {
        "/api/spot/v1/common/coin_pair/list": [
          createSymbolMetadata({
            overrides: {
              [scenario.field]: scenario.value,
            },
          }),
        ],
      },
    })
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, `${scenario.name} must fail closed before metadata is returned`)
    assert.ok(result.errors?.[0] instanceof Error, `Invalid ${scenario.field} metadata must return a diagnostic error`)
  })
}

test("Bitunix Spot symbol metadata rejects missing symbols, missing catalog rows and malformed response arrays", async () => {
  const missingSymbol = createBroker()
  const invalidInput = await missingSymbol.broker.getSymbolFilters({ symbol: " " })

  assert.equal(invalidInput.ok, false, "an empty requested symbol must be rejected before exchange I/O")
  assert.equal(missingSymbol.calls.length, 0, "invalid symbol input must not trigger a catalog request")

  const missingRow = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        createSymbolMetadata({
          overrides: {
            base: "ETH",
          },
        }),
      ],
    },
  })
  const notFound = await missingRow.broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(notFound.ok, false, "a catalog without the requested pair must fail closed")

  const malformedEnvelope = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": null,
    },
  })
  const malformed = await malformedEnvelope.broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(malformed.ok, false, "missing or null catalog data must not be treated as an empty successful response")
})

test("Bitunix Spot symbol metadata propagates catalog transport failures without retrying", async () => {
  const transportFailure = new Error("socket closed")
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": transportFailure,
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, false, "a catalog transport failure must never become successful metadata")
  assert.equal(result.errors[0], transportFailure, "the original transport failure must remain available to the caller")
  assert.equal(calls.length, 1, "a failed metadata read must not retry implicitly")
})


test("Bitunix Spot broker exposes immutable canonical capabilities", () => {
  const { broker } = createBroker()

  assert.equal(broker.capabilities.provider, "bitunix")
  assert.equal(broker.capabilities.product, "spot")
  assert.equal(broker.capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  assert.equal(broker.capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "SUPPORTED")
  assert.equal(Object.isFrozen(broker.capabilities), true)
})

test("Bitunix Spot broker reports unsupported client-order-ID lookup explicitly", async () => {
  const { broker, calls } = createBroker()
  const result = await broker.getOrder({
    symbol: "BTCUSDT",
    clientOrderId: "client-123",
  })

  assert.equal(result.ok, false)
  assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
  assert.equal(result.errors[0].context.operation, "getOrder")
  assert.equal(calls.length, 0)
})

test("Bitunix canonical order placement remains unsupported because client order identity is absent", async () => {
  const { broker, calls } = createBroker()
  const result = await broker.createCanonicalOrder()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
  assert.equal(calls.length, 0)
})
const TOKEN_NETWORK_PATH = "/api/spot/v1/common/coin/coin_network/list"
const USER_INFO_PATH = "/api/spot/v1/user/info"

test("Bitunix Spot token-network metadata uses one unsigned public REST request and preserves exact source fields", async () => {
  const tokenMetadata = [{
    name: "USDT",
    fullName: "Tether",
    quotePrecision: "6",
    withdrawOpen: 1,
    withdrawMin: "0.000001",
    withdrawMax: null,
    networks: [{
      contractPrecision: 6,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      requireMemo: 0,
      chain: "TRON",
      network: "Tron (TRC-20)",
      isOpen: 1,
      depositOpen: 1,
      withdrawOpen: 1,
      withdrawMin: "0.000001",
      withdrawMax: "3000000",
      depositMin: "0.000001",
    }],
  }]
  const { broker, calls } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: tokenMetadata,
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, true, "a valid token-network catalog must return a successful result")
  assert.deepEqual(result.data, tokenMetadata, "the adapter must preserve source fields and exact decimal strings without coercion")
  assert.equal(Object.isFrozen(result.data), true, "the token-network catalog must be immutable")
  assert.equal(Object.isFrozen(result.data[0]), true, "each token metadata record must be immutable")
  assert.equal(Object.isFrozen(result.data[0].networks), true, "each token's network collection must be immutable")
  assert.equal(Object.isFrozen(result.data[0].networks[0]), true, "each network metadata record must be immutable")
  assert.deepEqual(calls, [{
    method: "GET",
    path: TOKEN_NETWORK_PATH,
    options: {
      authenticated: false,
    },
  }], "token-network metadata must use one unsigned public GET request")
})

test("Bitunix Spot token-network metadata accepts an explicit empty catalog", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: [],
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, true, "an explicitly empty token-network catalog is a valid exchange response")
  assert.deepEqual(result.data, [], "an empty token-network catalog must remain empty")
  assert.equal(calls.length, 1, "an empty catalog read must make exactly one REST request")
})

test("Bitunix Spot token-network metadata preserves omitted and null optional values", async () => {
  const tokenMetadata = [{
    name: "USDT",
    networks: [{
      network: "Tron (TRC-20)",
      withdrawMax: null,
    }],
  }]
  const { broker } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: tokenMetadata,
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, true, "documented optional token and network metadata may be absent or null")
  assert.equal(Object.hasOwn(result.data[0], "fullName"), false, "omitted token metadata must not be synthesized")
  assert.equal(result.data[0].networks[0].withdrawMax, null, "an explicit null withdrawal maximum must remain null")
  assert.equal(Object.hasOwn(result.data[0].networks[0], "depositMin"), false, "omitted network deposit minimum must remain unknown")
})

test("Bitunix Spot token-network metadata rejects malformed catalog rows and decimal constraints", async () => {
  const invalidResponses = [
    null,
    {},
    [null],
    [{ name: " " }],
    [{
      name: "USDT",
      networks: {},
    }],
    [{
      name: "USDT",
      withdrawMin: 0.000001,
    }],
    [{
      name: "USDT",
      withdrawMax: "NaN",
    }],
    [{
      name: "USDT",
      networks: [null],
    }],
    [{
      name: "USDT",
      networks: [{
        network: "TRC-20",
        depositMin: "-0.1",
      }],
    }],
  ]

  for (const invalidResponse of invalidResponses) {
    const { broker } = createBroker({
      responses: {
        [TOKEN_NETWORK_PATH]: invalidResponse,
      },
    })
    const result = await broker.getTokenNetworks()

    assert.equal(
      result.ok,
      false,
      `malformed token-network metadata must fail closed: ${JSON.stringify(invalidResponse)}`,
    )
    assert.ok(result.errors?.[0] instanceof Error, "invalid token-network metadata must include a diagnostic error")
  }
})

test("Bitunix Spot token-network metadata propagates REST failures without retrying", async () => {
  const transportFailure = new Error("token-network endpoint unavailable")
  const { broker, calls } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: transportFailure,
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, false, "a failed token-network request must never appear as a successful empty catalog")
  assert.equal(result.errors[0], transportFailure, "the original token-network transport error must remain available")
  assert.equal(calls.length, 1, "a failed token-network read must not be retried implicitly")
})


test("Bitunix Spot broker reads authenticated user information and preserves UID identity", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [USER_INFO_PATH]: {
        uid: "9223372036854775807",
      },
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, true, "a valid user-info response must return a successful result")
  assert.deepEqual(result.data, {
    uid: "9223372036854775807",
  }, "an int64 UID must remain an exact string identifier")
  assert.equal(Object.isFrozen(result.data), true, "the user-info record must be immutable")
  assert.deepEqual(calls, [{
    method: "GET",
    path: USER_INFO_PATH,
    options: {
      authenticated: true,
    },
  }], "user information must use one signed private GET request")
})

test("Bitunix Spot broker preserves nullable and omitted optional user identity", async () => {
  const { broker: nullUidBroker } = createBroker({
    responses: {
      [USER_INFO_PATH]: {
        uid: null,
      },
    },
  })
  const nullUidResult = await nullUidBroker.getUserInfo()

  assert.equal(nullUidResult.ok, true, "a documented null UID must remain a successful user-info result")
  assert.deepEqual(nullUidResult.data, {
    uid: null,
  }, "an explicit null UID must remain null")

  const { broker: omittedUidBroker } = createBroker({
    responses: {
      [USER_INFO_PATH]: {},
    },
  })
  const omittedUidResult = await omittedUidBroker.getUserInfo()

  assert.equal(omittedUidResult.ok, true, "the documented optional UID may be omitted")
  assert.equal(Object.hasOwn(omittedUidResult.data, "uid"), false, "an omitted UID must not be synthesized")
})

test("Bitunix Spot broker rejects malformed user-info payloads and UID values", async () => {
  const invalidResponses = [
    [],
    "user",
    { uid: -1 },
    { uid: 1.5 },
    { uid: "not-a-uid" },
    { uid: true },
    { uid: "9223372036854775808" },
  ]

  for (const invalidResponse of invalidResponses) {
    const { broker } = createBroker({
      responses: {
        [USER_INFO_PATH]: invalidResponse,
      },
    })
    const result = await broker.getUserInfo()

    assert.equal(result.ok, false, `malformed user information must fail closed: ${JSON.stringify(invalidResponse)}`)
    assert.ok(result.errors?.[0] instanceof Error, "invalid user-info data must include a diagnostic error")
  }
})

test("Bitunix Spot broker normalizes safe numeric UIDs to exact identifier strings", async () => {
  const { broker } = createBroker({
    responses: {
      [USER_INFO_PATH]: {
        uid: 681979174,
      },
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, true, "a safe numeric UID from the official example must be accepted")
  assert.equal(result.data.uid, "681979174", "UIDs must have one stable string identifier representation")
})

test("Bitunix Spot broker preserves an absent optional user-info data object as null", async () => {
  const { broker } = createBroker({
    responses: {
      [USER_INFO_PATH]: null,
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, true, "the optional user-info data object may be null")
  assert.equal(result.data, null, "an absent user-info object must remain explicitly absent")
})

test("Bitunix Spot broker propagates user-info REST failures without retrying", async () => {
  const transportFailure = new Error("user-info endpoint unavailable")
  const { broker, calls } = createBroker({
    responses: {
      [USER_INFO_PATH]: transportFailure,
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, false, "a failed user-info request must not appear as a successful empty record")
  assert.equal(result.errors[0], transportFailure, "the original user-info transport error must remain available")
  assert.equal(calls.length, 1, "a failed user-info read must not be retried implicitly")
})


const TAX_FILING_PATH = "/api/spot/v1/tax/filing/page"
const TAX_FILING_RECORD = {
  date: "2024-01-01T00:00:00Z",
  labelEn: "Buy Order",
  account: "Spot",
  outgoingAsset: "USDT",
  outgoingAmount: "100.00000000",
  incomingAsset: "BTC",
  incomingAmount: "0.00100000",
  feeAsset: "USDT",
  feeAmount: "0.10000000",
  typeId: "BUY_ORDER",
  txId: "—",
  fromAddress: "—",
  toAddress: "—",
  network: "—",
  referenceId: "order-123",
  comment: "—",
}

function createTaxFilingPage({
  records = [TAX_FILING_RECORD],
  total = records.length,
  current = 1,
  size = 1000,
  pages = total === 0 ? 0 : 1,
} = {}) {
  return {
    records,
    total,
    current,
    size,
    pages,
  }
}

test("Bitunix Spot broker reads one authenticated tax-filing page and preserves exact records", async () => {
  const page = createTaxFilingPage()
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: page,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-31T23:59:59Z",
  })

  assert.equal(result.ok, true, "a valid tax-filing page must return a successful result")
  assert.deepEqual(result.data, page, "tax-filing records and pagination metadata must be preserved")
  assert.equal(Object.isFrozen(result.data), true, "the tax-filing page must be immutable")
  assert.equal(Object.isFrozen(result.data.records), true, "tax-filing records must be immutable")
  assert.equal(Object.isFrozen(result.data.records[0]), true, "each tax-filing record must be immutable")
  assert.deepEqual(calls, [{
    method: "POST",
    path: TAX_FILING_PATH,
    options: {
      body: {
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-31T23:59:59Z",
        page: 1,
        pageSize: 1000,
      },
      authenticated: true,
      stateChanging: false,
    },
  }], "tax-filing history must use one signed read-only POST with the documented defaults")
})

test("Bitunix Spot broker passes tax data type filters and explicit pagination unchanged", async () => {
  const page = createTaxFilingPage({
    current: 2,
    size: 50,
    total: 101,
    pages: 3,
    records: [{
      ...TAX_FILING_RECORD,
      typeId: "FUNDING_COST",
      outgoingAsset: "USDT",
      outgoingAmount: "0.012345678901234567",
    }],
  })
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: page,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-12-31T00:00:00Z",
    dataTypeCodes: ["BUY_ORDER", "FUNDING_COST"],
    page: 2,
    pageSize: 50,
  })

  assert.equal(result.ok, true, "a valid later tax-filing page must be returned")
  assert.equal(result.data.records[0].outgoingAmount, "0.012345678901234567", "financial amounts must remain exact strings")
  assert.deepEqual(calls[0].options.body, {
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-12-31T00:00:00Z",
    dataTypeCodes: ["BUY_ORDER", "FUNDING_COST"],
    page: 2,
    pageSize: 50,
  }, "tax type filters and pagination must be sent exactly as requested")
})

test("Bitunix Spot broker accepts UTC ISO-8601 timestamps with a zero offset", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: createTaxFilingPage(),
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00+00:00",
    endTime: "2024-01-02T00:00:00+00:00",
  })

  assert.equal(result.ok, true, "an explicit zero UTC offset is a valid UTC ISO-8601 timestamp")
  assert.equal(calls[0].options.body.startTime, "2024-01-01T00:00:00+00:00", "valid UTC offsets must be preserved exactly")
})

test("Bitunix Spot broker accepts an empty tax type filter as all transaction types", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: createTaxFilingPage(),
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
    dataTypeCodes: [],
  })

  assert.equal(result.ok, true, "an explicit empty dataTypeCodes list is documented as all transaction types")
  assert.deepEqual(calls[0].options.body.dataTypeCodes, [], "an explicit empty type list must not be rewritten")
})

function createInvalidTaxFilingQueries() {
  const valid = {
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  }
  return [
    ...createInvalidTaxFilingDateQueries({ valid }),
    ...createInvalidTaxFilingPaginationQueries({ valid }),
    ...createInvalidTaxFilingTypeQueries({ valid }),
  ]
}

function createInvalidTaxFilingDateQueries({ valid }) {
  return [
    null,
    {},
    { ...valid,
      startTime: "2024-01-01",
    },
    { ...valid,
      endTime: "2024-01-02T00:00:00+01:00",
    },
    { ...valid,
      startTime: "not-a-date",
    },
    { ...valid,
      startTime: "2024-02-30T00:00:00Z",
    },
    { ...valid,
      startTime: "2024-01-03T00:00:00Z",
    },
    {
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2025-01-02T00:00:00Z",
    },
  ]
}

function createInvalidTaxFilingPaginationQueries({ valid }) {
  return [
    { ...valid,
      page: 0,
    },
    { ...valid,
      page: 1.5,
    },
    { ...valid,
      pageSize: 0,
    },
    { ...valid,
      pageSize: 1001,
    },
  ]
}

function createInvalidTaxFilingTypeQueries({ valid }) {
  return [
    { ...valid,
      dataTypeCodes: "BUY_ORDER",
    },
    { ...valid,
      dataTypeCodes: [""],
    },
    { ...valid,
      dataTypeCodes: [null],
    },
    { ...valid,
      dataTypeCodes: null,
    },
  ]
}

test("Bitunix Spot broker rejects invalid tax-filing query ranges and pagination before I/O", async () => {
  for (const query of createInvalidTaxFilingQueries()) {
    const { broker, calls } = createBroker()
    const result = await broker.getTaxFilingHistory(query)

    assert.equal(result.ok, false, `invalid tax-filing query must fail: ${JSON.stringify(query)}`)
    assert.equal(calls.length, 0, "invalid tax-filing queries must be rejected before network I/O")
  }
})

function createInvalidTaxFilingPages() {
  return [
    null,
    [],
    {},
    {
      ...createTaxFilingPage(),
      records: {},
    },
    {
      ...createTaxFilingPage(),
      total: -1,
    },
    {
      ...createTaxFilingPage(),
      total: 0,
    },
    {
      ...createTaxFilingPage(),
      current: 2,
    },
    {
      ...createTaxFilingPage(),
      current: -1,
    },
    {
      ...createTaxFilingPage(),
      size: 1001,
    },
    {
      ...createTaxFilingPage(),
      size: 0,
    },
    {
      ...createTaxFilingPage(),
      pages: -1,
    },
    {
      ...createTaxFilingPage(),
      pages: 0,
    },
    {
      ...createTaxFilingPage(),
      records: [{
        ...TAX_FILING_RECORD,
        outgoingAmount: 1,
      }],
    },
    {
      ...createTaxFilingPage(),
      records: [null],
    },
  ]
}

test("Bitunix Spot broker rejects malformed tax-filing pagination and records", async () => {
  const validQuery = {
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  }
  for (const page of createInvalidTaxFilingPages()) {
    const { broker } = createBroker({
      responses: {
        [TAX_FILING_PATH]: page,
      },
    })
    const result = await broker.getTaxFilingHistory(validQuery)

    assert.equal(result.ok, false, "malformed tax-filing pages must fail closed without partial records")
    assert.ok(result.errors?.[0] instanceof Error, "invalid tax-filing pages must include a diagnostic error")
  }
})

test("Bitunix Spot broker accepts an explicit empty tax-filing page", async () => {
  const page = createTaxFilingPage({
    records: [],
    total: 0,
    current: 1,
    size: 1000,
    pages: 0,
  })
  const { broker } = createBroker({
    responses: {
      [TAX_FILING_PATH]: page,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  })

  assert.equal(result.ok, true, "an explicit empty tax-filing page must remain a valid response")
  assert.deepEqual(result.data.records, [], "an empty tax-filing page must not be converted to an error")
})

test("Bitunix Spot broker propagates tax-filing REST failures without retrying", async () => {
  const transportFailure = new Error("tax-filing endpoint unavailable")
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: transportFailure,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  })

  assert.equal(result.ok, false, "a failed tax-filing request must not appear as a successful empty page")
  assert.equal(result.errors[0], transportFailure, "the original tax-filing transport error must remain available")
  assert.equal(calls.length, 1, "a failed tax-filing read must not be retried implicitly")
})

const WITHDRAW_PATH = "/api/spot/v1/withdraw"
const CANCEL_WITHDRAW_PATH = "/api/spot/v1/withdraw/cancel"
const FUNDS_TRANSFER_PATH = "/api/spot/v1/funds_transfer"
const WITHDRAWAL_HISTORY_PATH = "/api/spot/v1/withdraw_transfer/page"

test("Bitunix Spot withdrawal is disabled by default and never dispatches a funds mutation", async () => {
  const { broker, calls } = createBroker({
    allowLiveOrderMutations: true,
  })

  const result = await broker.withdraw({
    coin: "USDT",
    network: "Tron (TRC-20)",
    address: "TExampleAddress",
    amount: "10.00000000",
  })

  assert.equal(result.ok, false, "withdrawal must remain disabled unless the separate funds-mutation gate is enabled")
  assert.equal(result.mutationOutcome, "NOT_SENT", "a locally blocked withdrawal must be classified as not sent")
  assert.equal(calls.length, 0, "a disabled withdrawal must not contact the Bitunix API")
})

test("Bitunix Spot withdrawal sends the documented signed request and preserves the withdrawal ID", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: "1909879608889339906",
    },
  })

  const result = await broker.withdraw({
    coin: "USDT",
    network: "Tron (TRC-20)",
    address: "TExampleAddress",
    amount: "10.000000000000000001",
    memo: "deposit-tag",
  })

  assert.equal(result.ok, true, "a successful Bitunix withdrawal acknowledgement must return a successful result")
  assert.equal(result.data.withdrawId, "1909879608889339906", "the exchange withdrawal ID must be preserved exactly")
  assert.equal(result.mutationOutcome, "CONFIRMED", "a successful exchange acknowledgement must be classified as confirmed")
  assert.deepEqual(calls, [{
    method: "POST",
    path: WITHDRAW_PATH,
    options: {
      body: {
        coin: "USDT",
        network: "Tron (TRC-20)",
        address: "TExampleAddress",
        amount: "10.000000000000000001",
        memo: "deposit-tag",
      },
      authenticated: true,
      stateChanging: true,
    },
  }], "withdrawal must use one signed state-changing request with exact amount text")
})

test("Bitunix Spot withdrawal rejects invalid amounts and destination data before dispatch", async () => {
  const invalidRequests = [
    {
      coin: "USDT",
      network: "TRC-20",
      address: "TAddress",
      amount: "0",
    },
    {
      coin: "USDT",
      network: "TRC-20",
      address: "TAddress",
      amount: "-1",
    },
    {
      coin: "USDT",
      network: "TRC-20",
      address: "TAddress",
      amount: 1.25,
    },
    {
      coin: "USDT",
      network: "TRC-20",
      address: "TAddress",
      amount: "1e-8",
    },
    {
      coin: "",
      network: "TRC-20",
      address: "TAddress",
      amount: "1",
    },
    {
      coin: "USDT",
      network: "",
      address: "TAddress",
      amount: "1",
    },
    {
      coin: "USDT",
      network: "TRC-20",
      address: "",
      amount: "1",
    },
    {
      coin: "USDT",
      network: "TRC-20",
      address: "TAddress",
      amount: "1",
      memo: 7,
    },
  ]
  for (const request of invalidRequests) {
    const { broker, calls } = createBroker({
      allowLiveFundsMutations: true,
    })
    const result = await broker.withdraw(request)

    assert.equal(result.ok, false, `invalid withdrawal request must fail locally: ${JSON.stringify(request)}`)
    assert.equal(result.mutationOutcome, "NOT_SENT", `invalid withdrawal input must be classified as not sent: ${JSON.stringify(request)}`)
    assert.equal(calls.length, 0, "invalid withdrawal input must not reach the exchange")
  }
})

test("Bitunix Spot withdrawal reports an unknown outcome after a dispatched transport failure without retrying", async () => {
  const transportFailure = new Error("connection lost after withdrawal submission")
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: transportFailure,
    },
  })

  const result = await broker.withdraw({
    coin: "USDT",
    network: "Tron (TRC-20)",
    address: "TExampleAddress",
    amount: "10",
  })

  assert.equal(result.ok, false, "a lost withdrawal response must not be represented as a successful withdrawal")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a dispatched withdrawal with lost acknowledgement must be classified as unknown")
  assert.equal(result.errors[0], transportFailure, "the original transport failure must remain available")
  assert.equal(calls.length, 1, "an uncertain withdrawal must never be retried automatically")
})

test("Bitunix Spot withdrawal cancellation verifies the final cancelled history state", async () => {
  const withdrawalId = "1909879608889339906"
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [CANCEL_WITHDRAW_PATH]: null,
      [WITHDRAWAL_HISTORY_PATH]: [{
        id: withdrawalId,
        type: "withdraw",
        coin: "USDT",
        amount: "9.5",
        status: "cancelled",
        ctime: 1744185294000,
      }],
    },
  })

  const result = await broker.cancelWithdrawal({
    withdrawId: withdrawalId,
  })

  assert.equal(result.ok, true, "a cancelled withdrawal confirmed by history must return success")
  assert.equal(result.data.status, "cancelled", "the authoritative cancelled status must be returned")
  assert.equal(result.mutationOutcome, "CONFIRMED", "a history-confirmed cancellation must be classified as confirmed")
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: CANCEL_WITHDRAW_PATH,
      options: {
        body: { withdrawId: withdrawalId },
        authenticated: true,
        stateChanging: true,
      },
    },
    {
      method: "POST",
      path: WITHDRAWAL_HISTORY_PATH,
      options: {
        body: {
          id: withdrawalId,
          type: "withdraw",
        },
        authenticated: true,
        stateChanging: false,
      },
    },
  ], "cancellation must be followed by one signed read-only history verification")
})

test("Bitunix Spot withdrawal cancellation remains unknown until history confirms cancellation", async () => {
  const withdrawalId = "1909879608889339906"
  const { broker } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [CANCEL_WITHDRAW_PATH]: null,
      [WITHDRAWAL_HISTORY_PATH]: [{
        id: withdrawalId,
        type: "withdraw",
        coin: "USDT",
        amount: "9.5",
        status: "pending",
        ctime: 1744185294000,
      }],
    },
  })

  const result = await broker.cancelWithdrawal({
    withdrawId: withdrawalId,
  })

  assert.equal(result.ok, false, "a non-cancelled withdrawal history row must not be reported as cancelled")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a successful cancel acknowledgement without cancelled final state must remain unknown")
})

test("Bitunix Spot funds transfer is separately gated and submits exact decimal amounts", async () => {
  const { broker: disabledBroker, calls: disabledCalls } = createBroker({
    allowLiveOrderMutations: true,
  })
  const disabled = await disabledBroker.transferFunds({
    type: "spot_futures",
    coin: "USDT",
    amount: "100.01000000",
  })

  assert.equal(disabled.ok, false, "funds transfer must not inherit the order-mutation opt-in")
  assert.equal(disabled.mutationOutcome, "NOT_SENT", "a disabled funds transfer must be classified as not sent")
  assert.equal(disabledCalls.length, 0, "a disabled funds transfer must not contact the exchange")

  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [FUNDS_TRANSFER_PATH]: "1909902180506972162",
    },
  })
  const result = await broker.transferFunds({
    type: "spot_futures",
    coin: "USDT",
    amount: "100.01000000",
  })

  assert.equal(result.ok, true, "a successful Bitunix funds-transfer acknowledgement must return success")
  assert.equal(result.data.transferId, "1909902180506972162", "the transfer ID must be preserved exactly")
  assert.equal(result.mutationOutcome, "CONFIRMED", "a successful transfer acknowledgement must be classified as confirmed")
  assert.deepEqual(calls, [{
    method: "POST",
    path: FUNDS_TRANSFER_PATH,
    options: {
      body: {
        type: "spot_futures",
        coin: "USDT",
        amount: "100.01000000",
      },
      authenticated: true,
      stateChanging: true,
    },
  }], "funds transfer must use one signed state-changing request and preserve exact amount text")
})

test("Bitunix Spot funds transfer rejects invalid asset, direction, and quantity before dispatch", async () => {
  const invalidRequests = [
    {
      type: "unknown",
      coin: "USDT",
      amount: "1",
    },
    {
      type: "spot_futures",
      coin: "",
      amount: "1",
    },
    {
      type: "spot_futures",
      coin: "USDT",
      amount: "0",
    },
    {
      type: "futures_spot",
      coin: "USDT",
      amount: "-1",
    },
    {
      type: "futures_spot",
      coin: "USDT",
      amount: 1,
    },
  ]
  for (const request of invalidRequests) {
    const { broker, calls } = createBroker({
      allowLiveFundsMutations: true,
    })
    const result = await broker.transferFunds(request)

    assert.equal(result.ok, false, `invalid funds-transfer request must fail locally: ${JSON.stringify(request)}`)
    assert.equal(result.mutationOutcome, "NOT_SENT", "invalid funds-transfer input must be classified as not sent")
    assert.equal(calls.length, 0, "invalid funds-transfer input must not reach the exchange")
  }
})


const INTERNAL_TRANSFER_PATH = "/api/spot/v1/inside_transfer"
const CANCEL_INTERNAL_TRANSFER_PATH = "/api/spot/v1/inside_transfer/cancel"

test("Bitunix Spot internal transfer is separately gated and preserves an int64 recipient UID", async () => {
  const { broker: disabledBroker, calls: disabledCalls } = createBroker({
    allowLiveOrderMutations: true,
  })
  const disabled = await disabledBroker.requestInternalTransfer({
    coin: "USDT",
    amount: "10.00000000",
    toType: "uid",
    toUid: "9223372036854775807",
  })

  assert.equal(disabled.ok, false, "internal transfers must not inherit the order-mutation opt-in")
  assert.equal(disabled.mutationOutcome, "NOT_SENT", "a disabled internal transfer must be classified as not sent")
  assert.equal(disabledCalls.length, 0, "a disabled internal transfer must not contact the exchange")

  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [INTERNAL_TRANSFER_PATH]: "1909921053381820417",
    },
  })
  const result = await broker.requestInternalTransfer({
    outBizId: "coinzilla-transfer-001",
    coin: "USDT",
    amount: "10.00000000",
    toType: "uid",
    toUid: "9223372036854775807",
    remark: "account rebalance",
  })

  assert.equal(result.ok, true, "a successful Bitunix internal-transfer acknowledgement must return success")
  assert.equal(result.data.insideTransferId, "1909921053381820417", "the exchange transfer ID must be preserved exactly")
  assert.equal(result.data.outBizId, "coinzilla-transfer-001", "the caller's idempotency key must be returned for reconciliation")
  assert.equal(result.mutationOutcome, "CONFIRMED", "a successful internal-transfer acknowledgement must be classified as confirmed")
  assert.deepEqual(calls, [{
    method: "POST",
    path: INTERNAL_TRANSFER_PATH,
    options: {
      body: {
        outBizId: "coinzilla-transfer-001",
        coin: "USDT",
        amount: "10.00000000",
        toType: "uid",
        toUid: "9223372036854775807",
        remark: "account rebalance",
      },
      authenticated: true,
      stateChanging: true,
    },
  }], "internal transfer must use one signed state-changing request with the exact UID and idempotency key")
})

test("Bitunix Spot internal transfer supports phone and email recipient modes", async () => {
  const requests = [
    {
      input: {
        coin: "USDT",
        amount: "1",
        toType: "phone",
        toPhoneCountryCode: "+1",
        toPhoneNumber: "5551234567",
      },
      body: {
        coin: "USDT",
        amount: "1",
        toType: "phone",
        toPhoneCountryCode: "+1",
        toPhoneNumber: "5551234567",
      },
    },
    {
      input: {
        coin: "USDT",
        amount: "2",
        toType: "email",
        toEmail: "recipient@example.com",
      },
      body: {
        coin: "USDT",
        amount: "2",
        toType: "email",
        toEmail: "recipient@example.com",
      },
    },
  ]

  for (const { input, body } of requests) {
    const { broker, calls } = createBroker({
      allowLiveFundsMutations: true,
      responses: {
        [INTERNAL_TRANSFER_PATH]: "1909921053381820417",
      },
    })
    const result = await broker.requestInternalTransfer(input)

    assert.equal(result.ok, true, `valid ${input.toType} recipient transfer must succeed`)
    assert.deepEqual(calls[0].options.body, body, `the ${input.toType} recipient fields must be sent unchanged`)
  }
})

test("Bitunix Spot internal transfer rejects mismatched recipients, malformed idempotency keys and amounts before dispatch", async () => {
  const invalidRequests = [
    {
      coin: "USDT",
      amount: "1",
      toType: "uid",
    },
    {
      coin: "USDT",
      amount: "1",
      toType: "uid",
      toUid: "not-a-uid",
    },
    {
      coin: "USDT",
      amount: "1",
      toType: "uid",
      toUid: "9223372036854775807",
      toEmail: "unexpected@example.com",
    },
    {
      coin: "USDT",
      amount: "1",
      toType: "phone",
      toPhoneNumber: "5551234567",
    },
    {
      coin: "USDT",
      amount: "1",
      toType: "email",
      toEmail: "",
    },
    {
      outBizId: "x".repeat(33),
      coin: "USDT",
      amount: "1",
      toType: "email",
      toEmail: "recipient@example.com",
    },
    {
      coin: "USDT",
      amount: "0",
      toType: "email",
      toEmail: "recipient@example.com",
    },
    {
      coin: "USDT",
      amount: "1e-8",
      toType: "email",
      toEmail: "recipient@example.com",
    },
  ]

  for (const request of invalidRequests) {
    const { broker, calls } = createBroker({
      allowLiveFundsMutations: true,
    })
    const result = await broker.requestInternalTransfer(request)

    assert.equal(result.ok, false, `invalid internal-transfer input must fail locally: ${JSON.stringify(request)}`)
    assert.equal(result.mutationOutcome, "NOT_SENT", "invalid internal-transfer input must be classified as not sent")
    assert.equal(calls.length, 0, "invalid internal-transfer input must not reach the exchange")
  }
})

test("Bitunix Spot internal transfer cancellation verifies the final cancelled history state", async () => {
  const insideTransferId = "1909921053381820417"
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [CANCEL_INTERNAL_TRANSFER_PATH]: null,
      [WITHDRAWAL_HISTORY_PATH]: [{
        id: insideTransferId,
        type: "inside_transfer_out",
        coin: "USDT",
        amount: "10.00000000",
        status: "cancelled",
        ctime: 1744191503000,
      }],
    },
  })

  const result = await broker.cancelInternalTransfer({
    insideTransferId,
  })

  assert.equal(result.ok, true, "a history-confirmed internal-transfer cancellation must return success")
  assert.equal(result.data.status, "cancelled", "the authoritative cancelled state must be returned")
  assert.equal(result.mutationOutcome, "CONFIRMED", "a history-confirmed cancellation must be classified as confirmed")
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: CANCEL_INTERNAL_TRANSFER_PATH,
      options: {
        body: { insideTransferId },
        authenticated: true,
        stateChanging: true,
      },
    },
    {
      method: "POST",
      path: WITHDRAWAL_HISTORY_PATH,
      options: {
        body: {
          id: insideTransferId,
          type: "inside_transfer_out",
        },
        authenticated: true,
        stateChanging: false,
      },
    },
  ], "internal-transfer cancellation must be followed by one signed history verification")
})

test("Bitunix Spot internal-transfer cancellation remains unknown until history confirms cancellation", async () => {
  const insideTransferId = "1909921053381820417"
  const { broker } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [CANCEL_INTERNAL_TRANSFER_PATH]: null,
      [WITHDRAWAL_HISTORY_PATH]: [{
        id: insideTransferId,
        type: "inside_transfer_out",
        coin: "USDT",
        amount: "10.00000000",
        status: "pending",
        ctime: 1744191503000,
      }],
    },
  })

  const result = await broker.cancelInternalTransfer({
    insideTransferId,
  })

  assert.equal(result.ok, false, "a non-cancelled transfer history row must not be reported as cancelled")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "an unconfirmed internal-transfer cancellation must remain unknown")
})
