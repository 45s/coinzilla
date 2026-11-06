import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { startHarvester } from "./start-harvester.js"

const eventPublisher = {
  publish: () => ({ ok: true }),
  flush: async () => ({ ok: true, durable: true }),
}
const binanceEnv = {
  HARVESTER_BROKER: "binance",
  BINANCE_API_KEY: "key",
  BINANCE_API_SECRET_KEY: "secret",
}
async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(label + " was not observed before timeout")
}

test("starts Conservative DOGE/ZRO strategies from a deterministic config and submits their initial BUYs", { timeout: 30_000 }, async () => {
  const config = {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: {
          minProfit: 0.01,
          conservative: { enabled: true },
          aggressive: { enabled: false },
        },
        pairs: {
          DOGEUSDT: {
            enabled: true,
            investment: 100,
            orderQuantity: 400,
            keepQuantity: 1,
            priceStepPercent: 0.05,
            pricePrecision: 5,
            quantityPrecision: 0,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
          ZROUSDT: {
            enabled: true,
            investment: 100,
            orderQuantity: 5,
            keepQuantity: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 3,
            quantityPrecision: 1,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
  const strategy = config.strategies.CG_coinGrabber
  assert.equal(strategy.enabled, true)
  assert.equal(strategy.settings.conservative.enabled, true)
  assert.equal(strategy.settings.aggressive.enabled, false)
  assert.deepEqual(
    Object.keys(strategy.pairs).filter((symbol) => strategy.pairs[symbol].enabled).sort(),
    ["DOGEUSDT", "ZROUSDT"],
  )

  const submitted = []
  const priceHandlers = new Map()
  let userData
  const metadata = (symbol) => {
    const base = symbol.slice(0, -4)
    const baseAsset = new Asset({ id: "asset:" + base, code: base })
    const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
    const market = new Market({ venue: "binance", symbol, baseAsset, quoteAsset })
    const priceIncrement = symbol === "DOGEUSDT" ? "0.00001" : "0.001"
    const quantityIncrement = symbol === "DOGEUSDT" ? "1" : "0.1"
    return {
      market,
      tradingRules: new TradingRules({ market, constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: priceIncrement, asset: quoteAsset }) },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: quantityIncrement, asset: baseAsset }) },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: quantityIncrement, asset: baseAsset }) },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
      ] }),
      supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    }
  }
  const broker = {
    connect: async () => {},
    disconnect: async () => {},
    getExchangeMarkets: async () => ({ ok: true, data: [] }),
    getSymbolFilters: async ({ symbol }) => ({ ok: true, data: metadata(symbol) }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getFills: async () => ({ ok: true, data: [] }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    getCanonicalOrder: async () => ({ ok: false, errors: [new Error("not found")] }),
    getAccountSnapshot: async () => ({
      ok: true,
      data: {
        sourceTime: Date.now(),
        balances: ["DOGE", "ZRO", "USDT"].map((code) => {
          const asset = new Asset({ id: "asset:" + code, code })
          return new Balance({
            free: new Quantity({ amount: code === "USDT" ? "1000" : "0", asset }),
            locked: new Quantity({ amount: "0", asset }),
          })
        }),
      },
    }),
    subscribeForUserData: async (handlers) => {
      userData = handlers
      return { ok: true, data: { disconnect: async () => {} } }
    },
    subscribeForPrices: async ({ symbol, onPrice }) => {
      priceHandlers.set(symbol, onPrice)
      return { ok: true, data: { unsubscribe: async () => {} } }
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker }) => {
      books.set(symbol, onBookTicker)
      return { ok: true, data: { unsubscribe: async () => {} } }
    },
    getPrices: async ({ symbol }) => ({
      ok: true,
      data: { symbol, price: symbol === "DOGEUSDT" ? "0.07161000" : "1.60400000" },
    }),
    placeOrder: async ({ order }) => {
      submitted.push(order)
      const market = metadata(order.market.symbol).market
      const timestamp = Date.now()
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "ack-" + order.clientOrderId,
          market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: market.quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: market.baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
          status: "OPEN",
          createdAt: timestamp,
          acknowledgedAt: timestamp,
          updatedAt: timestamp,
        }),
      }
    },
    cancelOrder: async () => ({ ok: false, errors: [new Error("not requested")] }),
  }

  const runtime = await startHarvester({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      NODE_ENV: "test",
      HARVESTER_TRADING_MODE: "testnet",
      HARVESTER_ENABLE_TRADING: "true",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: { info() {}, debug() {}, error() {} },
  })
  try {
    assert.equal(runtime.userDataReady, true)
    const timestamp = Date.now()
    for (const [symbol, price] of [
      ["DOGEUSDT", "0.07161000"],
      ["ZROUSDT", "1.60400000"],
    ]) {
      const onPrice = priceHandlers.get(symbol)
      assert.equal(typeof onPrice, "function", symbol + " market-price subscription")
      await onPrice({
        eventType: "aggTrade",
        eventTime: timestamp,
        timestamp,
        symbol,
        price,
        quantity: "100",
        isBuyerMaker: false,
        wasBestPrice: true,
        aggId: timestamp,
        firstId: timestamp,
        lastId: timestamp,
      })
    }
    await waitFor(() => submitted.filter((order) => order.side === "BUY").length >= 2, "two strategy-generated BUY submissions")
    const buys = submitted
      .filter((order) => order.side === "BUY")
      .sort((a, b) => a.market.symbol.localeCompare(b.market.symbol))
    assert.deepEqual(buys.map((order) => order.market.symbol), ["DOGEUSDT", "ZROUSDT"])
    assert.deepEqual(buys.map((order) => [order.price, order.quantity]), [
      ["0.07157", "400"],
      ["1.603", "5"],
    ])
    assert.ok(userData)
  } finally {
    await runtime.stop()
  }
})
