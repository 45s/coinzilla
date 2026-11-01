import assert from "node:assert/strict"
import test from "node:test"
import { SimulatedExecutionBroker } from "../src/adapters/simulated-execution-broker.js"

const history = {
  symbol: "DOGEUSDT", interval: "1m",
  history: [
    { timestamp: 1000, close_time: 59999, open: "1", high: "1.2", low: "0.9", close: "1.1", volume: "100" },
    { timestamp: 61000, close_time: 119999, open: "1.1", high: "1.3", low: "0.8", close: "1.2", volume: "100" },
  ],
}
const markets = { DOGEUSDT: { baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 2 } }

function createTimers() {
  const timers = new Map()
  let id = 0
  return {
    timers,
    setTimeoutFn(callback, delay) { const key = ++id; timers.set(key, { callback, delay }); return key },
    clearTimeoutFn(key) { timers.delete(key) },
  }
}

test("fills a limit buy when candle low touches its price and accounts for quote fee", async () => {
  const timers = createTimers()
  const executions = []
  const broker = new SimulatedExecutionBroker({
    history, markets, initialBalances: { USDT: "100", DOGE: "0" }, feeRate: "0.01",
    onExecution: (event) => executions.push(event),
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
  })
  await broker.connect()
  const order = await broker.createOrder({ symbol: "DOGEUSDT", side: "BUY", type: "LIMIT", quantity: "10", price: "0.85" })
  assert.equal(order.ok, true)
  assert.equal(order.data.status, "NEW")
  assert.equal((await broker.getBalances()).data.find((x) => x.asset === "USDT").locked, "8.585")
  const timer = [...timers.timers.values()][0]
  timers.timers.clear()
  timer.callback()
  const filled = (await broker.getOrderHistory()).data[0]
  assert.equal(filled.status, "FILLED")
  assert.equal(filled.fills[0].price, "0.85")
  assert.equal(filled.fills[0].commission, "0.085")
  assert.equal((await broker.getBalances()).data.find((x) => x.asset === "DOGE").free, "10")
  assert.equal(executions.length, 1)
  await broker.disconnect()
})

test("rejects marketable LIMIT_MAKER orders and insufficient balances", async () => {
  const broker = new SimulatedExecutionBroker({
    history, markets, initialBalances: { USDT: "1", DOGE: "0" },
  })
  await broker.connect()
  const maker = await broker.createOrder({ symbol: "DOGEUSDT", side: "BUY", type: "LIMIT_MAKER", quantity: "1", price: "1.1" })
  assert.equal(maker.ok, false)
  const funds = await broker.createOrder({ symbol: "DOGEUSDT", side: "BUY", type: "LIMIT", quantity: "10", price: "1" })
  assert.equal(funds.ok, false)
  await broker.disconnect()
})

test("supports cancellation and releases reserved balance", async () => {
  const broker = new SimulatedExecutionBroker({ history, markets, initialBalances: { USDT: "10" } })
  await broker.connect()
  const created = await broker.createOrder({ symbol: "DOGEUSDT", side: "BUY", quantity: "2", price: "0.5" })
  const canceled = await broker.cancelOrder({ symbol: "DOGEUSDT", orderId: created.data.orderId })
  assert.equal(canceled.data.status, "CANCELED")
  const quote = (await broker.getBalances()).data.find((x) => x.asset === "USDT")
  assert.equal(quote.free, "10")
  assert.equal(quote.locked, "0")
  await broker.disconnect()
})
