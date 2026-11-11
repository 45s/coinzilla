import test from "node:test"
import assert from "node:assert/strict"
import { assertBrokerPort, BROKER_PORT_METHODS } from "./broker.port.js"

test("accepts an implementation of the complete Harvester broker port", () => {
  const broker = Object.fromEntries(BROKER_PORT_METHODS.map((method) => [method, () => {}]))
  assert.equal(assertBrokerPort({ broker }), broker)
})

test("requires the historical and live candle capabilities for market-data consumers", () => {
  assert.ok(
    BROKER_PORT_METHODS.includes("getCandles"),
    "The application broker port must require historical candle retrieval before Harvester can consume volatility history.",
  )
  assert.ok(
    BROKER_PORT_METHODS.includes("subscribeForCandles"),
    "The application broker port must require live candle subscriptions before Harvester can maintain volatility history.",
  )
})

test("reports missing port methods at composition time", () => {
  assert.throws(
    () => assertBrokerPort({ broker: { connect() {} } }),
    /missing methods/,
  )
})

test("rejects a non-object broker", () => {
  assert.throws(() => assertBrokerPort({ broker: null }), /must be an object/)
})
