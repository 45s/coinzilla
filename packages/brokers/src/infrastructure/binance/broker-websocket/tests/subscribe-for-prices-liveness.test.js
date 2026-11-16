import assert from "node:assert/strict"
import test from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"
import { FakeClock } from "../test-helpers/fake-clock.js"
import { flush } from "../test-helpers/streams-client-fixtures.js"

function createBroker(dependencies = {}) {
  const streams = createFakeStreamsClient()
  const broker = new BinanceSdkBroker({
    apiKey: "test",
    apiSecret: "test",
    tradingMode: "testnet",
  }, {
    marketClientFactory: () => streams,
    ...dependencies,
  })
  return {
    broker,
    streams,
  }
}

function createAggTrade(lastTradeId) {
  return {
    e: "aggTrade",
    E: 100,
    T: 100,
    s: "BTCUSDT",
    p: "65000.10",
    q: "0.25",
    m: true,
    M: false,
    a: 10,
    f: lastTradeId,
    l: lastTradeId,
  }
}

function createRollingTicker(lastTradeId) {
  return {
    e: "1hTicker",
    E: 150,
    s: "BTCUSDT",
    L: lastTradeId,
  }
}

test("uses ticker trade IDs to detect and resubscribe a stalled aggTrade stream", async () => {
  const clock = new FakeClock()
  const { broker, streams } = createBroker({
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    nowFn: () => clock.now,
    marketStreamStallTimeoutMs: 50,
  })
  broker.connected = true
  const result = await broker.subscribeForPrices({
    symbol: "BTCUSDT",
    onPrice: () => {},
  })

  assert.equal(result.ok, true)
  assert.deepEqual(
    streams.calls,
    [
      {
        method: "subscribe",
        stream: "btcusdt@aggTrade",
      },
      {
        method: "subscribe",
        stream: "!ticker_1h@arr",
      },
    ],
    "price subscriptions must include one independent all-market ticker activity stream",
  )

  streams.emit("btcusdt@aggTrade", createAggTrade(10))
  streams.emit("!ticker_1h@arr", createRollingTicker(11))
  clock.advanceBy(49)
  assert.equal(
    streams.calls.length,
    2,
    "the broker must allow a grace period for the matching aggregate trade event",
  )
  clock.advanceBy(1)
  await flush()

  assert.deepEqual(
    streams.calls.slice(2),
    [
      {
        method: "unsubscribe",
        stream: "btcusdt@aggTrade",
      },
      { method: "subscribe",
        stream: "btcusdt@aggTrade" },
    ],
    "only the stalled symbol's aggTrade stream must be resubscribed",
  )

  streams.emit("btcusdt@aggTrade", createAggTrade(11))
  await result.data.unsubscribe()
  assert.equal(
    streams.listenerCount,
    0,
    "unsubscribing a price feed must remove both aggTrade and shared ticker listeners",
  )
})
