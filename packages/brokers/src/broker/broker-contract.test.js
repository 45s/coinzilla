import assert from "node:assert/strict"
import test from "node:test"

import {
  assertBrokerContract,
  BROKER_COMPATIBILITY_METHODS,
  BROKER_METHODS,
  BROKER_MUTATION_OUTCOMES,
  getBrokerMutationOutcome,
} from "./broker-contract.js"
import { BinanceWebSocketBroker } from "../infrastructure/binance/spot/broker-websocket/broker.js"
import { BitunixSpotBroker } from "../infrastructure/bitunix/spot/broker.js"

function createBrokers() {
  return [
    new BinanceWebSocketBroker({
      apiKey: "contract-test-key",
      apiSecret: "contract-test-secret",
      tradingMode: "testnet",
    }),
    new BitunixSpotBroker({
      apiKey: "contract-test-key",
      apiSecret: "contract-test-secret",
      tradingMode: "live",
    }),
  ]
}

test("Binance and Bitunix satisfy the same structural Broker contract", () => {
  for (const broker of createBrokers()) {
    assert.equal(assertBrokerContract({ broker }), broker)
  }
})

test("the common contract includes every operation with explicit unsupported behavior", () => {
  assert.ok(BROKER_METHODS.includes("getAccountSnapshot"))
  assert.ok(BROKER_METHODS.includes("getCanonicalOrder"))
  assert.ok(BROKER_METHODS.includes("getCanonicalOrderHistory"))
  assert.ok(BROKER_METHODS.includes("getFills"))
  assert.ok(BROKER_METHODS.includes("createCanonicalOrder"))
  assert.ok(BROKER_METHODS.includes("subscribeForCandles"))
  assert.ok(BROKER_COMPATIBILITY_METHODS.includes("getOrderHistory"))
  assert.ok(BROKER_COMPATIBILITY_METHODS.includes("getSymbolFilters"))
})

test("mutation outcomes distinguish local rejection from uncertain exchange results", () => {
  assert.deepEqual(BROKER_MUTATION_OUTCOMES, [
    "NOT_SENT",
    "REJECTED",
    "CONFIRMED",
    "OUTCOME_UNKNOWN",
  ])
})

test("assertBrokerContract reports all missing methods", () => {
  assert.throws(
    () => assertBrokerContract({ broker: {} }),
    /connect, disconnect, getBalances/,
  )
  assert.throws(
    () => assertBrokerContract({ broker: null }),
    /must be an object/,
  )
})

test("mutation outcome classification preserves unknown dispatch and explicit rejection", () => {
  assert.equal(
    getBrokerMutationOutcome({ error: new TypeError("invalid input") }),
    "NOT_SENT",
  )
  assert.equal(
    getBrokerMutationOutcome({
      error: new Error("request rejected after dispatch"),
      requestDispatched: true,
    }),
    "OUTCOME_UNKNOWN",
  )
  assert.equal(
    getBrokerMutationOutcome({
      error: Object.assign(new Error("connection not open"), {
        outcomeUnknown: false,
      }),
      requestDispatched: true,
    }),
    "NOT_SENT",
  )
  assert.equal(
    getBrokerMutationOutcome({
      error: {
        status: 400,
        outcomeUnknown: false,
      },
    }),
    "REJECTED",
  )
  assert.equal(
    getBrokerMutationOutcome({
      error: {
        status: 500,
        outcomeUnknown: false,
      },
    }),
    "OUTCOME_UNKNOWN",
  )
  assert.equal(
    getBrokerMutationOutcome({
      error: {
        status: 409,
        outcomeUnknown: false,
      },
    }),
    "OUTCOME_UNKNOWN",
  )
  assert.equal(
    getBrokerMutationOutcome({
      error: {
        status: 408,
        outcomeUnknown: false,
      },
    }),
    "OUTCOME_UNKNOWN",
  )
})

test("Broker contract is structural and does not require CoreBroker inheritance", () => {
  const methodNames = [
    ...BROKER_METHODS,
    ...BROKER_COMPATIBILITY_METHODS,
  ]
  const broker = Object.fromEntries(methodNames.map((method) => [
    method,
    async () => {},
  ]))

  assert.equal(assertBrokerContract({ broker }), broker)
})
