import assert from "node:assert/strict"
import test from "node:test"

import {
  createStreamName,
  parseStreamMessage,
  validateStreamName,
} from "./streams-protocol.js"

test("validates supported raw and all-market stream names", () => {
  for (const stream of [
    "btcusdt@aggTrade",
    "ethusdt@trade",
    "btcusdt@kline_1m",
    "btcusdt@kline_1M",
    "btcusdt@miniTicker",
    "btcusdt@ticker",
    "btcusdt@ticker_4h",
    "btcusdt@bookTicker",
    "btcusdt@depth5@100ms",
    "btcusdt@depth@1000ms",
    "!miniTicker@arr",
    "!ticker@arr",
    "!ticker_1d@arr",
  ]) {
    assert.equal(validateStreamName(stream), stream)
  }
})

test("rejects malformed and unsupported stream names", () => {
  for (const stream of [
    "",
    " BTCUSDT@aggTrade",
    "btcusdt@unknown",
    "btcusdt@kline_2m",
    "btcusdt@ticker_2h",
    "btcusdt@depth15@100ms",
    "!trade@arr",
    "btcusdt@aggTrade/ethusdt@aggTrade",
  ]) {
    assert.throws(() => validateStreamName(stream), TypeError, stream)
  }
})

test("builds stream names and normalizes symbols to lowercase", () => {
  assert.equal(createStreamName("aggTrade", { symbol: "BTCUSDT" }), "btcusdt@aggTrade")
  assert.equal(createStreamName("trade", { symbol: "ETHUSDT" }), "ethusdt@trade")
  assert.equal(createStreamName("kline", { symbol: "BTCUSDT", interval: "1m" }), "btcusdt@kline_1m")
  assert.equal(createStreamName("miniTicker"), "!miniTicker@arr")
  assert.equal(createStreamName("miniTicker", { symbol: null }), "!miniTicker@arr")
  assert.equal(createStreamName("aggTrade", { symbol: "btcusdt" }), "btcusdt@aggTrade")
  assert.equal(createStreamName("ticker", { symbol: "BTCUSDT" }), "btcusdt@ticker")
  assert.equal(createStreamName("rollingWindowTicker", { windowSize: "4h" }), "!ticker_4h@arr")
  assert.equal(createStreamName("partialBookDepth", { symbol: "BTCUSDT", levels: 10, speed: "100ms" }), "btcusdt@depth10@100ms")
  assert.equal(createStreamName("diffBookDepth", { symbol: "BTCUSDT", speed: "1000ms" }), "btcusdt@depth@1000ms")
})

test("requires the parameters needed by each stream type", () => {
  assert.throws(() => createStreamName("aggTrade"), /symbol is required/)
  assert.throws(() => createStreamName("bookTicker"), /symbol is required/)
  assert.throws(() => createStreamName("kline", { symbol: "BTCUSDT" }), /interval/)
  assert.throws(() => createStreamName("rollingWindowTicker", { windowSize: "2h" }), /windowSize/)
  assert.throws(() => createStreamName("partialBookDepth", { symbol: "BTCUSDT", levels: 15, speed: "100ms" }), /levels/)
  assert.throws(() => createStreamName("diffBookDepth", { symbol: "BTCUSDT", speed: "1s" }), /speed/)
  assert.throws(() => createStreamName("notAStream", {}), /Unsupported/)
  assert.throws(() => createStreamName("aggTrade", { symbol: "BTC-USDT" }), /symbol/)
})

test("parses raw event messages", () => {
  const data = { e: "aggTrade", s: "BTCUSDT", p: "65000.10" }
  assert.deepEqual(parseStreamMessage(JSON.stringify(data)), { stream: null, data })
})

test("unwraps combined-stream envelopes without changing payload data", () => {
  const data = { e: "aggTrade", s: "BTCUSDT", p: "65000.10" }
  assert.deepEqual(parseStreamMessage({ stream: "btcusdt@aggTrade", data }), {
    stream: "btcusdt@aggTrade",
    data,
  })
})

test("identifies subscription acknowledgements and raw/combined server shutdown events", () => {
  assert.deepEqual(parseStreamMessage({ id: 12, result: null }), {
    acknowledgement: { id: 12, result: null },
  })
  assert.deepEqual(parseStreamMessage({ e: "serverShutdown", E: 123 }), {
    serverShutdown: true,
    data: { e: "serverShutdown", E: 123 },
  })
  assert.deepEqual(parseStreamMessage({
    stream: "!serverShutdown",
    data: { e: "serverShutdown", E: 123 },
  }), {
    serverShutdown: true,
    data: { e: "serverShutdown", E: 123 },
  })
  assert.deepEqual(parseStreamMessage([
    { e: "24hrMiniTicker", s: "BTCUSDT" },
    { e: "24hrMiniTicker", s: "ETHUSDT" },
  ]), {
    stream: null,
    data: [
      { e: "24hrMiniTicker", s: "BTCUSDT" },
      { e: "24hrMiniTicker", s: "ETHUSDT" },
    ],
  })
})

test("rejects malformed JSON, envelopes, and raw events", () => {
  assert.throws(() => parseStreamMessage("{"), /valid JSON/)
  assert.throws(() => parseStreamMessage(null), /must be an object/)
  assert.throws(() => parseStreamMessage({ stream: "bad", data: {} }), /Unsupported/)
  assert.throws(() => parseStreamMessage({ e: "" }), /event type/)
})
