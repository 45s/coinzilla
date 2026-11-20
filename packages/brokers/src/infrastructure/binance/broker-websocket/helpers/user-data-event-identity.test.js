import assert from "node:assert/strict"
import test from "node:test"
import { getUserDataEventIdentity } from "./user-data-event-identity.js"

test("execution reports use symbol, order ID, and execution ID", () => {
  const message = {
    subscriptionId: 4,
    event: {
      e: "executionReport",
      s: "BTCUSDT",
      i: 10,
      I: 21,
      X: "PARTIALLY_FILLED",
    },
  }
  assert.equal(getUserDataEventIdentity(message), "executionReport:BTCUSDT:10:21")
  assert.equal(getUserDataEventIdentity(structuredClone(message)), "executionReport:BTCUSDT:10:21")
  assert.equal(getUserDataEventIdentity({
    ...message,
    event: {
      ...message.event,
      I: 22,
    },
  }), "executionReport:BTCUSDT:10:22")
})

test("events without a stable ID use exact serialized payload identity", () => {
  const message = {
    subscriptionId: 3,
    event: {
      e: "balanceUpdate",
      a: "USDT",
      d: "2.50",
      T: 100,
      E: 101,
    },
  }
  assert.equal(getUserDataEventIdentity(message), ["payload:", JSON.stringify(message.event)].join(""))
  assert.equal(getUserDataEventIdentity({
    ...message,
    event: {
      ...message.event,
      d: "3.50",
    },
  }), ["payload:", JSON.stringify({
    ...message.event,
    d: "3.50",
  })].join(""))
})

test("invalid messages and cyclic payloads return no identity", () => {
  assert.equal(getUserDataEventIdentity(null), null)
  assert.equal(getUserDataEventIdentity({ event: [] }), null)
  const event = {}
  event.self = event
  assert.equal(getUserDataEventIdentity(event), null)
})
