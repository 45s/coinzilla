import assert from "node:assert/strict"
import test from "node:test"
import { Broker } from "../../../index.js"
import { connectAndAcknowledgeUserDataReconciliation, createFakePrivateWebSocketClientFactory } from "./futures-mutation-fixtures.js"

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

function createOrderRow({ status = "NEW", ...overrides } = {}) {
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
    ...overrides,
  }
}

function createOrderFetch({
  requests,
  symbolInfo = {},
  orderStatus = "NEW",
  orderOverrides = {},
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
          ...orderOverrides,
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
        webSocketClientFactory: createFakePrivateWebSocketClientFactory(),
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
  await connectAndAcknowledgeUserDataReconciliation(broker)

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
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.orderOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures createFuturesOrder rejects missing client identity before network access", async () => {
  const { broker, requests } = createOrderBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)

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
  await connectAndAcknowledgeUserDataReconciliation(broker)

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
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder({
    ...limitOrderInput,
    tradeSide: "CLOSE",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures createFuturesOrder reconciles a lost acknowledgement by clientId without retrying", async () => {
  const { broker, requests } = createOrderBroker({
    placeError: new Error("connection lost after dispatch"),
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.orderOutcome, "CONFIRMED")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures createFuturesOrder returns a definitive exchange rejection", async () => {
  const { broker, requests } = createOrderBroker({
    responseCode: 10001,
    responseMessage: "invalid Futures order",
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.equal(result.orderOutcome, "REJECTED")
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/get_order_detail"), false)
})

test("Bitunix Futures createFuturesOrder supports explicit MARKET order semantics", async () => {
  const { broker, requests } = createOrderBroker({
    orderOverrides: {
      orderType: "MARKET",
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder({
    ...limitOrderInput,
    orderType: "MARKET",
    price: undefined,
    effect: undefined,
  })

  assert.equal(result.ok, true)
  const placeRequest = requests.find(({ path }) => path === "/api/v1/futures/trade/place_order")
  assert.deepEqual(JSON.parse(placeRequest.body), {
    symbol: "BTCUSDT",
    side: "BUY",
    orderType: "MARKET",
    qty: "0.01",
    tradeSide: "OPEN",
    reduceOnly: false,
    clientId: "strategy-order-456",
  })
})

test("Bitunix Futures createFuturesOrder validates and preserves explicit TP/SL parameters", async () => {
  const { broker, requests } = createOrderBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder({
    ...limitOrderInput,
    tpPrice: "61000.1",
    tpStopType: "MARK_PRICE",
    tpOrderType: "LIMIT",
    tpOrderPrice: "61000.1",
    slPrice: "59000.1",
    slStopType: "LAST_PRICE",
    slOrderType: "MARKET",
  })

  assert.equal(result.ok, true)
  const placeRequest = requests.find(({ path }) => path === "/api/v1/futures/trade/place_order")
  const body = JSON.parse(placeRequest.body)
  assert.equal(body.tpPrice, "61000.1")
  assert.equal(body.tpStopType, "MARK_PRICE")
  assert.equal(body.tpOrderType, "LIMIT")
  assert.equal(body.tpOrderPrice, "61000.1")
  assert.equal(body.slPrice, "59000.1")
  assert.equal(body.slStopType, "LAST_PRICE")
  assert.equal(body.slOrderType, "MARKET")
  assert.equal(Object.hasOwn(body, "slOrderPrice"), false)
})


test("Bitunix Futures createFuturesOrder does not confirm a mismatched order readback", async () => {
  const { broker, requests } = createOrderBroker({
    orderOverrides: {
      qty: "0.02",
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, false, "a different exchange order quantity must not be reported as a successful placement")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a mismatched readback cannot confirm the requested mutation")
  assert.equal(result.orderOutcome, "OUTCOME_UNKNOWN", "a mismatched readback must preserve the uncertain order outcome")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1, "reconciliation must never repeat the placement POST")
})


test("Bitunix Futures createFuturesOrder does not confirm a mismatched order price readback", async () => {
  const { broker, requests } = createOrderBroker({
    orderOverrides: {
      price: "60001.1",
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, false, "a different exchange order price must not be reported as a successful placement")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a mismatched readback cannot confirm the requested mutation")
  assert.equal(result.orderOutcome, "OUTCOME_UNKNOWN", "a mismatched readback must preserve the uncertain order outcome")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1, "reconciliation must never repeat the placement POST")
})


test("Bitunix Futures createFuturesOrder remains NOT_SENT until private user-data state is reconciled", async () => {
  const { broker, requests } = createOrderBroker()
  await broker.connect()

  const result = await broker.createFuturesOrder(limitOrderInput)

  assert.equal(result.ok, false, "order placement must be blocked without a reconciled private user-data session")
  assert.equal(result.mutationOutcome, "NOT_SENT", "a readiness failure must occur before exchange dispatch")
  assert.equal(requests.some(({ method }) => method === "POST"), false, "no placement POST may be sent before reconciliation")
})
