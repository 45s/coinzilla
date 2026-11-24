import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import {
  createPrivateOrderEventWaiter,
  matchesPrivateOrderEventIdentity,
} from "./private-order-event-confirmation.js"

function createEvent(overrides = {}) {
  return {
    ch: "order",
    symbol: "BTCUSDT",
    ts: 1_700_000_000_000,
    data: {
      orderId: "order-1",
      clientId: "client-1",
      symbol: "BTCUSDT",
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
