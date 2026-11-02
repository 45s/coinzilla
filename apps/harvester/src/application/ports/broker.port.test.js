import test from "node:test"
import assert from "node:assert/strict"
import { assertBrokerPort, BROKER_PORT_METHODS } from "./broker.port.js"

test("accepts an implementation of the complete Harvester broker port", () => {
  const broker = Object.fromEntries(BROKER_PORT_METHODS.map((method) => [method, () => {}]))
  assert.equal(assertBrokerPort({ broker }), broker)
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
