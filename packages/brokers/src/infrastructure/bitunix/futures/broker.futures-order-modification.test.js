import assert from "node:assert/strict"
import test from "node:test"
import { Broker } from "../../../index.js"
import { connectAndAcknowledgeUserDataReconciliation, FakePrivateWebSocketClient } from "./futures-mutation-fixtures.js"

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

function createModifyEvent({ privateClients, modifyEventOverrides }) {
  return privateClients[0]?.emit("channel", {
    ch: "order",
    symbol: "BTCUSDT",
    ts: 1_700_000_002_000,
    data: {
      event: "UPDATE",
      orderId: "futures-order-123",
      clientId: "strategy-order-456",
      symbol: "BTCUSDT",
      orderStatus: "PART_FILLED",
      qty: "0.02",
      price: "61000.1",
      ...modifyEventOverrides,
    },
  })
}

function createModifyResponse({
  modifyError,
  privateClients,
  emitModifyEvent = true,
  emitModifyEventOnError = false,
  modifyEventOverrides = {},
}) {
  if (emitModifyEvent && (!modifyError || emitModifyEventOnError)) {
    createModifyEvent({
      privateClients,
      modifyEventOverrides,
    })
  }
  if (modifyError) {
    throw modifyError
  }
  return createFuturesResponse({
    data: {
      orderId: "futures-order-123",
      clientId: "strategy-order-456",
    },
  })
}

function createModifyDetailResponse({ detailError, detailOrder }) {
  if (detailError) {
    throw detailError
  }
  return createFuturesResponse({
    data: createCanonicalOrder(detailOrder),
  })
}

function createModifyFetch(options) {
  return async (...request) => {
    const [url, fetchOptions] = request
    const path = new URL(url).pathname
    options.requests.push({
      path,
      method: fetchOptions.method,
      body: fetchOptions.body,
    })
    if (path === "/api/v1/futures/market/trading_pairs") {
      return createFuturesResponse({
        data: [createSymbolInfo()],
      })
    }
    if (path === "/api/v1/futures/trade/get_pending_orders") {
      const pendingTotal = options.pendingTotal ?? 1
      return createFuturesResponse({
        data: {
          orderList: pendingTotal === 0 ? [] : [createPendingOrder(options.pendingOrder)],
          total: pendingTotal,
        },
      })
    }
    if (path === "/api/v1/futures/trade/modify_order") {
      return createModifyResponse(options)
    }
    if (path === "/api/v1/futures/trade/get_order_detail") {
      return createModifyDetailResponse(options)
    }
    throw new Error(`Unexpected modify-order request: ${path}`)
  }
}

function createModifyBroker({
  allowLiveOrderMutations = true,
  ...fetchOptions
} = {}) {
  const requests = []
  const privateClients = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      allowLiveOrderMutations,
      dependencies: {
        webSocketClientFactory: ({ channelType }) => {
          const client = new FakePrivateWebSocketClient()
          if (channelType === "private") {
            privateClients.push(client)
          }
          return client
        },
        privateEventTimeoutMs: 10,
        fetchFn: createModifyFetch({
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

const modifyInput = {
  symbol: "BTCUSDT",
  orderId: "futures-order-123",
  clientId: "strategy-order-456",
  qty: "0.02",
  price: "61000.1",
}

test("Bitunix Futures modifyFuturesOrder preflights and verifies exact order changes", async () => {
  const { broker, requests, privateClients } = createModifyBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)
  const observedEvents = []
  const observePrivateEvent = (event) => observedEvents.push(event)
  privateClients[0].on("channel", observePrivateEvent)

  const result = await broker.modifyFuturesOrder(modifyInput)

  privateClients[0].off("channel", observePrivateEvent)
  assert.equal(privateClients.length, 1, "the test must track the actual private WebSocket client separately from public connections")
  assert.equal(observedEvents.length, 1, "the exchange fixture must emit one private order event for the modification")
  assert.equal(observedEvents[0].data.event, "UPDATE", "the observed private event must represent an order update")
  assert.equal(observedEvents[0].data.qty, modifyInput.qty, "the private event must carry the requested exact quantity")
  assert.equal(observedEvents[0].data.price, modifyInput.price, "the private event must carry the requested exact price")
  assert.equal(result.ok, true, `a matching private UPDATE event and REST readback should confirm the modification: ${result.errors?.map((error) => error.message).join("; ") ?? "no errors"}`)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.orderOutcome, "CONFIRMED")
  assert.equal(result.data.originalQuantity.amount, "0.02")
  assert.equal(result.data.limitPrice.amount, "61000.1")
  const modifyRequest = requests.find(({ path }) => path === "/api/v1/futures/trade/modify_order")
  assert.deepEqual(JSON.parse(modifyRequest.body), {
    qty: "0.02",
    clientId: "strategy-order-456",
    orderId: "futures-order-123",
    price: "61000.1",
  })
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1)
})

test("Bitunix Futures modifyFuturesOrder keeps a lost acknowledgement unknown when event and readback confirm the order state", async () => {
  const { broker, requests } = createModifyBroker({
    modifyError: new Error("connection lost after dispatch"),
    emitModifyEventOnError: true,
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.orderOutcome, "CONFIRMED")
  assert.ok(result.errors?.length > 0)
  assert.equal(requests.filter(({ path }) => path === "/api/v1/futures/trade/modify_order").length, 1)
  assert.equal(requests.filter(({ path }) => path === "/api/v1/futures/trade/get_order_detail").length, 1)
})

test("Bitunix Futures modifyFuturesOrder is NOT_SENT without explicit live mutation opt-in", async () => {
  const { broker, requests } = createModifyBroker({
    allowLiveOrderMutations: false,
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.orderOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures modifyFuturesOrder rejects quantities below already executed quantity", async () => {
  const { broker, requests } = createModifyBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)

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
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/modify_order"), false)
})


test("Bitunix Futures modifyFuturesOrder requires a price for a pending LIMIT order", async () => {
  const { broker, requests } = createModifyBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder({
    ...modifyInput,
    price: undefined,
  })

  assert.equal(result.ok, false, "a LIMIT order modification must include its required price")
  assert.equal(result.mutationOutcome, "NOT_SENT", "invalid LIMIT modifications must be rejected before dispatch")
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/modify_order"), false, "invalid input must not reach the mutation endpoint")
})

test("Bitunix Futures modifyFuturesOrder does not confirm an acknowledged but mismatched readback", async () => {
  const { broker, requests } = createModifyBroker({
    detailOrder: {
      qty: "0.03",
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false, "a different final quantity must not be reported as a successful modification")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "an acknowledged mutation with mismatched final state is uncertain")
  assert.equal(result.orderOutcome, "OUTCOME_UNKNOWN", "a mismatched final state must remain unresolved")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1, "reconciliation must never repeat the modification POST")
})


test("Bitunix Futures modifyFuturesOrder remains NOT_SENT until private user-data state is reconciled", async () => {
  const { broker, requests } = createModifyBroker()
  await broker.connect()

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false, "order modification must be blocked without a reconciled private user-data session")
  assert.equal(result.mutationOutcome, "NOT_SENT", "a readiness failure must occur before exchange dispatch")
  assert.equal(requests.some(({ method }) => method === "POST"), false, "no modification POST may be sent before reconciliation")
})


test("Bitunix Futures modifyFuturesOrder does not confirm a REST-matching result without a private UPDATE event", async () => {
  const { broker, requests } = createModifyBroker({
    emitModifyEvent: false,
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false, "REST readback alone must not confirm a modification when Bitunix requires a private order push")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a missing matching private UPDATE event must keep the mutation outcome unknown")
  assert.equal(result.orderOutcome, "OUTCOME_UNKNOWN", "a matching REST snapshot cannot replace the required private event")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1, "an uncertain modification must never be retried")
})

test("Bitunix Futures modifyFuturesOrder requires the private UPDATE event to match the requested order values", async () => {
  const { broker, requests } = createModifyBroker({
    modifyEventOverrides: {
      qty: "0.03",
    },
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.modifyFuturesOrder(modifyInput)

  assert.equal(result.ok, false, "a private UPDATE event with a different quantity must not confirm the requested modification")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a mismatched private event must preserve the unknown mutation outcome")
  assert.equal(result.orderOutcome, "OUTCOME_UNKNOWN", "the private event must confirm the exact requested quantity and price")
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1, "a mismatched private event must not trigger a second modification")
})
