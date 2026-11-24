import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"
import {
  connectAndAcknowledgeUserDataReconciliation,
  FakePrivateWebSocketClient,
} from "./futures-mutation-fixtures.js"

const credentials = {
  apiKey: "bitunix-futures-cancellation-test-key",
  apiSecret: "bitunix-futures-cancellation-test-secret",
}

function createFuturesResponse({ data }) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => "application/json",
    },
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

function createOrderRow({ status = "PART_FILLED", ...overrides } = {}) {
  return {
    orderId: "futures-order-123",
    clientId: "strategy-order-456",
    symbol: "BTCUSDT",
    side: "BUY",
    orderType: "LIMIT",
    qty: "0.02",
    tradeQty: "0.01",
    price: "61000.1",
    effect: "GTC",
    fee: "0",
    realizedPNL: "0",
    status,
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    reduceOnly: false,
    ctime: 1_700_000_000_000,
    mtime: 1_700_000_000_500,
    ...overrides,
  }
}

function createCancelEvent({ privateClients, eventStatus }) {
  privateClients[0]?.emit("channel", {
    ch: "order",
    symbol: "BTCUSDT",
    ts: 1_700_000_002_000,
    data: {
      event: "CLOSE",
      orderId: "futures-order-123",
      clientId: "strategy-order-456",
      symbol: "BTCUSDT",
      orderStatus: eventStatus,
    },
  })
}

function createCancelResponse({ cancelError, emitCancelEvent, eventStatus, privateClients }) {
  if (emitCancelEvent) {
    createCancelEvent({
      privateClients,
      eventStatus,
    })
  }
  if (cancelError) {
    throw cancelError
  }
  return createFuturesResponse({
    data: {
      successList: [{
        orderId: "futures-order-123",
      }],
      failureList: [],
    },
  })
}

function createCancelFetch(options) {
  return async (...request) => {
    const [url, fetchOptions] = request
    const path = new URL(url).pathname
    options.requests.push({
      path,
      method: fetchOptions.method,
      body: fetchOptions.body,
      search: new URL(url).search,
    })
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
    if (path === "/api/v1/futures/trade/get_pending_orders") {
      return createFuturesResponse({
        data: {
          orderList: [createOrderRow()],
          total: 1,
        },
      })
    }
    if (path === "/api/v1/futures/trade/cancel_orders") {
      return createCancelResponse(options)
    }
    if (path === "/api/v1/futures/trade/get_order_detail") {
      return createFuturesResponse({
        data: createOrderRow({
          status: options.detailStatus,
        }),
      })
    }
    throw new Error(`Unexpected Futures cancellation request: ${path}`)
  }
}

function createCancelBroker(options = {}) {
  const requests = []
  const privateClients = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      allowLiveOrderMutations: true,
      dependencies: {
        privateEventTimeoutMs: 10,
        webSocketClientFactory: ({ channelType }) => {
          const client = new FakePrivateWebSocketClient()
          if (channelType === "private") {
            privateClients.push(client)
          }
          return client
        },
        fetchFn: createCancelFetch({
          requests,
          privateClients,
          emitCancelEvent: true,
          eventStatus: "CANCELED",
          detailStatus: "CANCELED",
          ...options,
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

test("Bitunix Futures cancelOrder does not confirm REST-canceled state without a matching private CLOSE event", async () => {
  const { broker, requests } = createCancelBroker({
    emitCancelEvent: false,
    detailStatus: "CANCELED",
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/cancel_orders"), true, "the cancellation test must reach the exchange mutation endpoint after a valid pending-order preflight")
  assert.equal(result.ok, false, "REST readback alone must not confirm cancellation when Bitunix requires the private order push")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "missing private cancellation evidence must leave the mutation outcome unknown")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN", "a canceled REST snapshot cannot replace the required private event")
  assert.equal(requests.filter(({ path }) => path === "/api/v1/futures/trade/cancel_orders").length, 1, "an uncertain cancellation must never be retried")
})

test("Bitunix Futures cancelOrder confirms only a matching private CLOSE event plus canceled REST readback", async () => {
  const { broker, requests, privateClients } = createCancelBroker()
  await connectAndAcknowledgeUserDataReconciliation(broker)
  const observedEvents = []
  const observePrivateEvent = (event) => observedEvents.push(event)
  privateClients[0].on("channel", observePrivateEvent)

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  privateClients[0].off("channel", observePrivateEvent)
  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/cancel_orders"), true, "the cancellation test must reach the exchange mutation endpoint after a valid pending-order preflight")
  assert.equal(observedEvents.length, 1, "the exchange fixture must emit one private order event for the cancellation")
  assert.equal(observedEvents[0].data.event, "CLOSE", "the private event must represent the order closing")
  assert.equal(observedEvents[0].data.orderStatus, "CANCELED", "the private event must carry the canceled terminal status")
  assert.equal(result.ok, true, `matching private CLOSE event and REST readback should confirm cancellation: ${result.errors?.map((error) => error.message).join("; ") ?? "no errors"}`)
  assert.equal(result.mutationOutcome, "CONFIRMED", "the matching event and readback must confirm the mutation")
  assert.equal(result.cancellationOutcome, "CONFIRMED", "the matching event and readback must confirm cancellation")
  assert.equal(requests.filter(({ path }) => path === "/api/v1/futures/trade/cancel_orders").length, 1, "confirmed cancellation must use exactly one mutation request")
})

test("Bitunix Futures cancelOrder does not treat a FILLED private CLOSE event as cancellation", async () => {
  const { broker, requests } = createCancelBroker({
    eventStatus: "FILLED",
    detailStatus: "CANCELED",
  })
  await connectAndAcknowledgeUserDataReconciliation(broker)

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(requests.some(({ path }) => path === "/api/v1/futures/trade/cancel_orders"), true, "the terminal-event test must reach the exchange mutation endpoint after a valid pending-order preflight")
  assert.equal(result.ok, false, "a FILLED event must not be mistaken for a successful cancellation")
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN", "a non-cancellation terminal event must leave the requested mutation unconfirmed")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN", "a FILLED event is not evidence of a canceled order")
  assert.equal(requests.filter(({ path }) => path === "/api/v1/futures/trade/cancel_orders").length, 1, "an ambiguous cancellation must never be retried")
})
