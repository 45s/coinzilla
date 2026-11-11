import test from "node:test"
import assert from "node:assert/strict"
import { CanonicalOrder } from "@coinzilla/entities"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

function createBroker({ orderResponse, orderHandler, exchangeInfo } = {}) {
  const rpc = createFakeRpcClient({
    "order.place": orderHandler ?? (() => orderResponse),
    exchangeInfo: () => exchangeInfo ?? { symbols: [{
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      orderTypes: ["LIMIT", "LIMIT_MAKER"],
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01" },
        { filterType: "LOT_SIZE", stepSize: "0.00001" },
      ],
    }] },
    myFilters: () => ({ symbolFilters: [], exchangeFilters: [], assetFilters: [] }),
  })
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret", tradingMode: "testnet",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
  broker.tradingConnection = rpc
  broker.connected = true
  return { broker, rpc }
}

test("places a limit order and returns the canonical exchange order", async () => {
  const { broker, rpc } = createBroker({
    orderResponse: {
      orderId: 123,
      clientOrderId: "h-12345678901234567890123456789012",
      symbol: "BTCUSDT",
      type: "LIMIT_MAKER",
      side: "BUY",
      origQty: "0.01",
      executedQty: "0",
      price: "65000.10",
      status: "NEW",
      time: 1700000000000,
      updateTime: 1700000000001,
    },
  })

  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "h-12345678901234567890123456789012",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000.10",
  })

  assert.equal(result.ok, true)
  assert.ok(result.data instanceof CanonicalOrder)
  assert.equal(result.data.clientOrderId, "h-12345678901234567890123456789012")
  assert.equal(result.data.brokerOrderId, "123")
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.data.originalQuantity.amount, "0.01")
  assert.equal(result.data.limitPrice.amount, "65000.1")
  assert.equal(rpc.calls[0].method, "order.place")
  assert.equal(rpc.calls[0].params.newClientOrderId, "h-12345678901234567890123456789012")
})

test("rejects missing client order identity before an exchange request", async () => {
  const { broker, rpc } = createBroker({ orderResponse: {} })
  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /requires clientOrderId/)
  assert.equal(rpc.calls.length, 0)
})

test("blocks canonical order placement while user-data stream is unavailable", async () => {
  const { broker, rpc } = createBroker({ orderResponse: {} })
  broker.userDataUnavailable = true
  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "h-12345678901234567890123456789012",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /user-data stream is unavailable/)
  assert.equal(rpc.calls.length, 0)
})


test("requests RESULT details when placing LIMIT_MAKER instead of accepting Binance's minimal ACK", async () => {
  const minimalAcknowledgement = {
    symbol: "BTCUSDT",
    orderId: 456,
    orderListId: -1,
    clientOrderId: "h-limit-maker-result",
    transactTime: 1700000000000,
  }
  const completeResult = {
    ...minimalAcknowledgement,
    price: "65000.10",
    origQty: "0.01",
    executedQty: "0",
    cummulativeQuoteQty: "0",
    status: "NEW",
    timeInForce: "GTC",
    type: "LIMIT_MAKER",
    side: "BUY",
  }
  let receivedOrderParameters
  const { broker, rpc } = createBroker({
    orderHandler: (parameters) => {
      receivedOrderParameters = parameters
      return parameters.newOrderRespType === "RESULT"
        ? completeResult
        : minimalAcknowledgement
    },
  })

  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "h-limit-maker-result",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000.10",
  })

  assert.equal(receivedOrderParameters.newOrderRespType, "RESULT", "Canonical LIMIT_MAKER placement must explicitly request complete order facts because Binance otherwise defaults to the minimal ACK response.")
  assert.equal(result.ok, true, "A valid Binance RESULT acknowledgement must be normalized instead of being misclassified as a failed order submission.")
  assert.equal(result.data.type, "LIMIT_MAKER", "The canonical acknowledgement must preserve the exchange-accepted order type.")
  assert.equal(result.data.status, "OPEN", "The canonical acknowledgement must expose the accepted order lifecycle status.")
  assert.equal(result.data.brokerOrderId, "456", "The canonical acknowledgement must retain Binance's exchange-assigned order identity.")
  assert.equal(result.data.originalQuantity.amount, "0.01", "The canonical acknowledgement must preserve the exact original order quantity.")
  assert.equal(result.data.limitPrice.amount, "65000.1", "The canonical acknowledgement must preserve the exact limit price.")
  assert.equal(rpc.calls[0].method, "order.place", "Canonical order placement must remain a single state-changing Binance RPC.")
})


test("returns a definite Binance filter rejection without fabricating a canonical order", async () => {
  const rejection = Object.assign(new Error("Filter failure: PERCENT_PRICE_BY_SIDE"), { code: -1013 })
  const { broker, rpc } = createBroker({
    orderHandler: async () => { throw rejection },
  })

  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "h-12345678901234567890123456789032",
    side: "BUY",
    type: "LIMIT",
    quantity: "0.01",
    price: "70000.00",
  })

  assert.equal(result.ok, false, "A definite Binance filter rejection must remain a failed submission result.")
  assert.equal(result.errors[0], rejection, "The exchange rejection code and cause must be preserved for the application.")
  assert.equal(result.errors[0].outcomeUnknown, undefined, "A definite filter rejection must not be mislabeled as an unknown outcome.")
  assert.deepEqual(rpc.calls.map(({ method }) => method), ["order.place"], "No canonical order metadata lookup or follow-up order action is allowed after Binance definitively rejects the request.")
});
