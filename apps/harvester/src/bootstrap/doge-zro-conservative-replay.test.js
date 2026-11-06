import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Quantity } from "@coinzilla/entities"
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

// Binance exchangeInfo payload: the real broker's symbol-filter adapter and
// Harvester's canonical metadata converter must both process this response.
const exchangeInfoSymbol = (symbol) => {
  const baseAsset = symbol.slice(0, -4)
  return {
    symbol,
    baseAsset,
    quoteAsset: "USDT",
    orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
    filters: [
      {
        filterType: "PRICE_FILTER",
        minPrice: "0",
        maxPrice: "100000",
        tickSize: symbol === "DOGEUSDT" ? "0.00001" : "0.001",
      },
      {
        filterType: "LOT_SIZE",
        minQty: symbol === "DOGEUSDT" ? "1" : "0.01",
        maxQty: "100000000",
        stepSize: symbol === "DOGEUSDT" ? "1" : "0.01",
      },
      {
        filterType: "MIN_NOTIONAL",
        minNotional: "5",
        applyToMarket: true,
        avgPriceMins: 5,
      },
    ],
  }
}

const exchangeInfoResponse = (symbol) => ({
  symbols: (symbol ? [symbol] : ["DOGEUSDT", "ZROUSDT"]).map(exchangeInfoSymbol),
})

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
    // Simulate Binance RPC responses, leaving the real broker's exchange-info,
    // order-request and canonical-order adapters in the execution path.
    broker.tradingConnection.request = async (method, params = {}) => {
      if (method === "exchangeInfo") {
        return { data: exchangeInfoResponse(params.symbol) }
      }
      if (method === "ticker.price") {
        return {
          data: {
            symbol: params.symbol,
            price: params.symbol === "DOGEUSDT" ? "0.07161000" : "1.60500000",
          },
        }
      }
      if (method === "order.place") {
        const timestamp = Date.now()
        return {
          data: {
            symbol: params.symbol,
            orderId: nextBrokerOrderId++,
            clientOrderId: params.newClientOrderId,
            price: params.price,
            origQty: params.quantity,
            executedQty: "0",
            status: "NEW",
            type: params.type,
            side: params.side,
            time: timestamp,
            updateTime: timestamp,
          },
        }
      }
      throw new Error("Unexpected simulated Binance RPC method: " + method)
    }
    const createCanonicalOrder = broker.createCanonicalOrder.bind(broker)
    broker.createCanonicalOrder = async (order) => {
      const result = await createCanonicalOrder(order)
      if (result?.ok) {
        submitted.push(result.data)
        openOrders.set(result.data.clientOrderId, result.data)
        notifyOrderWaiters()
      }
      return result
    }
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
    // Keep BinanceWebSocketBroker.subscribeForUserData() and its execution
    // normalization active; replace only the remote user-data subscription.
    broker.userDataSession.subscribe = async ({ onEvent }) => {
      userDataHandlers = { onEvent }
      return { data: { disconnect: async () => {} } }
    }
    broker.subscribeForPrices = async ({ symbol, onPrice }) => {
      priceHandlers.set(symbol, onPrice)
      return { ok: true, data: { unsubscribe: async () => {} } }
    }
    broker.subscribeForBookTicker = async () => ({
      ok: true,
      data: { unsubscribe: async () => {} },
    })

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
    const pairConfig = config.strategies.CG_coinGrabber.pairs[market.symbol]
    const isMaker = order.type === "LIMIT_MAKER"
    const commissionPercent = isMaker ? pairConfig.makerPercent : pairConfig.takerPercent
    const commissionRate = percentageToRate({ percent: String(commissionPercent) })
    const commissionAsset = order.side === "BUY" ? market.baseAsset : market.quoteAsset
    const commissionBasis = order.side === "BUY" ? quantity : quoteQuantity
    const commissionAmount = multiplyDecimal({
      left: commissionBasis,
      right: commissionRate,
    })
    const timestamp = Date.now()
    openOrders.delete(order.clientOrderId)
    userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: {
          symbol: market.symbol,
          id: order.brokerOrderId,
          clientOrderId: order.clientOrderId,
          type: order.type,
          side: order.side,
          quantity,
          executedQuantity: quantity,
          price: order.limitPrice.amount,
          status: "FILLED",
          createdAt: order.createdAt,
          updatedAt: timestamp,
        },
        fill: {
          symbol: market.symbol,
          id: tradeId,
          orderId: order.brokerOrderId,
          commissionAmount,
          commissionAsset: commissionAsset.code,
          isMaker,
          price,
          quantity,
          quoteQuantity,
          time: timestamp,
        },
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
    assert.equal(dogeCompletion.realizedNetProfit, "0.01524808")
    assert.equal(zroCompletion.realizedNetProfit, "0.0146573")

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
