import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import {
  createPrivateOrderEventWaiter,
  createPrivateOrderEventsWaiter,
  matchesPrivateOrderCancellationEvent,
  matchesPrivateOrderEventIdentity,
} from "./private-order-event-confirmation.js"

function createEvent(overrides = {}) {
  const symbol = overrides.symbol ?? "BTCUSDT"
  return {
    ch: "order",
    symbol,
    ts: 1_700_000_000_000,
    data: {
      orderId: "order-1",
      clientId: "client-1",
      symbol,
      event: "UPDATE",
      orderStatus: "NEW",
      ...overrides,
    },
  }
}

function createBroker({ timeoutMs = 10 } = {}) {
  return {
    isUserDataReady: true,
    privateEventTimeoutMs: timeoutMs,
    privateWebSocketClient: new EventEmitter(),
  }
}

test("private order-event identity requires channel, symbol and every supplied order identifier", () => {
  const event = createEvent()
  assert.equal(matchesPrivateOrderEventIdentity({
    event,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  }), true, "an order event with matching exchange and client identities must match")
  assert.equal(matchesPrivateOrderEventIdentity({
    event,
    orderId: "order-2",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  }), false, "a different exchange order ID must not match")
  assert.equal(matchesPrivateOrderEventIdentity({
    event,
    orderId: "order-1",
    clientOrderId: "client-2",
    symbol: "BTCUSDT",
  }), false, "a different client order ID must not match")
  assert.equal(matchesPrivateOrderEventIdentity({
    event,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "ETHUSDT",
  }), false, "an event for another market must not match")
  assert.equal(matchesPrivateOrderEventIdentity({
    event: {
      ...event,
      ch: "position",
    },
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  }), false, "position events must not satisfy order mutation confirmation")
})

test("private order-event waiter resolves on a matching event and removes its listeners", async () => {
  const broker = createBroker()
  const waiter = createPrivateOrderEventWaiter({
    broker,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  })
  broker.privateWebSocketClient.emit("channel", createEvent({
    orderId: "other-order",
    clientId: "other-client",
  }))
  const matchingEvent = createEvent()
  broker.privateWebSocketClient.emit("channel", matchingEvent)
  const result = await waiter.promise

  assert.strictEqual(result.event, matchingEvent, "the waiter must resolve with the exact matching private event")
  assert.equal(result.error, null, "a matching private event must not produce a timeout or disconnect error")
  assert.equal(broker.privateWebSocketClient.listenerCount("channel"), 0, "the channel listener must be removed after resolution")
  assert.equal(broker.privateWebSocketClient.listenerCount("status"), 0, "the status listener must be removed after resolution")
})

test("private order-event waiter returns an explicit error when the private session becomes unavailable", async () => {
  const broker = createBroker()
  const waiter = createPrivateOrderEventWaiter({
    broker,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  })
  broker.privateWebSocketClient.emit("status", {
    state: "closed",
    authenticated: false,
    recoveryRequired: true,
  })
  const result = await waiter.promise

  assert.equal(result.event, null, "a disconnected private session cannot confirm an order mutation")
  assert.match(result.error.message, /session became unavailable/i, "the result must explain why event confirmation ended")
  assert.equal(broker.privateWebSocketClient.listenerCount("channel"), 0, "the channel listener must be removed after disconnect")
  assert.equal(broker.privateWebSocketClient.listenerCount("status"), 0, "the status listener must be removed after disconnect")
})

test("private order-event waiter times out and releases its listeners", async () => {
  const broker = createBroker({
    timeoutMs: 5,
  })
  const waiter = createPrivateOrderEventWaiter({
    broker,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  })
  waiter.startTimeout()
  const result = await waiter.promise

  assert.equal(result.event, null, "a missing private event must not confirm a mutation")
  assert.match(result.error.message, /timed out/i, "the timeout result must be diagnosable")
  assert.equal(broker.privateWebSocketClient.listenerCount("channel"), 0, "the channel listener must be removed after timeout")
  assert.equal(broker.privateWebSocketClient.listenerCount("status"), 0, "the status listener must be removed after timeout")
})

test("private order-event waiter can be canceled without leaving a pending listener", async () => {
  const broker = createBroker()
  const waiter = createPrivateOrderEventWaiter({
    broker,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  })
  waiter.cancel()
  const result = await waiter.promise

  assert.equal(result.event, null, "canceling a waiter must not fabricate an event")
  assert.equal(result.error, null, "intentional waiter cleanup must not be treated as a timeout")
  assert.equal(broker.privateWebSocketClient.listenerCount("channel"), 0, "canceling must remove the channel listener")
  assert.equal(broker.privateWebSocketClient.listenerCount("status"), 0, "canceling must remove the status listener")
})


test("private order-event waiter starts its timeout only after the request phase asks it to wait", async () => {
  const broker = createBroker({
    timeoutMs: 5,
  })
  const waiter = createPrivateOrderEventWaiter({
    broker,
    orderId: "order-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
  })
  let settled = false
  waiter.promise.then(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(settled, false, "the event listener must remain active while the REST request is still in flight")
  waiter.startTimeout()
  const result = await waiter.promise
  assert.equal(result.event, null, "the explicit wait phase must still time out when no matching event arrives")
  assert.match(result.error.message, /timed out/i, "the explicit timeout must remain diagnosable")
})


test("private cancellation event matching accepts only CLOSE events with canceled terminal status", () => {
  const order = {
    orderId: "order-1",
    clientId: "client-1",
    symbol: "BTCUSDT",
  }
  assert.equal(matchesPrivateOrderCancellationEvent({
    event: createEvent({
      event: "CLOSE",
      orderStatus: "CANCELED",
    }),
    order,
  }), true, "a matching CLOSE/CANCELED event must confirm cancellation")
  assert.equal(matchesPrivateOrderCancellationEvent({
    event: createEvent({
      event: "CLOSE",
      orderStatus: "PART_FILLED_CANCELED",
    }),
    order,
  }), true, "a matching partially-filled cancellation event must confirm cancellation")
  assert.equal(matchesPrivateOrderCancellationEvent({
    event: createEvent({
      event: "CLOSE",
      orderStatus: "FILLED",
    }),
    order,
  }), false, "a FILLED event must not be treated as cancellation")
  assert.equal(matchesPrivateOrderCancellationEvent({
    event: createEvent({
      event: "UPDATE",
      orderStatus: "CANCELED",
    }),
    order,
  }), false, "an UPDATE event must not be treated as a CLOSE event")
})

test("private multi-order waiter resolves only after every unique order identity is observed", async () => {
  const broker = createBroker()
  const orders = [
    {
      orderId: "order-1",
      clientId: "client-1",
      symbol: "BTCUSDT",
    },
    {
      orderId: "order-2",
      clientId: "client-2",
      symbol: "ETHUSDT",
    },
  ]
  const waiter = createPrivateOrderEventsWaiter({
    broker,
    orders,
  })
  const firstEvent = createEvent({
    event: "CLOSE",
    orderStatus: "CANCELED",
  })
  const secondEvent = createEvent({
    orderId: "order-2",
    clientId: "client-2",
    symbol: "ETHUSDT",
    event: "CLOSE",
    orderStatus: "CANCELED",
  })
  broker.privateWebSocketClient.emit("channel", firstEvent)
  broker.privateWebSocketClient.emit("channel", firstEvent)
  broker.privateWebSocketClient.emit("channel", secondEvent)
  const result = await waiter.promise

  assert.equal(result.events.length, 2, "each expected order must contribute exactly one matched event")
  assert.equal(result.missingOrders.length, 0, "all expected order identities must be reconciled")
  assert.strictEqual(result.events[0].event, firstEvent, "the first order event must remain correlated to its order")
  assert.strictEqual(result.events[1].event, secondEvent, "the second order event must remain correlated to its order")
  assert.equal(result.error, null, "complete private event coverage must not report a timeout")
})

test("private multi-order waiter returns partial observations and missing identities on timeout", async () => {
  const broker = createBroker({
    timeoutMs: 5,
  })
  const orders = [
    {
      orderId: "order-1",
      clientId: "client-1",
      symbol: "BTCUSDT",
    },
    {
      orderId: "order-2",
      clientId: "client-2",
      symbol: "ETHUSDT",
    },
  ]
  const waiter = createPrivateOrderEventsWaiter({
    broker,
    orders,
  })
  broker.privateWebSocketClient.emit("channel", createEvent({
    event: "CLOSE",
    orderStatus: "CANCELED",
  }))
  waiter.startTimeout()
  const result = await waiter.promise

  assert.equal(result.events.length, 1, "the waiter must preserve the private event already received")
  assert.equal(result.missingOrders.length, 1, "the waiter must identify every order without a matching event")
  assert.equal(result.missingOrders[0].orderId, "order-2", "the missing order identity must be explicit")
  assert.match(result.error.message, /timed out/i, "partial event coverage must report the timeout")
})
