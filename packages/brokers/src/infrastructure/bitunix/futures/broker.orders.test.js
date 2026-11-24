import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"
import { connectAndAcknowledgeUserDataReconciliation, FakePrivateWebSocketClient } from "./futures-mutation-fixtures.js"
import { CanonicalOrder } from "@coinzilla/entities"

const credentials = {
  apiKey: "bitunix-futures-orders-test-key",
  apiSecret: "bitunix-futures-orders-test-secret",
}

function createFuturesResponse({ data }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

function createOrderRow(overrides = {}) {
  return {
    orderId: "futures-order-123",
    clientId: "strategy-order-456",
    symbol: "BTCUSDT",
    qty: "0.500000000000000001",
    tradeQty: "0.125000000000000001",
    price: "65000.123456789012345",
    side: "BUY",
    orderType: "LIMIT",
    status: "PART_FILLED",
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    reduceOnly: false,
    ctime: 1_700_000_000_000,
    mtime: 1_700_000_000_500,
    ...overrides,
  }
}

function createBroker({ orderRow = createOrderRow() } = {}) {
  const requests = []
  const privateClients = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        webSocketClientFactory: createFakePrivateWebSocketClientFactory(),
        fetchFn: async (...args) => {
          const [url, options] = args
          requests.push({
            url: String(url),
            options,
          })
          const path = new URL(url).pathname
          if (path === "/api/v1/futures/market/trading_pairs") {
            return createFuturesResponse({
              data: [{
                symbol: "BTCUSDT",
                base: "BTC",
                quote: "USDT",
                symbolStatus: "OPEN",
                isApiSupported: true,
              }],
            })
          }
          if (path === "/api/v1/futures/trade/get_order_detail") {
            return createFuturesResponse({
              data: orderRow,
            })
          }
          if (path === "/api/v1/futures/trade/get_history_orders") {
            return createFuturesResponse({
              data: {
                orderList: [orderRow],
                total: 1,
              },
            })
          }
          throw new Error(`Unexpected Futures request: ${path}`)
        },
      },
    },
  })
  return {
    broker,
    requests,
  }
}

test("Bitunix Futures getCanonicalOrder reads by client ID and preserves exact order facts", async () => {
  const { broker, requests } = createBroker()
  await broker.getExchangeMarkets()

  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "strategy-order-456",
  })

  assert.equal(result.ok, true)
  assert.ok(result.data instanceof CanonicalOrder)
  assert.equal(result.data.clientOrderId, "strategy-order-456")
  assert.equal(result.data.brokerOrderId, "futures-order-123")
  assert.equal(result.data.market.symbol, "BTCUSDT")
  assert.equal(result.data.side, "BUY")
  assert.equal(result.data.type, "LIMIT")
  assert.equal(result.data.status, "PARTIALLY_FILLED")
  assert.equal(result.data.originalQuantity.amount, "0.500000000000000001")
  assert.equal(result.data.executedQuantity.amount, "0.125000000000000001")
  assert.equal(result.data.remainingQuantity.amount, "0.375")
  assert.equal(result.data.limitPrice.amount, "65000.123456789012345")
  assert.equal(result.data.createdAt, 1_700_000_000_000)
  assert.equal(result.data.updatedAt, 1_700_000_000_500)

  const detailRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/get_order_detail")
  assert.ok(detailRequest)
  assert.equal(new URL(detailRequest.url).searchParams.get("clientId"), "strategy-order-456")
  assert.equal(new URL(detailRequest.url).searchParams.has("orderId"), false)
  assert.equal(detailRequest.options.method, "GET")
  assert.equal(Object.hasOwn(detailRequest.options.headers, "api-key"), true)
})

test("Bitunix Futures getCanonicalOrder rejects exchange rows without a client ID instead of inventing canonical identity", async () => {
  const { broker } = createBroker({
    orderRow: createOrderRow({ clientId: undefined }),
  })
  await broker.getExchangeMarkets()

  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /client.*id/i)
})

test("Bitunix Futures canonical order lookup requires exactly one identifier", async () => {
  const { broker, requests } = createBroker()

  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
    clientOrderId: "strategy-order-456",
  })

  assert.equal(result.ok, false)
  assert.equal(requests.length, 0)
})


test("Bitunix Futures getCanonicalOrderHistory returns one bounded symbol-scoped page", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getCanonicalOrderHistory({
    symbol: "BTCUSDT",
    startTime: 1_699_999_000_000,
    endTime: 1_700_001_000_000,
    limit: 25,
    skip: 50,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.ok(result.data[0] instanceof CanonicalOrder)
  const historyRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/get_history_orders")
  assert.ok(historyRequest)
  const query = new URL(historyRequest.url).searchParams
  assert.equal(query.get("symbol"), "BTCUSDT")
  assert.equal(query.get("startTime"), "1699999000000")
  assert.equal(query.get("endTime"), "1700001000000")
  assert.equal(query.get("limit"), "25")
  assert.equal(query.get("skip"), "50")
  assert.equal(historyRequest.options.method, "GET")
  assert.equal(Object.hasOwn(historyRequest.options.headers, "api-key"), true)
})

test("Bitunix Futures canonical history rejects pages containing orders without caller identity", async () => {
  const { broker } = createBroker({
    orderRow: createOrderRow({ clientId: undefined }),
  })
  const result = await broker.getCanonicalOrderHistory({
    symbol: "BTCUSDT",
    limit: 10,
    skip: 0,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /client.*id/i)
})

test("Bitunix Futures canonical history validates pagination and time bounds before network I/O", async () => {
  const { broker, requests } = createBroker()
  for (const input of [
    {
      symbol: "BTCUSDT",
      limit: 101,
    },
    {
      symbol: "BTCUSDT",
      skip: -1,
    },
    {
      symbol: "BTCUSDT",
      startTime: 20,
      endTime: 10,
    },
  ]) {
    const result = await broker.getCanonicalOrderHistory(input)
    assert.equal(result.ok, false)
  }
  assert.equal(requests.length, 0)
})


test("Bitunix Futures canonical history supports canceled-order filters and normalizes partial cancellation", async () => {
  const { broker, requests } = createBroker({
    orderRow: createOrderRow({
      status: "PART_FILLED_CANCELED",
    }),
  })
  const result = await broker.getCanonicalOrderHistory({
    symbol: "BTCUSDT",
    status: "PART_FILLED_CANCELED",
    orderType: "LIMIT",
    queryCanceled: true,
    limit: 10,
    skip: 0,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data[0].status, "CANCELED")
  assert.equal(result.data[0].executedQuantity.amount, "0.125000000000000001")
  const historyRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/get_history_orders")
  const query = new URL(historyRequest.url).searchParams
  assert.equal(query.get("status"), "PART_FILLED_CANCELED")
  assert.equal(query.get("type"), "LIMIT")
  assert.equal(query.get("queryCanceled"), "true")
})


test("Bitunix Futures common open-order method remains explicitly unsupported", async () => {
  const { broker } = createBroker()
  const result = await broker.getOpenOrders()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not supported safely/i)
})


function createCancellationMarketResponse() {
  return createFuturesResponse({
    data: [{
      symbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
      symbolStatus: "OPEN",
      isApiSupported: true,
    }],
  })
}

function createCancellationPendingResponse({ pendingOrder }) {
  return createFuturesResponse({
    data: {
      orderList: [createOrderRow({
        fee: "0.0001",
        realizedPNL: "0",
        effect: "GTC",
        status: "PART_FILLED",
        ...pendingOrder,
      })],
      total: 1,
    },
  })
}

function createCancellationDetailResponse({ detailStatus }) {
  return createFuturesResponse({
    data: createOrderRow({
      status: detailStatus,
    }),
  })
}

function createCancellationAckResponse({ cancelResponse }) {
  return createFuturesResponse({
    data: cancelResponse ?? {
      successList: [{
        orderId: "futures-order-123",
        clientId: "strategy-order-456",
      }],
      failureList: [],
    },
  })
}

function emitCancellationEvent({ privateClients, detailStatus }) {
  privateClients[0]?.emit("channel", {
    ch: "order",
    symbol: "BTCUSDT",
    ts: 1_700_000_002_000,
    data: {
      event: "CLOSE",
      orderId: "futures-order-123",
      clientId: "strategy-order-456",
      symbol: "BTCUSDT",
      orderStatus: detailStatus,
    },
  })
}

function shouldEmitCancellationEvent({ cancelResponse, detailStatus }) {
  const explicitlyRejected = cancelResponse?.failureList?.some(
    (failure) => failure?.orderId === "futures-order-123",
  )
  return !explicitlyRejected && ["CANCELED", "PART_FILLED_CANCELED"].includes(detailStatus)
}

function createCancellationFetch({
  requests,
  privateClients,
  cancelResponse,
  detailStatus = "PART_FILLED_CANCELED",
  pendingOrder = {},
  cancelError,
}) {
  return async (...request) => {
    const [url, options] = request
    const path = new URL(url).pathname
    requests.push({
      path,
      method: options.method,
      body: options.body,
    })
    if (path === "/api/v1/futures/market/trading_pairs") {
      return createCancellationMarketResponse()
    }
    if (path === "/api/v1/futures/trade/get_pending_orders") {
      return createCancellationPendingResponse({
        pendingOrder,
      })
    }
    if (path === "/api/v1/futures/trade/get_order_detail") {
      return createCancellationDetailResponse({
        detailStatus,
      })
    }
    if (path === "/api/v1/futures/trade/cancel_orders") {
      if (shouldEmitCancellationEvent({
        cancelResponse,
        detailStatus,
      })) {
        emitCancellationEvent({
          privateClients,
          detailStatus,
        })
      }
      if (cancelError) {
        throw cancelError
      }
      return createCancellationAckResponse({
        cancelResponse,
      })
    }
    throw new Error(`Unexpected Futures cancellation request: ${path}`)
  }
}

function createCancellationBroker({
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
        privateEventTimeoutMs: 10,
        webSocketClientFactory: ({ channelType }) => {
          const client = new FakePrivateWebSocketClient()
          if (channelType === "private") {
            privateClients.push(client)
          }
          return client
        },
        fetchFn: createCancellationFetch({
          requests,
          privateClients,
          ...fetchOptions,
        }),
      },
    },
  })
  return {
    broker,
    requests,
    privateClients,
  }
}

test("Bitunix Futures cancelOrder is one-shot and confirms the final canceled order state", async () => {
  const { broker, requests } = createCancellationBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)
  await broker.getExchangeMarkets()

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(result.data.status, "CANCELED")
  assert.deepEqual(requests.map(({ path, method }) => [path, method]), [
    ["/api/v1/futures/market/trading_pairs", "GET"],
    ["/api/v1/futures/trade/get_pending_orders", "GET"],
    ["/api/v1/futures/trade/cancel_orders", "POST"],
    ["/api/v1/futures/trade/get_order_detail", "GET"],
  ])
  const [, , cancelRequest] = requests
  assert.deepEqual(JSON.parse(cancelRequest.body), {
    symbol: "BTCUSDT",
    orderList: [{
      orderId: "futures-order-123",
    }],
  })
})


test("Bitunix Futures cancelOrder reconciles a lost acknowledgement by client ID without retrying", async () => {
  const { broker, requests } = createCancellationBroker({
    cancelError: new Error("connection lost after dispatch"),
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)
  await broker.getExchangeMarkets()

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures cancelOrder reports unknown when a lost acknowledgement cannot be reconciled", async () => {
  const { broker, requests } = createCancellationBroker({
    cancelError: new Error("connection lost after dispatch"),
    detailStatus: "PART_FILLED",
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)
  await broker.getExchangeMarkets()

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures cancelOrder returns a per-order exchange rejection", async () => {
  const { broker, requests } = createCancellationBroker({
    cancelResponse: {
      successList: [],
      failureList: [{
        orderId: "futures-order-123",
        clientId: "strategy-order-456",
        errorCode: 10034,
        errorMsg: "order is no longer cancellable",
      }],
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)
  await broker.getExchangeMarkets()

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.equal(result.cancellationOutcome, "REJECTED")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/get_order_detail"), false)
})

test("Bitunix Futures cancelOrder does not dispatch when pending-order identity lacks clientId", async () => {
  const { broker, requests } = createCancellationBroker({
    pendingOrder: {
      clientId: undefined,
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)
  await broker.getExchangeMarkets()

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0)
})

test("Bitunix Futures cancelOrder remains NOT_SENT without explicit live mutation opt-in", async () => {
  const { broker, requests } = createCancellationBroker({
    allowLiveOrderMutations: false,
  })

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})


function createCancelAllFetch({
  requests,
  pendingTotals = [2, 0],
  cancelAllResponse,
  cancelAllError,
}) {
  let pendingReadCount = 0
  return async (...request) => {
    const [url, options] = request
    const path = new URL(url).pathname
    requests.push({
      path,
      method: options.method,
      body: options.body,
    })
    if (path === "/api/v1/futures/trade/get_pending_orders") {
      const total = pendingTotals[Math.min(pendingReadCount, pendingTotals.length - 1)]
      pendingReadCount += 1
      return createFuturesResponse({
        data: {
          orderList: total > 0 ? [createOrderRow({
            fee: "0",
            realizedPNL: "0",
            effect: "GTC",
            status: "NEW",
          })] : [],
          total,
        },
      })
    }
    if (path === "/api/v1/futures/trade/cancel_all_orders") {
      if (cancelAllError) {
        throw cancelAllError
      }
      return createFuturesResponse({
        data: cancelAllResponse ?? {
          successList: [{
            orderId: "futures-order-123",
          }],
          failureList: [],
        },
      })
    }
    throw new Error(`Unexpected Futures cancel-all request: ${path}`)
  }
}

function createCancelAllBroker({
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
        fetchFn: createCancelAllFetch({
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

test("Bitunix Futures cancelAllOpenOrders verifies an empty final pending-order scope", async () => {
  const { broker, requests } = createCancelAllBroker({
    pendingTotals: [2, 0],
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelAllOpenOrders({
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(result.data.remainingOpenOrders, 0)
  assert.deepEqual(requests.map(({ path, method }) => [path, method]), [
    ["/api/v1/futures/trade/get_pending_orders", "GET"],
    ["/api/v1/futures/trade/cancel_all_orders", "POST"],
    ["/api/v1/futures/trade/get_pending_orders", "GET"],
  ])
  const [, cancelRequest] = requests
  assert.deepEqual(JSON.parse(cancelRequest.body), {
    symbol: "BTCUSDT",
  })
})

test("Bitunix Futures cancelAllOpenOrders does not dispatch when no pending orders exist", async () => {
  const { broker, requests } = createCancelAllBroker({
    pendingTotals: [0],
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(requests.length, 1)
})

test("Bitunix Futures cancelAllOpenOrders remains NOT_SENT without explicit live mutation opt-in", async () => {
  const { broker, requests } = createCancelAllBroker({
    allowLiveOrderMutations: false,
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures cancelAllOpenOrders reports unknown while pending orders remain", async () => {
  const { broker, requests } = createCancelAllBroker({
    pendingTotals: [2, 1],
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.data.remainingOpenOrders, 1)
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures cancelAllOpenOrders supports an account-wide scope", async () => {
  const { broker, requests } = createCancelAllBroker({
    pendingTotals: [1, 0],
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  const [, cancelRequest] = requests
  assert.deepEqual(JSON.parse(cancelRequest.body), {})
})

test("Bitunix Futures cancelAllOpenOrders reconciles a lost acknowledgement without retrying", async () => {
  const { broker, requests } = createCancelAllBroker({
    pendingTotals: [2, 0],
    cancelAllError: new Error("connection lost after dispatch"),
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(result.data.remainingOpenOrders, 0)
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})


test("Bitunix Futures cancelOrder remains NOT_SENT until private user-data state is reconciled", async () => {
  const { broker, requests } = createCancellationBroker()
  await broker.connect()

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false, "cancellation must be blocked without a reconciled private user-data session")
  assert.equal(result.mutationOutcome, "NOT_SENT", "a readiness failure must occur before exchange dispatch")
  assert.equal(result.cancellationOutcome, "NOT_SENT", "the cancellation outcome must remain unsent")
  assert.equal(requests.some(({ method }) => method === "POST"), false, "no cancellation POST may be sent before reconciliation")
})

test("Bitunix Futures cancelAllOpenOrders remains NOT_SENT until private user-data state is reconciled", async () => {
  const { broker, requests } = createCancelAllBroker()
  await broker.connect()

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, false, "cancel-all must be blocked without a reconciled private user-data session")
  assert.equal(result.mutationOutcome, "NOT_SENT", "a readiness failure must occur before exchange dispatch")
  assert.equal(result.cancellationOutcome, "NOT_SENT", "the cancellation outcome must remain unsent")
  assert.equal(requests.some(({ method }) => method === "POST"), false, "no cancel-all POST may be sent before reconciliation")
})
