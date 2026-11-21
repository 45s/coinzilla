import assert from "node:assert/strict"
import test from "node:test"
import {
  assertBitunixOperatorAttemptDependencies,
  assertBitunixMutationBroker,
  assertBitunixOperatorInteractiveTerminal,
} from "./operator-order-validation.js"

test("operator terminal gate refuses non-interactive execution", () => {
  assert.throws(() => assertBitunixOperatorInteractiveTerminal({
    stdin: {
      isTTY: false,
    },
    stdout: {
      isTTY: true,
    },
  }), /interactive terminal/, "LIVE order command requires both terminal streams")
  assert.doesNotThrow(() => assertBitunixOperatorInteractiveTerminal({
    stdin: {
      isTTY: true,
    },
    stdout: {
      isTTY: true,
    },
  }), "interactive terminal should pass")
})

test("mutation Broker validator requires the complete mutation surface", () => {
  assert.doesNotThrow(() => assertBitunixMutationBroker({
    broker: {
      connect() {},
      createOrder() {},
      disconnect() {},
    },
  }), "complete mutation Broker should pass")
  assert.throws(() => assertBitunixMutationBroker({
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
  assert.doesNotThrow(() => assertBitunixOperatorAttemptDependencies({
    readBroker,
    createOrderBroker() {},
    confirm() {},
    createMarker() {},
    writeLine() {},
  }), "complete operator workflow dependencies should pass")
  assert.throws(() => assertBitunixOperatorAttemptDependencies({
    readBroker: {},
    createOrderBroker() {},
    confirm() {},
    createMarker() {},
    writeLine() {},
  }), /read Broker/, "missing read methods must fail")
  assert.throws(() => assertBitunixOperatorAttemptDependencies({
    readBroker,
    createOrderBroker: null,
    confirm() {},
    createMarker() {},
    writeLine() {},
  }), /createOrderBroker/, "missing mutation Broker factory must fail")
})
