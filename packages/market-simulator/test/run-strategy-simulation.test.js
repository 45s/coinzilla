import assert from "node:assert/strict"
import test from "node:test"
import { runStrategySimulation } from "../src/application/run-strategy-simulation.js"
import { SimulatedExecutionBroker } from "../src/adapters/simulated-execution-broker.js"

const history = {
  symbol: "DOGEUSDT", interval: "1m",
  history: [
    { timestamp: 1000, open: "1", high: "1.1", low: "0.9", close: "1", volume: "100" },
    { timestamp: 61000, open: "1", high: "1.2", low: "0.8", close: "1.1", volume: "100" },
  ],
}
function createTimers() {
  const timers = new Map()
  let id = 0
  return {
    timers,
    setTimeoutFn(callback) { const key = ++id; timers.set(key, callback); return key },
    clearTimeoutFn(key) { timers.delete(key) },
  }
}

test("runs strategy lifecycle, serializes price callbacks and returns a report", async () => {
  const timers = createTimers()
  const seen = []
  const broker = new SimulatedExecutionBroker({
    history,
    markets: { DOGEUSDT: { baseAsset: "DOGE", quoteAsset: "USDT" } },
    initialBalances: { USDT: "10" },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })
  const strategy = {
    async onStart() { seen.push("start") },
    async onPrice(event) { seen.push(event.price) },
    async onStop() { seen.push("stop") },
  }
  const run = runStrategySimulation({ broker, symbol: "DOGEUSDT", strategy })
  await new Promise((resolve) => setImmediate(resolve))
  while (timers.timers.size) {
    const [key, callback] = timers.timers.entries().next().value
    timers.timers.delete(key)
    callback()
    await Promise.resolve()
  }
  const report = await run
  assert.deepEqual(seen, ["start", "1", "1.1", "stop"])
  assert.equal(report.candlesProcessed, 2)
  assert.equal(report.symbol, "DOGEUSDT")
  assert.equal(report.balances.find((x) => x.asset === "USDT").free, "10")
})
