import assert from "node:assert/strict"
import test from "node:test"
import { loadMarketHistory } from "../src/application/load-market-history.js"
import { createPriceStream } from "../src/application/create-price-stream.js"
import { JsonMarketHistoryRepository } from "../src/infrastructure/json-market-history-repository.js"
import { validateMarketHistory } from "../src/domain/market-history.js"

const history = {
  symbol: "DOGEUSDT",
  interval: "1m",
  history: [
    { timestamp: 1000, open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" },
    { timestamp: 61000, open: "1.5", high: "2", low: "1", close: "1.75", volume: "12" },
  ],
}

test("domain validation is pure and freezes the validated history", () => {
  const validated = validateMarketHistory(history)
  assert.equal(validated.history.length, 2)
  assert.equal(Object.isFrozen(validated), true)
  assert.equal(Object.isFrozen(validated.history[0]), true)
  assert.throws(() => validateMarketHistory({ ...history, history: [] }), /at least one candle/)
})

test("load history use case depends only on the repository port", async () => {
  const calls = []
  const repository = { async load() { calls.push("load"); return history } }
  assert.equal(await loadMarketHistory({ repository }), history)
  assert.deepEqual(calls, ["load"])
  await assert.rejects(loadMarketHistory({ repository: {} }), /repository with load/)
})

test("JSON repository validates supplied history without filesystem access", async () => {
  const repository = new JsonMarketHistoryRepository({ history })
  const loaded = await repository.load()
  assert.equal(loaded.symbol, "DOGEUSDT")
  assert.equal(loaded.history.length, 2)
})

test("price stream emits immediately, schedules subsequent candles and resolves on completion", async () => {
  const timers = []
  const events = []
  const scheduler = {
    schedule(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer },
    cancel(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1) },
  }
  const playback = createPriceStream({
    history: validateMarketHistory(history),
    symbol: "DOGEUSDT",
    speed: 60,
    scheduler,
    onPrice: (event) => events.push(event),
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].price, "1.5")
  assert.equal(timers[0].delay, 1000)
  timers.shift().callback()
  assert.equal(events.length, 2)
  await playback.done
  assert.equal(playback.active, false)
  assert.equal(timers.length, 0)
})

test("unsubscribe cancels scheduled work and resolves completion", async () => {
  let cancelled = false
  const playback = createPriceStream({
    history: validateMarketHistory(history),
    symbol: "DOGEUSDT",
    speed: 1,
    scheduler: { schedule() { return 42 }, cancel(handle) { cancelled = handle === 42 } },
    onPrice() {},
  })
  playback.unsubscribe()
  await playback.done
  assert.equal(cancelled, true)
  assert.equal(playback.active, false)
})
