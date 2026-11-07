import test, { describe, beforeAll, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import { multiplyDecimal, percentageToRate } from "@coinzilla/utils"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { startHarvester } from "./start-harvester.js"

const expectedSellOrders = {
  DOGEUSDT: {
    initialPrice: "0.07161000",
    buyPrice: "0.07157",
    sellPrice: "0.07203",
    sellFillPrice: "0.07204",
    expectedSellQuantity: "398",
    expectedFreeQuantity: "1.6",
    expectedProfit: "0.01524808",
  },
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
      },
    },
  },
}

const exchangeInfoSymbol = (symbol) => {
  const baseAsset = symbol.slice(0, -4)
  const pair = config.strategies.CG_coinGrabber.pairs[symbol]
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
        tickSize: pair.pricePrecision === 5 ? "0.00001" : "0.001",
      },
      {
        filterType: "LOT_SIZE",
        minQty: pair.quantityPrecision === 0 ? "1" : "0.01",
        maxQty: "100000000",
        stepSize: pair.quantityPrecision === 0 ? "1" : "0.01",
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

let dogeExchangeInfo

const waitForOrder = (submitted, waiters, symbol, side) => {
  const matches = (order) =>
    order.market.symbol === symbol && order.side === side
  const existing = submitted.find(matches)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => waiters.push({ matches, resolve }))
}

const createReplayHarness = async (symbol) => {
  const pair = config.strategies.CG_coinGrabber.pairs[symbol]
  const expectedSellOrder = expectedSellOrders[symbol]
  const submittedList = []
  const outgoingOrderRequestsList = []
  const receivedPricesList = []
  const receivedExecutionReportsList = []
  const priceHandlers = new Map()
  const openOrders = new Map()
  const orderWaitersList = []
  let userDataHandler
  let nextBrokerOrderId = 1
  let cycleCompletion
  let cycleWaiter

  const notifyOrderWaiters = () => {
    for (let index = orderWaitersList.length - 1; index >= 0; index -= 1) {
      const waiter = orderWaitersList[index]
      const order = submittedList.find(waiter.matches)
      if (!order) continue
      orderWaitersList.splice(index, 1)
      waiter.resolve(order)
    }
  }

  const waitForOrderSide = (side) =>
    waitForOrder(submittedList, orderWaitersList, symbol, side)

  const waitForCycle = () => {
    if (cycleCompletion) return Promise.resolve(cycleCompletion)
    return new Promise((resolve) => {
      cycleWaiter = resolve
    })
  }

  const brokerFactory = ({ config: brokerConfig, logger }) => {
    const broker = new BinanceWebSocketBroker({
      apiKey: brokerConfig.apiKey,
      apiSecret: brokerConfig.apiSecret,
      logger,
    })
    broker.connect = async () => {}
    broker.disconnect = async () => {}
    broker.tradingConnection.request = async (method, params = {}) => {
      if (method === "order.place") {
        outgoingOrderRequestsList.push({ method, params: { ...params } })
      }
      if (method === "exchangeInfo") {
        return { data: { symbols: [dogeExchangeInfo] } }
      }
      if (method === "ticker.price") {
        return { data: { symbol, price: expectedSellOrder.initialPrice } }
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
        submittedList.push(result.data)
        openOrders.set(result.data.clientOrderId, result.data)
        notifyOrderWaiters()
      }
      return result
    }
    broker.getOpenOrders = async () => ({ ok: true, data: [] })
    broker.getFills = async () => ({ ok: true, data: [] })
    broker.getCanonicalOrderHistory = async ({ orderId } = {}) => ({
      ok: true,
      data: [...openOrders.values()].filter(
        (order) => !orderId || order.brokerOrderId === String(orderId),
      ),
    })
    broker.getCanonicalOrder = async () => ({
      ok: false,
      errors: [new Error("not found")],
    })
    broker.getAccountSnapshot = async () => ({
      ok: true,
      data: {
        sourceTime: Date.now(),
        balances: [symbol.slice(0, -4), "USDT"].map((code) => {
          const asset = new Asset({ id: code.toLowerCase(), code })
          return new Balance({
            free: new Quantity({
              amount: code === "USDT" ? "1000" : "0",
              asset,
            }),
            locked: new Quantity({ amount: "0", asset }),
          })
        }),
      },
    })
    broker.userDataSession.subscribe = async ({ onEvent }) => {
      userDataHandler = (message) => {
        receivedExecutionReportsList.push(message.event)
        return onEvent(message)
      }
      return { data: { disconnect: async () => {} } }
    }
    broker.subscribeForPrices = async ({
      subscribedSymbol,
      symbol: requestedSymbol,
      onPrice,
    }) => {
      const targetSymbol = requestedSymbol ?? subscribedSymbol ?? symbol
      priceHandlers.set(targetSymbol, (event) => {
        receivedPricesList.push(event)
        return onPrice(event)
      })
      return { ok: true, data: { unsubscribe: async () => {} } }
    }
    broker.subscribeForBookTicker = async () => ({
      ok: true,
      data: { unsubscribe: async () => {} },
    })
    broker.cancelOrder = async () => ({ ok: true })
    return broker
  }

  const runtime = await startHarvester({
    loadConfig: async () => config,
    env: {
      HARVESTER_BROKER: "binance",
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
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
    eventPublisher: {
      publish: (event) => {
        if (event.name === "recovery.cycle_completed") {
          cycleCompletion = event.data
          cycleWaiter?.(event.data)
          cycleWaiter = undefined
        }
        return { ok: true }
      },
      flush: async () => ({ ok: true, durable: true }),
    },
    logger: { info() {}, debug() {}, error() {} },
  })

  assert.equal(runtime.userDataReady, true)

  const triggerPrice = async (price) => {
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

  const fillOrder = async ({ order, price, tradeId }) => {
    const quantity = order.originalQuantity.amount
    const quoteQuantity = multiplyDecimal({ left: price, right: quantity })
    const commissionRate = percentageToRate({
      percent: String(
        order.type === "LIMIT_MAKER" ? pair.makerPercent : pair.takerPercent,
      ),
    })
    const commissionAsset =
      order.side === "BUY" ? order.market.baseAsset : order.market.quoteAsset
    const commissionBasis = order.side === "BUY" ? quantity : quoteQuantity
    const commissionAmount = multiplyDecimal({
      left: commissionBasis,
      right: commissionRate,
    })
    const timestamp = Date.now()
    openOrders.delete(order.clientOrderId)
    return userDataHandler({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: {
          symbol,
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
          symbol,
          id: tradeId,
          orderId: order.brokerOrderId,
          commissionAmount,
          commissionAsset: commissionAsset.code,
          isMaker: order.type === "LIMIT_MAKER",
          price,
          quantity,
          quoteQuantity,
          time: timestamp,
        },
      },
    })
  }

  return {
    runtime,
    symbol,
    pair,
    scenario: expectedSellOrder,
    submitted: submittedList,
    outgoingOrderRequests: outgoingOrderRequestsList,
    receivedPrices: receivedPricesList,
    receivedExecutionReports: receivedExecutionReportsList,
    waitForOrder: waitForOrderSide,
    waitForCycle,
    triggerPrice,
    fillOrder,
  }
}

const getInitialBuy = async (replay) => {
  const { scenario, waitForOrder, triggerPrice } = replay
  const submitted = waitForOrder("BUY")
  await triggerPrice(scenario.initialPrice)
  return submitted
}

const getRecoverySell = async (replay) => {
  const { scenario, waitForOrder, triggerPrice, fillOrder } = replay
  const buySubmitted = getInitialBuy(replay)
  const buy = await buySubmitted
  const sellSubmitted = waitForOrder("SELL")
  await triggerPrice(scenario.buyPrice)
  await fillOrder({
    order: buy,
    price: scenario.buyPrice,
    tradeId: "645-" + replay.symbol.toLowerCase() + "-buy",
  })
  return sellSubmitted
}

describe("DOGEUSDT Conservative strategy replay", () => {
  const symbol = "DOGEUSDT"
  let replay

  beforeAll(() => {
    dogeExchangeInfo = exchangeInfoSymbol(symbol)
  })

  beforeEach(async () => {
      replay = await createReplayHarness(symbol)
    })

  afterEach(async () => {
    if (replay?.runtime) await replay.runtime.stop()
    replay = undefined
  })

  test("creates the initial BUY after a price trigger", async () => {
      const buy = await getInitialBuy(replay)
      assert.deepEqual(
        [buy.market.symbol, buy.side, buy.price, buy.quantity, buy.type],
        [
          symbol,
          "BUY",
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          "LIMIT",
        ],
      )
      assert.deepEqual(
        replay.outgoingOrderRequests.map(({ params }) => [
          params.symbol,
          params.side,
          params.type,
        ]),
        [[symbol, "BUY", "LIMIT"]],
      )
      assert.deepEqual(
        replay.receivedPrices.map(({ symbol: receivedSymbol, price }) => [
          receivedSymbol,
          price,
        ]),
        [[symbol, replay.scenario.initialPrice]],
      )
    })

  test("creates a recovery SELL from the actual BUY fill report", async () => {
      const sellSubmitted = getRecoverySell(replay)
      const sell = await sellSubmitted
      assert.deepEqual(
        [sell.market.symbol, sell.side, sell.price, sell.quantity, sell.type],
        [
          symbol,
          "SELL",
          replay.scenario.sellPrice,
          replay.scenario.expectedSellQuantity,
          "LIMIT",
        ],
      )
      assert.deepEqual(
        replay.receivedExecutionReports.map(({ executedOrder, fill }) => [
          executedOrder.symbol,
          executedOrder.side,
          fill.commissionAsset,
        ]),
        // add price/commission/quantity
        [[symbol, "BUY", symbol.slice(0, -4)]],
      )
      assert.deepEqual(
        replay.outgoingOrderRequests.map(({ params }) => [
          params.symbol,
          params.side,
          params.type,
        ]),
        [
          [symbol, "BUY", "LIMIT"],
          [symbol, "SELL", "LIMIT"],
        ],
      )
    })

  test("completes the recovery cycle after the SELL fill report", async () => {
      const sellSubmitted = getRecoverySell(replay)
      const sell = await sellSubmitted
      const cycle = replay.waitForCycle()
      await replay.triggerPrice(replay.scenario.sellFillPrice)
      await replay.fillOrder({
        order: sell,
        price: replay.scenario.sellFillPrice,
        tradeId: "645-" + symbol.toLowerCase() + "-sell",
      })

      const completion = await cycle
      assert.equal(
        completion.freeQuantity,
        replay.scenario.expectedFreeQuantity,
      )
      assert.equal(completion.realizedNetProfit, replay.scenario.expectedProfit)

      const position = replay.runtime.portfolio.getPosition({ symbol })
      assert.equal(position.baseQuantity.amount, "0")
      assert.equal(
        position.freeBaseQuantity.amount,
        replay.scenario.expectedFreeQuantity,
      )
      assert.deepEqual(
        replay.receivedExecutionReports.map(({ executedOrder, fill }) => [
          executedOrder.symbol,
          executedOrder.side,
          fill.commissionAsset,
        ]),
        [
          [symbol, "BUY", symbol.slice(0, -4)],
          [symbol, "SELL", "USDT"],
        ],
      )
  })
})
