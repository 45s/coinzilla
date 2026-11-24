import assert from "node:assert/strict"
import test from "node:test"
import { Broker } from "../../../broker.js"

const credentials = {
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
}

function createFuturesResponse({ data, code = 0, message = "Success" }) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => "application/json",
    },
    json: async () => ({
      code,
      data,
      msg: message,
    }),
  }
}

function createSymbolInfo(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    base: "BTC",
    quote: "USDT",
    symbolStatus: "OPEN",
    isApiSupported: true,
    minTradeVolume: "0.0001",
    maxLimitOrderVolume: "100000",
    maxMarketOrderVolume: "50000",
    basePrecision: 4,
    quotePrecision: 1,
    ...overrides,
  }
}

function createOrderRow({ status = "NEW" } = {}) {
  return {
    orderId: "futures-order-123",
    clientId: "strategy-order-456",
    symbol: "BTCUSDT",
    side: "BUY",
    orderType: "LIMIT",
    qty: "0.01",
    tradeQty: "0",
    price: "60000.1",
    status,
    ctime: 1700000000000,
    mtime: 1700000001000,
  }
}

function createOrderFetch({
  requests,
  symbolInfo = {},
  orderStatus = "NEW",
  placeResponse,
  placeError,
  responseCode = 0,
  responseMessage = "Success",
}) {
  return async (...request) => {
    const [url, options] = request
    const path = new URL(url).pathname
    requests.push({
      path,
      method: options.method,
      body: options.body,
      search: new URL(url).search,
    })
    if (path === "/api/v1/futures/market/trading_pairs") {
      return createFuturesResponse({
        data: [createSymbolInfo(symbolInfo)],
      })
    }
    if (path === "/api/v1/futures/trade/place_order") {
      if (placeError) {
        throw placeError
      }
      return createFuturesResponse({
        data: placeResponse ?? {
          orderId: "futures-order-123",
          clientId: "strategy-order-456",
        },
        code: responseCode,
        message: responseMessage,
      })
    }
    if (path === "/api/v1/futures/trade/get_order_detail") {
      return createFuturesResponse({
        data: createOrderRow({
          status: orderStatus,
        }),
      })
    }
    throw new Error(`Unexpected Futures order request: ${path}`)
  }
}

function createOrderBroker({
  allowLiveOrderMutations = true,
  ...fetchOptions
} = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      allowLiveOrderMutations,
      dependencies: {
        fetchFn: createOrderFetch({
          requests,
          ...fetchOptions,
        }),
      },
    },
  })
  return {
    broker,
    requests,
  }
}

const limitOrderInput = {
  symbol: "BTCUSDT",
  side: "BUY",
  orderType: "LIMIT",
  qty: "0.01",
  price: "60000.1",
  tradeSide: "OPEN",
  reduceOnly: false,
  effect: "GTC",
  clientId: "strategy-order-456",
}

test("Bitunix Futures createFuturesOrder preserves explicit Futures semantics and verifies the created order", async () => {
  const { broker, requests } = createOrderBroker()
  await broker.connect()

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.orderOutcome, "CONFIRMED")
  assert.equal(result.data.clientOrderId, "strategy-order-456")
  assert.equal(result.data.brokerOrderId, "futures-order-123")
  const placeRequest = requests.find(({ path }) => path === "/api/v1/futures/trade/place_order")
  assert.deepEqual(JSON.parse(placeRequest.body), {
    symbol: "BTCUSDT",
    side: "BUY",
    orderType: "LIMIT",
    qty: "0.01",
    price: "60000.1",
    tradeSide: "OPEN",
    reduceOnly: false,
    effect: "GTC",
    clientId: "strategy-order-456",
  })
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures createFuturesOrder is NOT_SENT without explicit live mutation opt-in", async () => {
  const { broker, requests } = createOrderBroker({
    allowLiveOrderMutations: false,
  })
  await broker.connect()

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.orderOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures createFuturesOrder rejects missing client identity before network access", async () => {
  const { broker, requests } = createOrderBroker()
  await broker.connect()

  const result = await broker.createFuturesOrder({
    ...limitOrderInput,
    clientId: undefined,
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures createFuturesOrder rejects quantity precision beyond exchange metadata", async () => {
  const { broker, requests } = createOrderBroker()
  await broker.connect()

  const result = await broker.createFuturesOrder({
    ...limitOrderInput,
    qty: "0.00001",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/place_order"), false)
})

test("Bitunix Futures createFuturesOrder requires positionId for CLOSE tradeSide", async () => {
  const { broker, requests } = createOrderBroker()
  await broker.connect()

  const result = await broker.createFuturesOrder({
    ...limitOrderInput,
    tradeSide: "CLOSE",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})
