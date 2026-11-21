import assert from "node:assert/strict"
import test from "node:test"
import {
  assertInteractiveTerminal,
  assertMutationBroker,
  assertOrderAttemptDependencies,
} from "./validate-order-attempt.js"

test("operator terminal gate refuses non-interactive execution", () => {
  assert.throws(() => assertInteractiveTerminal({
    stdin: {
      isTTY: false,
    },
    stdout: {
      isTTY: true,
    },
  }), /interactive terminal/, "LIVE order command requires both terminal streams")
  assert.doesNotThrow(() => assertInteractiveTerminal({
    stdin: {
      isTTY: true,
    },
    stdout: {
      isTTY: true,
    },
  }), "interactive terminal should pass")
})

test("mutation Broker validator requires the complete mutation surface", () => {
  assert.doesNotThrow(() => assertMutationBroker({
    broker: {
      connect() {},
      createOrder() {},
      disconnect() {},
    },
  }), "complete mutation Broker should pass")
  assert.throws(() => assertMutationBroker({
    broker: {
      connect() {},
      disconnect() {},
    },
  }), /createOrder/, "missing createOrder must fail before dispatch")
})

test("operator dependency validator requires read and mutation workflow ports", () => {
  const readBroker = {
    connect() {},
    getExchangeMarkets() {},
    getSymbolFilters() {},
    getBalances() {},
    getOpenOrders() {},
    disconnect() {},
  }
  assert.doesNotThrow(() => assertOrderAttemptDependencies({
    readBroker,
    createOrderBroker() {},
    confirm() {},
    createMarker() {},
    writeLine() {},
  }), "complete operator workflow dependencies should pass")
  assert.throws(() => assertOrderAttemptDependencies({
    readBroker: {},
    createOrderBroker() {},
    confirm() {},
    createMarker() {},
    writeLine() {},
  }), /read Broker/, "missing read methods must fail")
  assert.throws(() => assertOrderAttemptDependencies({
    readBroker,
    createOrderBroker: null,
    confirm() {},
    createMarker() {},
    writeLine() {},
  }), /createOrderBroker/, "missing mutation Broker factory must fail")
})
