import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Commission,
  Fill,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import { multiplyDecimal, percentageToRate } from "@coinzilla/utils"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { startHarvester } from "./start-harvester.js"

const eventPublisher = {
  publish: (event) => {
    if (event.name === "recovery.cycle_completed") {
      cycleCompletions.set(event.data.symbol, event.data)
      cycleWaiters.get(event.data.symbol)?.(event.data)
      cycleWaiters.delete(event.data.symbol)
    }
    return { ok: true }
  },
  flush: async () => ({ ok: true, durable: true }),
}
const cycleCompletions = new Map()
const cycleWaiters = new Map()

const binanceEnv = {
  HARVESTER_BROKER: "binance",
  BINANCE_API_KEY: "key",
  BINANCE_API_SECRET_KEY: "secret",
}

// The exchange simulator applies its own fee schedule to executions. This is deliberately
// separate from the strategy's makerPercent/takerPercent planning inputs.
const exchangeCommissionRate = percentageToRate({ percent: "0.1" })

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

const marketFilters = (symbol) => {
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

const waitForOrder = (submitted, waiters, { symbol, side }) => {
  const matches = (order) =>
    order.market.symbol === symbol &&
    order.side === side
  const existing = submitted.find(matches)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => waiters.push({ matches, resolve }))
}

test("replays one complete Conservative DOGE/ZRO cycle from issue #645 prices", { timeout: 30_000 }, async () => {
  cycleCompletions.clear()
  cycleWaiters.clear()
  const submitted = []
  const priceHandlers = new Map()
  const openOrders = new Map()
  const orderWaiters = []
  let userDataHandlers
  let nextBrokerOrderId = 1

  const notifyOrderWaiters = () => {
    for (let index = orderWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = orderWaiters[index]
      const order = submitted.find(waiter.matches)
      if (!order) continue
      orderWaiters.splice(index, 1)
      waiter.resolve(order)
    }
  }
  const waitForCycle = (symbol) => {
    if (cycleCompletions.has(symbol)) return Promise.resolve(cycleCompletions.get(symbol))
    return new Promise((resolve) => cycleWaiters.set(symbol, resolve))
  }

  // Real Binance broker + real Harvester adapter. Only exchange I/O is simulated.
  const brokerFactory = ({ config: brokerConfig, logger }) => {
    const broker = new BinanceWebSocketBroker({
      apiKey: brokerConfig.apiKey,
      apiSecret: brokerConfig.apiSecret,
      logger,
    })
    broker.connect = async () => {}
    broker.disconnect = async () => {}
    broker.getExchangeMarkets = async () => ({ ok: true, data: [] })
    broker.getSymbolFilters = async ({ symbol }) => ({ ok: true, data: marketFilters(symbol) })
    broker.getOpenOrders = async () => ({ ok: true, data: [] })
    broker.getFills = async () => ({ ok: true, data: [] })
    broker.getCanonicalOrderHistory = async ({ symbol, orderId } = {}) => ({
      ok: true,
      data: [...openOrders.values()].filter((order) =>
        (!symbol || order.market.symbol === symbol) &&
        (!orderId || order.brokerOrderId === String(orderId))),
    })
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
      userDataHandlers = handlers
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
      data: { symbol, price: symbol === "DOGEUSDT" ? "0.07161000" : "1.60500000" },
    })
    broker.createCanonicalOrder = async (order) => {
      submitted.push(order)
      const timestamp = Date.now()
      const canonicalOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: "replay-" + nextBrokerOrderId++,
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
      })
      openOrders.set(canonicalOrder.clientOrderId, canonicalOrder)
      notifyOrderWaiters()
      return { ok: true, data: canonicalOrder }
    }
    broker.cancelOrder = async ({ symbol, orderId }) => {
      const order = [...openOrders.values()].find((item) =>
        item.market.symbol === symbol && item.brokerOrderId === String(orderId))
      if (!order) return { ok: false, errors: [new Error("order not found")] }
      return { ok: true }
    }
    return broker
  }

  const triggerPrice = async (symbol, price) => {
    const onPrice = priceHandlers.get(symbol)
    assert.equal(typeof onPrice, "function", symbol + " price subscription")
    await onPrice({
      eventType: "aggTrade",
      eventTime: Date.now(),
      timestamp: Date.now(),
      symbol,
      price,
      quantity: "100",
      isBuyerMaker: false,
      wasBestPrice: true,
      aggId: Date.now(),
      firstId: Date.now(),
      lastId: Date.now(),
    })
  }

  const fillOrder = ({ order, price, tradeId }) => {
    const market = order.market
    const quantity = order.originalQuantity.amount
    const quoteQuantity = multiplyDecimal({ left: price, right: quantity })
    // Simulate Binance's reported commission from the exchange fee schedule:
    // BUY fees are charged in base; SELL fees are charged in quote.
    const commissionAsset = order.side === "BUY" ? market.baseAsset : market.quoteAsset
    const commissionBasis = order.side === "BUY" ? quantity : quoteQuantity
    const commissionAmount = multiplyDecimal({
      left: commissionBasis,
      right: exchangeCommissionRate,
    })
    const timestamp = Date.now()
    const executedOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market,
      side: order.side,
      type: order.type,
      limitPrice: order.limitPrice,
      originalQuantity: order.originalQuantity,
      executedQuantity: order.originalQuantity,
      status: "FILLED",
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: timestamp,
      completedAt: timestamp,
    })
    const commissions = [new Commission({
      amount: new Money({
        amount: commissionAmount,
        asset: commissionAsset,
      }),
    })]
    const fill = new Fill({
      tradeId,
      brokerOrderId: order.brokerOrderId,
      clientOrderId: order.clientOrderId,
      market,
      side: order.side,
      price: new Money({ amount: price, asset: market.quoteAsset }),
      quantity: new Quantity({ amount: quantity, asset: market.baseAsset }),
      quoteQuantity: new Money({ amount: quoteQuantity, asset: market.quoteAsset }),
      commissions,
      commissionStatus: "COMPLETE",
      executedAt: timestamp,
    })
    openOrders.delete(order.clientOrderId)
    userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder,
        fill,
      },
    })
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

    // The initial market references and resulting BUY orders are from issue #645.
    const dogeBuySubmitted = waitForOrder(submitted, orderWaiters, {
      symbol: "DOGEUSDT",
      side: "BUY",
    })
    await triggerPrice("DOGEUSDT", "0.07161000")
    const dogeBuy = await dogeBuySubmitted

    const zroBuySubmitted = waitForOrder(submitted, orderWaiters, {
      symbol: "ZROUSDT",
      side: "BUY",
    })
    await triggerPrice("ZROUSDT", "1.60500000")
    const zroBuy = await zroBuySubmitted
    assert.deepEqual(
      [dogeBuy.price, dogeBuy.quantity, dogeBuy.type],
      ["0.07157", "400", "LIMIT"],
    )
    assert.deepEqual(
      [zroBuy.price, zroBuy.quantity, zroBuy.type],
      ["1.604", "5", "LIMIT"],
    )

    // Trigger each BUY fill at its submitted limit; exchange reports actual fills/fees.
    const dogeSellSubmitted = waitForOrder(submitted, orderWaiters, {
      symbol: "DOGEUSDT",
      side: "SELL",
    })
    await triggerPrice("DOGEUSDT", "0.07157")
    fillOrder({
      order: dogeBuy,
      price: "0.07157",
      tradeId: "645-doge-buy",
    })
    const dogeSell = await dogeSellSubmitted

    const zroSellSubmitted = waitForOrder(submitted, orderWaiters, {
      symbol: "ZROUSDT",
      side: "SELL",
    })
    await triggerPrice("ZROUSDT", "1.604")
    fillOrder({
      order: zroBuy,
      price: "1.604",
      tradeId: "645-zro-buy",
    })
    const zroSell = await zroSellSubmitted
    assert.deepEqual(
      [dogeSell.price, dogeSell.quantity, dogeSell.type],
      ["0.07203", "398", "LIMIT"],
    )
    assert.deepEqual(
      [zroSell.price, zroSell.quantity, zroSell.type],
      ["1.615", "4.98", "LIMIT"],
    )

    // Market trades through each SELL limit. DOGE receives a better fill than its limit,
    // matching the exchange's price-improvement behavior while meeting the $0.01 net floor.
    const dogeCycle = waitForCycle("DOGEUSDT")
    await triggerPrice("DOGEUSDT", "0.07204")
    fillOrder({
      order: dogeSell,
      price: "0.07204",
      tradeId: "645-doge-sell",
    })
    const zroCycle = waitForCycle("ZROUSDT")
    await triggerPrice("ZROUSDT", "1.615")
    fillOrder({
      order: zroSell,
      price: "1.615",
      tradeId: "645-zro-sell",
    })

    const [dogeCompletion, zroCompletion] = await Promise.all([dogeCycle, zroCycle])
    assert.equal(dogeCompletion.freeQuantity, "1.6")
    assert.equal(zroCompletion.freeQuantity, "0.015")
    assert.ok(Number(dogeCompletion.realizedNetProfit) >= 0.01)
    assert.ok(Number(zroCompletion.realizedNetProfit) >= 0.01)

    const dogePosition = runtime.portfolio.getPosition({ symbol: "DOGEUSDT" })
    const zroPosition = runtime.portfolio.getPosition({ symbol: "ZROUSDT" })
    assert.equal(dogePosition.baseQuantity.amount, "0")
    assert.equal(dogePosition.freeBaseQuantity.amount, "1.6")
    assert.equal(zroPosition.baseQuantity.amount, "0")
    assert.equal(zroPosition.freeBaseQuantity.amount, "0.015")
  } finally {
    await runtime.stop()
  }
})
