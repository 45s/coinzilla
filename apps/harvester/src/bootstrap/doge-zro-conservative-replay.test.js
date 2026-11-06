import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Money, Quantity } from "@coinzilla/entities"
import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
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

test("starts Conservative DOGE/ZRO strategies from deterministic market prices and submits their initial BUYs", { timeout: 30_000 }, async () => {
  const submitted = []
  const priceHandlers = new Map()
  let userData
  const symbolFilters = (symbol) => {
    const baseAsset = symbol.slice(0, -4)
    return {
      symbol,
      baseAsset,
      quoteAsset: "USDT",
      tickSize: symbol === "DOGEUSDT" ? "0.00001" : "0.001",
      stepSize: symbol === "DOGEUSDT" ? "1" : "0.1",
      minQuantity: symbol === "DOGEUSDT" ? "1" : "0.1",
      minNotional: "5",
      supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    }
  }

  // Keep the production Binance broker and Harvester adapter. Stub only exchange I/O.
  const brokerFactory = ({ config: brokerConfig, logger }) => {
    const broker = new BinanceWebSocketBroker({
      apiKey: brokerConfig.apiKey,
      apiSecret: brokerConfig.apiSecret,
      logger,
    })
    broker.connect = async () => {}
    broker.disconnect = async () => {}
    broker.getExchangeMarkets = async () => ({ ok: true, data: [] })
    broker.getSymbolFilters = async ({ symbol }) => ({ ok: true, data: symbolFilters(symbol) })
    broker.getOpenOrders = async () => ({ ok: true, data: [] })
    broker.getFills = async () => ({ ok: true, data: [] })
    broker.getCanonicalOrderHistory = async () => ({ ok: true, data: [] })
    broker.getCanonicalOrder = async () => ({ ok: false, errors: [new Error("not found")] })
    broker.getAccountSnapshot = async () => ({
      ok: true,
      data: {
        sourceTime: Date.now(),
        balances: ["DOGE", "ZRO", "USDT"].map((code) => {
          const asset = new Asset({ id: code.toLowerCase(), code })
          return new Balance({
            free: new Quantity({ amount: code === "USDT" ? "1000" : "0", asset }),
            locked: new Quantity({ amount: "0", asset }),
          })
        }),
      },
    })
    broker.subscribeForUserData = async (handlers) => {
      userData = handlers
      return { ok: true, data: { disconnect: async () => {} } }
    }
    broker.subscribeForPrices = async ({ symbol, onPrice }) => {
      priceHandlers.set(symbol, onPrice)
      return { ok: true, data: { unsubscribe: async () => {} } }
    }
    broker.subscribeForBookTicker = async () => ({
      ok: true,
      data: { unsubscribe: async () => {} },
    })
    broker.getPrices = async ({ symbol }) => ({
      ok: true,
      data: { symbol, price: symbol === "DOGEUSDT" ? "0.07161000" : "1.60400000" },
    })
    // This is the state-changing boundary: capture the canonical order instead of sending it.
    broker.createCanonicalOrder = async (order) => {
      submitted.push(order)
      const timestamp = Date.now()
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "ack-" + order.clientOrderId,
          market: order.market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: order.market.quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: order.market.baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: order.market.baseAsset }),
          status: "OPEN",
          createdAt: timestamp,
          acknowledgedAt: timestamp,
          updatedAt: timestamp,
        }),
      }
    }
    broker.cancelOrder = async () => ({ ok: false, errors: [new Error("not requested")] })
    return broker
  }

  const runtime = await startHarvester({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      NODE_ENV: "test",
      HARVESTER_TRADING_MODE: "testnet",
      HARVESTER_ENABLE_TRADING: "true",
    },
    brokerAdapterFactory: ({ config: brokerConfig, logger }) =>
      createBinanceBrokerAdapter({
        config: brokerConfig,
        logger,
        brokerFactory,
      }),
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

    await waitFor(
      () => submitted.filter((order) => order.side === "BUY").length >= 2,
      "two strategy-generated BUY submissions",
    )
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
