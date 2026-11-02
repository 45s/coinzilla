import assert from "node:assert/strict"
import test from "node:test"
import { HistoricalMarketBroker, validateMarketHistory } from "../src/historical-market-broker.js"

const history = {
  exchange: "Binance",
  symbol: "DOGEUSDT",
  interval: "1m",
  data_points: 2,
  history: [
    { timestamp: 1700000000000, open: "0.07100000", high: "0.07200000", low: "0.07000000", close: "0.07150000", volume: "123.45000000", close_time: 1700000059999, quote_volume: "8.8", trades: 4 },
    { timestamp: 1700000060000, open: "0.07150000", high: "0.07300000", low: "0.07100000", close: "0.07250000", volume: "456.78000000", close_time: 1700000119999, quote_volume: "33.1", trades: 8 },
  ],
}

function createTimers() {
  const timers = new Map()
  let id = 0
  return {
    timers,
    setTimeoutFn(callback, delay) {
      const timerId = ++id
      timers.set(timerId, { callback, delay })
      return timerId
    },
    clearTimeoutFn(timerId) { timers.delete(timerId) },
  }
}

test("loads the repository DOGE history with all 10,080 candles", async () => {
  const broker = new HistoricalMarketBroker()
  await broker.connect()
  assert.equal(broker.history.symbol, "DOGEUSDT")
  assert.equal(broker.history.interval, "1m")
  assert.equal(broker.history.history.length, 10080)
  assert.equal(broker.history.history[0].close, "0.08478000")
  assert.equal(broker.history.history.at(-1).close, "0.08135000")
  await broker.disconnect()
})

test("implements CoreBroker price subscription and emits historical candle closes", async () => {
  const timers = createTimers()
  const broker = new HistoricalMarketBroker({
    history, speed: 60,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })
  const received = []
  await broker.connect()
  const result = await broker.subscribeForPrices({ symbol: "DOGEUSDT", onPrice: (event) => received.push(event) })

  assert.equal(result.ok, true)
  assert.equal(result.data.stream, "dogeusdt@kline_1m")
  assert.equal(received.length, 1)
  assert.equal(received[0].price, "0.07150000")
  assert.equal(received[0].eventType, "kline")
  assert.equal(timers.timers.size, 1)
  assert.equal(timers.timers.values().next().value.delay, 1000)

  const nextTimer = timers.timers.values().next().value
  timers.timers.clear()
  nextTimer.callback()

  assert.equal(received.length, 2)
  assert.equal(received[1].price, "0.07250000")
  assert.equal(timers.timers.size, 0)
  assert.equal((await broker.getPrices({ symbol: "DOGEUSDT" })).data.price, "0.07250000")
  await result.data.unsubscribe()
  await broker.disconnect()
})

test("rejects unsupported symbols and invalid callbacks", async () => {
  const broker = new HistoricalMarketBroker({ history })
  await broker.connect()
  assert.equal((await broker.subscribeForPrices({ symbol: "BTCUSDT", onPrice() {} })).ok, false)
  assert.equal((await broker.subscribeForPrices({ symbol: "DOGEUSDT" })).ok, false)
  await broker.disconnect()
})

test("disconnect clears active subscription timers", async () => {
  const timers = createTimers()
  const broker = new HistoricalMarketBroker({ history, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  await broker.connect()
  await broker.subscribeForPrices({ symbol: "DOGEUSDT", onPrice() {} })
  assert.equal(timers.timers.size, 1)
  await broker.disconnect()
  assert.equal(timers.timers.size, 0)
  assert.equal(broker.connected, false)
})

test("validates history count and timestamp order", () => {
  assert.throws(() => validateMarketHistory({ ...history, data_points: 3 }), /does not match/)
  assert.throws(() => validateMarketHistory({ ...history, history: [...history.history].reverse() }), /non-ascending timestamp/)
})

test("isolates callback exceptions", async () => {
  const timers = createTimers()
  const broker = new HistoricalMarketBroker({ history, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  await broker.connect()
  const result = await broker.subscribeForPrices({ symbol: "DOGEUSDT", onPrice() { throw new Error("consumer failure") } })
  assert.equal(result.ok, true)
  assert.equal(timers.timers.size, 1)
  await broker.disconnect()
})
