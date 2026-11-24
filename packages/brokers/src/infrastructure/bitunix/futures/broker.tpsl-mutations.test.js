import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import {
  cancelFuturesPositionTpSlOrder,
  cancelFuturesTpSlOrder,
  modifyFuturesPositionTpSlOrder,
  placeFuturesPositionTpSlOrder,
} from "./operations/manage-futures-tpsl.js"

function createTpSlEvent({ event, status, symbol, positionId, orderId }) {
  return {
    ch: "tpsl",
    data: {
      event,
      status,
      symbol,
      positionId,
      orderId,
    },
  }
}

function createRestClient({
  requests,
  privateWebSocketClient,
  eventStatus,
  emitEvent,
  responseOrderId,
  dispatchError,
  eventPositionId,
}) {
  return {
    request: async (request) => {
      requests.push(request)
      const { path } = request
      let event = "CLOSE"
      if (path.endsWith("/place_order")) {
        event = "CREATE"
      } else if (path.endsWith("/modify_order")) {
        event = "UPDATE"
      }
      if (emitEvent) {
        privateWebSocketClient.emit("channel", createTpSlEvent({
          event,
          status: eventStatus,
          symbol: request.body.symbol,
          positionId: request.body.positionId ?? eventPositionId,
          orderId: responseOrderId,
        }))
      }
      if (dispatchError) {
        throw dispatchError
      }
      return {
        data: {
          orderId: responseOrderId,
        },
      }
    },
  }
}

function createBroker({
  eventStatus = "NEW",
  emitEvent = true,
  positionExists = true,
  responseOrderId = "tpsl-1",
  dispatchError,
  quotePrecision = 8,
  eventPositionId = "position-1",
} = {}) {
  const requests = []
  const privateWebSocketClient = new EventEmitter()
  const position = {
    positionId: "position-1",
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: "0.02",
    marginMode: "ISOLATION",
  }
  const restClient = createRestClient({
    requests,
    privateWebSocketClient,
    eventStatus,
    emitEvent,
    responseOrderId,
    dispatchError,
    eventPositionId,
  })
  const broker = {
    isUserDataReady: true,
    privateWebSocketClient,
    privateEventTimeoutMs: 30,
    getFuturesPositions: async ({ symbol, positionId } = {}) => ({
      ok: true,
      data: positionExists &&
        (symbol === undefined || symbol === position.symbol) &&
        (positionId === undefined || positionId === position.positionId)
        ? [position]
        : [],
    }),
    getSymbolFilters: async () => ({
      ok: true,
      data: {
        basePrecision: 8,
        quotePrecision,
        minTradeVolume: "0.001",
      },
    }),
    restClient,
  }
  return {
    broker,
    requests,
    privateWebSocketClient,
  }
}

test("Bitunix Futures position TP/SL placement is confirmed by CREATE NEW", async () => {
  const { broker, requests } = createBroker()

  const result = await placeFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      tpPrice: "70000.12345678",
      tpStopType: "MARK_PRICE",
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.tpSlOutcome, "CONFIRMED")
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, "/api/v1/futures/tpsl/position/place_order")
  assert.deepEqual(requests[0].body, {
    symbol: "BTCUSDT",
    positionId: "position-1",
    tpPrice: "70000.12345678",
    tpStopType: "MARK_PRICE",
  })
})

test("Bitunix Futures position TP/SL modification is confirmed by UPDATE NEW", async () => {
  const { broker, requests } = createBroker()

  const result = await modifyFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      slPrice: "65000.12345678",
      slStopType: "LAST_PRICE",
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.tpSlOutcome, "CONFIRMED")
  assert.equal(requests[0].path, "/api/v1/futures/tpsl/position/modify_order")
  assert.deepEqual(requests[0].body, {
    symbol: "BTCUSDT",
    positionId: "position-1",
    slPrice: "65000.12345678",
    slStopType: "LAST_PRICE",
  })
})

test("Bitunix Futures position TP/SL cancellation is confirmed only by CLOSE CANCELED", async () => {
  const { broker, requests } = createBroker({
    eventStatus: "CANCELED",
  })

  const result = await cancelFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      orderId: "tpsl-1",
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(result.tpSlOutcome, "CANCELED")
  assert.equal(requests[0].path, "/api/v1/futures/tpsl/cancel_order")
  assert.deepEqual(requests[0].body, {
    symbol: "BTCUSDT",
    orderId: "tpsl-1",
  })
})

test("Bitunix Futures TP/SL CLOSE FILLED reports trigger placement, not child-order fill", async () => {
  const { broker } = createBroker({
    eventStatus: "FILLED",
  })

  const result = await cancelFuturesTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      orderId: "tpsl-1",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.cancellationOutcome, "NOT_CANCELED")
  assert.equal(result.tpSlOutcome, "TRIGGERED")
  assert.equal(result.childOrderFillOutcome, "UNKNOWN")
})

test("Bitunix Futures position TP/SL preserves an unknown mutation outcome after a lost acknowledgement", async () => {
  const dispatchError = Object.assign(new TypeError("socket closed after dispatch"), {
    outcomeUnknown: true,
  })
  const { broker } = createBroker({
    dispatchError,
  })

  const result = await placeFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      slPrice: "65000",
      slStopType: "MARK_PRICE",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.tpSlOutcome, "CONFIRMED")
})

test("Bitunix Futures position TP/SL reports unknown when the private confirmation event is missing", async () => {
  const { broker, requests } = createBroker({
    emitEvent: false,
  })

  const result = await placeFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      tpPrice: "70000",
      tpStopType: "MARK_PRICE",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.tpSlOutcome, "UNKNOWN")
  assert.equal(requests.length, 1)
})

test("Bitunix Futures position TP/SL is NOT_SENT when the position is no longer open", async () => {
  const { broker, requests } = createBroker({
    positionExists: false,
  })

  const result = await placeFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      tpPrice: "70000",
      tpStopType: "MARK_PRICE",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures position TP/SL rejects trigger prices above symbol precision", async () => {
  const { broker, requests } = createBroker({
    quotePrecision: 4,
  })

  const result = await placeFuturesPositionTpSlOrder({
    broker,
    input: {
      symbol: "BTCUSDT",
      positionId: "position-1",
      tpPrice: "70000.12345",
      tpStopType: "MARK_PRICE",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})
