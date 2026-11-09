import nodeTest from "node:test"
import assert from "node:assert/strict"
import { subscribeToMarketData } from "./subscribe-to-market-data.js"

const test = (name, ...args) => nodeTest("[subscribe-to-market-data.test.js] " + name, ...args)

const createFixture = ({ tradingEnabled = false, pairs = { BTCUSDT: { enabled: true, orderQuantity: 0.01 } }, subscribeForPrices, subscribeForBookTicker, getPrices } = {}) => {
  const calls = []
  const events = []
  const subscriptions = []
  const bookSubscriptions = []
  const marketPriceIntake = new Map()
  const now = () => 10_000
  const result = subscribeToMarketData({
    broker: {
      subscribeForPrices: async (input) => {
        calls.push("subscribe-price:" + input.symbol)
        return subscribeForPrices ? subscribeForPrices(input, calls) : ({ ok: true, data: { unsubscribe: async () => {}, stream: "price" } })
      },
      subscribeForBookTicker: async (input) => {
        calls.push("subscribe-book:" + input.symbol)
        return subscribeForBookTicker ? subscribeForBookTicker(input, calls) : ({ ok: true, data: { unsubscribe: async () => {}, stream: "book" } })
      },
      getPrices: async (input) => {
        calls.push("ticker-price-request:" + input.symbol)
        return getPrices ? getPrices(input, calls) : ({ ok: true, data: { symbol: input.symbol, price: "65000" } })
      },
    },
    brokerName: "binance",
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
    logger: {},
    tradingEnabled,
    pairs,
    settings: {},
    processMarketPrice: async (input) => {
      calls.push("process-price:" + input.symbol)
      return { ok: true, data: { decision: { action: "NO_ACTION" } } }
    },
    processMarketBook: async ({ symbol }) => {
      calls.push("process-book:" + symbol)
      return { ok: true }
    },
    isMarketPriceFresh: (marketPrice) => marketPrice.timestamp === 10_000,
    now,
    isStopped: () => false,
    onMarketPriceError: () => {},
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
  })
  return { result, calls, events, subscriptions, bookSubscriptions, marketPriceIntake }
}

test("establishes all enabled book/price streams before WebSocket API ticker.price seeding", async () => {
  const fixture = createFixture({ tradingEnabled: true })
  const result = await fixture.result

  assert.deepEqual(
    fixture.calls,
    ["subscribe-book:BTCUSDT", "subscribe-price:BTCUSDT", "ticker-price-request:BTCUSDT", "process-price:BTCUSDT"],
    "Every enabled stream must be active before the initial WebSocket API ticker.price response is processed.",
  )
  assert.equal(result.subscriptions.length, 1, "The market-price subscription must be returned for shutdown ownership.")
  assert.equal(result.bookSubscriptions.length, 1, "The book subscription must be returned for shutdown ownership.")
  assert.equal(result.marketPriceIntake.has("BTCUSDT"), true, "Per-market WebSocket intake state must be retained.")
})

test("skips WebSocket API ticker.price seeding when a fresh stream price arrives during subscription setup", async () => {
  const fixture = createFixture({
    tradingEnabled: true,
    subscribeForPrices: async ({ symbol, onPrice }) => {
      await onPrice({ symbol, price: "65000", timestamp: 10_000 })
      return { ok: true, data: { unsubscribe: async () => {}, stream: "price" } }
    },
  })
  await fixture.result

  assert.equal(fixture.calls.includes("ticker-price-request:BTCUSDT"), false, "A fresh first WebSocket Streams price must avoid a redundant ticker.price request.")
  assert.equal(fixture.calls.includes("process-price:BTCUSDT"), true, "The fresh WebSocket price must be processed.")
})

test("read-only mode subscribes to prices without book streams or WebSocket API ticker.price seeding", async () => {
  const fixture = createFixture({ tradingEnabled: false })
  await fixture.result

  assert.deepEqual(fixture.calls, ["subscribe-price:BTCUSDT"], "Read-only mode must not establish trading book streams or request ticker-price snapshots.")
  assert.equal(fixture.bookSubscriptions.length, 0, "Read-only mode must not retain book subscriptions.")
})

test("publishes subscription failure evidence and rejects incomplete market intake", async () => {
  const fixture = createFixture({
    subscribeForPrices: async () => ({ ok: false, errors: [new Error("stream unavailable")] }),
  })

  await assert.rejects(
    fixture.result,
    /Unable to subscribe to market prices for BTCUSDT: stream unavailable/,
    "A market-price subscription without an unsubscribe handle must fail startup.",
  )
  assert.equal(fixture.events.length, 1, "A failed market subscription must publish one lifecycle failure event.")
  assert.equal(fixture.events[0].data.stream, "market-price", "The failure event must identify the market-price stream.")
})
