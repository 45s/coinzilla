import assert from "node:assert/strict"
import test from "node:test"

import { adaptOrderRequestParams } from "./order-request-params.js"

test("applies Binance order defaults without changing other input fields", () => {
  assert.deepEqual(adaptOrderRequestParams({
    input: { symbol: "BTCUSDT", quantity: "0.01", price: "50000" },
  }), {
    symbol: "BTCUSDT",
    quantity: "0.01",
    price: "50000",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
  })
})

test("maps optional clientOrderId to newClientOrderId only when supplied", () => {
  assert.deepEqual(adaptOrderRequestParams({
    input: { symbol: "BTCUSDT", clientOrderId: "client-123" },
  }), {
    symbol: "BTCUSDT",
    newClientOrderId: "client-123",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
  })
  assert.deepEqual(adaptOrderRequestParams({
    input: { symbol: "BTCUSDT", clientOrderId: "" },
  }), {
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
  })
})

test("omits timeInForce for LIMIT_MAKER even when the input contains one", () => {
  assert.deepEqual(adaptOrderRequestParams({
    input: {
      symbol: "BTCUSDT",
      type: "LIMIT_MAKER",
      timeInForce: "IOC",
      quantity: "1",
      price: "100",
    },
  }), {
    symbol: "BTCUSDT",
    type: "LIMIT_MAKER",
    quantity: "1",
    price: "100",
    side: "BUY",
  })
})

test("preserves explicit side, type, timeInForce, and canonical client order ID", () => {
  assert.deepEqual(adaptOrderRequestParams({
    input: {
      symbol: "BTCUSDT",
      clientOrderId: "canonical-123",
      side: "SELL",
      type: "LIMIT",
      timeInForce: "IOC",
      quantity: "2",
      price: "100",
    },
    clientOrderId: "canonical-123",
    requireClientOrderId: true,
  }), {
    symbol: "BTCUSDT",
    newClientOrderId: "canonical-123",
    side: "SELL",
    type: "LIMIT",
    timeInForce: "IOC",
    quantity: "2",
    price: "100",
  })
})
