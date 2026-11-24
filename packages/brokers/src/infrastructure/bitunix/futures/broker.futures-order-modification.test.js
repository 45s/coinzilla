import assert from "node:assert/strict"
import test from "node:test"
import { Broker } from "../../../index.js"

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

function createSymbolInfo() {
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
  }
}

function createPendingOrder(overrides = {}) {
  return {
    orderId: "futures-order-123",
    clientId: "strategy-order-456",
    symbol: "BTCUSDT",
    side: "BUY",
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    qty: "0.01",
    tradeQty: "0.005",
    orderType: "LIMIT",
    price: "60000.1",
    effect: "GTC",
    reduceOnly: false,
    status: "PART_FILLED",
    fee: "0",
    realizedPNL: "0",
    ctime: 1700000000000,
    mtime: 1700000001000,
    ...overrides,
  }
}

function createCanonicalOrder({ qty = "0.02", price = "61000.1", status = "PART_FILLED" } = {}) {
  return {
    ...createPendingOrder({
      qty,
      price,
      status,
    }),
  }
}

function createModifyFetch({
  requests,
  pendingOrder,
  pendingTotal = 1,
  detailOrder,
  modifyResponse,
  modifyError,
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
        data: [createSymbolInfo()],
      })
    }
    if (path === "/api/v1/futures/trade/get_pending_orders") {
      return createFuturesResponse({
        data: {
          orderList: pendingTotal === 0 ? [] : [createPendingOrder(pendingOrder)],
          total: pendingTotal,
        },
      })
    }
    if (path === "/api/v1/futures/trade/modify_order") {
      if (modifyError) {
        throw modifyError
      }
      return createFuturesResponse({
        data: modifyResponse ?? {
          orderId: "futures-order-123",
        },
        code: responseCode,
        message: responseMessage,
      })
    }
    if (path === "/api/v1/futures/trade/get_order_detail") {
      return createFuturesResponse({
        data: createCanonicalOrder(detailOrder),
      })
    }
    throw new Error(`Unexpected Futures modify request: ${path}`)
  }
}

function createModifyBroker({
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
        fetchFn: createModifyFetch({
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

const modifyInput = {
  symbol: "BTCUSDT",
  orderId: "futures-order-123",
  clientId: "strategy-order-456",
  qty: "0.02",
  price: "61000.1",
}

test("Bitunix Futures modifyFuturesOrder preflights and verifies exact order changes", async () => {
  const { broker, requests } = createModifyBroker()
  await broker.connect()

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.orderOutcome, "CONFIRMED")
  assert.equal(result.data.quantity, "0.02")
  assert.equal(result.data.limitPrice, "61000.1")
  const modifyRequest = requests.find(({ path }) => path === "/api/v1/futures/trade/modify_order")
  assert.deepEqual(JSON.parse(modifyRequest.body), {
    qty: "0.02",
    clientId: "strategy-order-456",
    orderId: "futures-order-123",
    price: "61000.1",
  })
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures modifyFuturesOrder is NOT_SENT without explicit live mutation opt-in", async () => {
  const { broker, requests } = createModifyBroker({
    allowLiveOrderMutations: false,
  })
  await broker.connect()

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.orderOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures modifyFuturesOrder rejects quantities below already executed quantity", async () => {
  const { broker, requests } = createModifyBroker()
  await broker.connect()

  const result = await broker.modifyFuturesOrder({
    ...modifyInput,
    qty: "0.001",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/modify_order"), false)
})

test("Bitunix Futures modifyFuturesOrder requires exactly one matching pending order", async () => {
  const { broker, requests } = createModifyBroker({
    pendingTotal: 0,
  })
  await broker.connect()

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/modify_order"), false)
})
