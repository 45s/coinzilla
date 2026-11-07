import nodeTest, { describe, before, beforeEach, afterEach } from "node:test"
const test = (name, ...args) => nodeTest("[doge-zro-conservative-replay.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Commission, Fill, Money, Quantity } from "@coinzilla/entities"
import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import {
  multiplyDecimal,
  percentageToRate,
  subtractDecimal,
} from "@coinzilla/utils"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { startHarvester } from "./start-harvester.js"

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
          investment: 200,
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

let dogeExchangeInfo

describe("DOGEUSDT Conservative strategy replay", () => {
  const symbol = "DOGEUSDT"
  let replay

  before(() => {
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
        params.price,
        params.quantity,
        params.type,
      ]),
      [
        [
          symbol,
          "BUY",
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          "LIMIT",
        ],
      ],
    )
    assert.deepEqual(
      replay.receivedPrices.map(({ symbol: receivedSymbol, price }) => [
        receivedSymbol,
        price,
      ]),
      [[symbol, replay.scenario.initialPrice]],
    )
  })

  test("creates the next standing BUY and recovery SELL from the actual BUY fill report", async () => {
    const { recoverySell: sell, nextStandingBuy } =
      await getRecoveryOrders(replay)
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
      [
        nextStandingBuy.market.symbol,
        nextStandingBuy.side,
        nextStandingBuy.price,
        nextStandingBuy.quantity,
        nextStandingBuy.type,
      ],
      [
        symbol,
        "BUY",
        replay.scenario.nextBuyPrice,
        String(replay.pair.orderQuantity),
        "LIMIT",
      ],
    )
    assert.deepEqual(
      replay.receivedExecutionReports.map(({ executedOrder, fill }) => [
        executedOrder.symbol,
        executedOrder.side,
        executedOrder.price,
        executedOrder.executedQuantity,
        fill.price,
        fill.quantity,
        fill.quoteQuantity,
        fill.commissionAmount,
        fill.commissionAsset,
      ]),
      [
        [
          symbol,
          "BUY",
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          "28.628",
          "0.4",
          symbol.slice(0, -4),
        ],
      ],
    )
    assert.deepEqual(
      replay.outgoingOrderRequests.map(({ params }) => [
        params.symbol,
        params.side,
        params.price,
        params.quantity,
        params.type,
      ]),
      [
        [
          symbol,
          "BUY",
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          "LIMIT",
        ],
        [
          symbol,
          "SELL",
          replay.scenario.sellPrice,
          replay.scenario.expectedSellQuantity,
          "LIMIT",
        ],
        [
          symbol,
          "BUY",
          replay.scenario.nextBuyPrice,
          String(replay.pair.orderQuantity),
          "LIMIT",
        ],
      ],
    )
  })

  test("reconciles four completed BUY fills into one profitable recovery SELL and retained portfolio", async () => {
    let buy = await getInitialBuy(replay)
    const completedBuys = []
    let sell

    for (let index = 0; index < 4; index += 1) {
      const sellSubmitted = replay.waitForOrder("SELL", index + 1)
      const nextBuySubmitted = replay.waitForOrder("BUY", index + 2)
      await replay.triggerPrice(buy.price)
      await replay.fillOrder({
        order: buy,
        price: buy.price,
        tradeId: String(645 + index),
      })
      const [nextSell, nextBuy] = await Promise.all([
        sellSubmitted,
        nextBuySubmitted,
      ])
      completedBuys.push(buy)
      sell = nextSell
      buy = nextBuy
    }

    assert.equal(completedBuys.length, 4)
    assert.deepEqual(
      replay.receivedExecutionReports
        .filter(({ executedOrder }) => executedOrder.side === "BUY")
        .map(({ executedOrder, fill }) => [
          executedOrder.price,
          executedOrder.executedQuantity,
          fill.price,
          fill.quantity,
          fill.quoteQuantity,
          fill.commissionAmount,
          fill.commissionAsset,
        ]),
      [
        ["0.07157", "400", "0.07157", "400", "28.628", "0.4", "DOGE"],
        ["0.07153", "400", "0.07153", "400", "28.612", "0.4", "DOGE"],
        ["0.07149", "400", "0.07149", "400", "28.596", "0.4", "DOGE"],
        ["0.07145", "400", "0.07145", "400", "28.58", "0.4", "DOGE"],
      ],
      "each BUY must reconcile its executed quantity, quote notional, and base-asset commission",
    )
    assert.equal(replay.cancelledOrders.length, 3)
    assert.ok(
      replay.cancelledOrders.every((order) => order.status === "CANCELED"),
    )
    assert.deepEqual(
      completedBuys.map((order) => [
        order.market.symbol,
        order.side,
        order.type,
      ]),
      Array.from({ length: 4 }, () => [symbol, "BUY", "LIMIT"]),
    )
    assert.deepEqual(
      replay.outgoingOrderRequests.map(({ params }) => params.side),
      ["BUY", "SELL", "BUY", "SELL", "BUY", "SELL", "BUY", "SELL", "BUY"],
    )
    assert.deepEqual(
      [sell.market.symbol, sell.side, sell.type],
      [symbol, "SELL", "LIMIT"],
    )
    assert.equal(sell.quantity, "1595")
    assert.equal(sell.price, "0.07182")
    assert.ok(Number(sell.quantity) > replay.pair.keepQuantity)

    const cycle = replay.waitForCycle()
    await replay.triggerPrice(sell.price)
    await replay.fillOrder({
      order: sell,
      price: sell.price,
      tradeId: "649",
    })
    const completion = await cycle
    assert.equal(completion.freeQuantity, "3.4")
    assert.equal(completion.realizedNetProfit, "0.0223471")
    assert.ok(Number(completion.realizedNetProfit) >= config.strategies.CG_coinGrabber.settings.minProfit)
    assert.deepEqual(
      replay.receivedExecutionReports
        .filter(({ executedOrder }) => executedOrder.side === "SELL")
        .map(({ executedOrder, fill }) => [
          executedOrder.price,
          executedOrder.executedQuantity,
          fill.price,
          fill.quantity,
          fill.quoteQuantity,
          fill.commissionAmount,
          fill.commissionAsset,
        ]),
      [[
        "0.07182",
        "1595",
        "0.07182",
        "1595",
        "114.5529",
        "0.1145529",
        "USDT",
      ]],
      "SELL proceeds and quote-asset commission must match the actual execution",
    )

    const position = replay.runtime.portfolio.getPosition({ symbol })
    const expectedRetainedQuantity = subtractDecimal({
      left: "1598.4",
      right: sell.quantity,
    })
    assert.equal(position.baseQuantity.amount, "0")
    assert.equal(expectedRetainedQuantity, "3.4")
    assert.equal(position.freeBaseQuantity.amount, expectedRetainedQuantity)
    assert.equal(position.freeBaseQuantity.amount, "3.4")
    assert.ok(
      Number(position.freeBaseQuantity.amount) >= replay.pair.keepQuantity,
    )
    assert.equal(
      replay.receivedExecutionReports.filter(
        ({ executedOrder }) => executedOrder.side === "BUY",
      ).length,
      4,
    )
    assert.equal(
      replay.receivedExecutionReports.filter(
        ({ executedOrder }) => executedOrder.side === "SELL",
      ).length,
      1,
    )
  })

  test("completes the recovery cycle after the SELL fill report", async () => {
    const { recoverySell: sell } = await getRecoveryOrders(replay)
    const cycle = replay.waitForCycle()
    await replay.triggerPrice(replay.scenario.sellFillPrice)
    await replay.fillOrder({
      order: sell,
      price: replay.scenario.sellFillPrice,
      tradeId: "650",
    })

    const completion = await cycle
    assert.equal(completion.freeQuantity, replay.scenario.expectedFreeQuantity)
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
        executedOrder.price,
        executedOrder.executedQuantity,
        fill.price,
        fill.quantity,
        fill.quoteQuantity,
        fill.commissionAmount,
        fill.commissionAsset,
      ]),
      [
        [
          symbol,
          "BUY",
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          replay.scenario.buyPrice,
          String(replay.pair.orderQuantity),
          "28.628",
          "0.4",
          symbol.slice(0, -4),
        ],
        [
          symbol,
          "SELL",
          replay.scenario.sellPrice,
          replay.scenario.expectedSellQuantity,
          replay.scenario.sellFillPrice,
          replay.scenario.expectedSellQuantity,
          "28.67192",
          "0.02867192",
          "USDT",
        ],
      ],
    )
  })
})

// Test helpers are kept after the suite so the test cases stay near the top.
function exchangeInfoSymbol(symbol) {
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

function waitForOrder(submitted, waiters, symbol, side, occurrence = 1) {
  const matches = (order) =>
    order.market.symbol === symbol && order.side === side
  const getOrders = () => submitted.filter(matches)
  const existing = getOrders()
  if (existing.length >= occurrence)
    return Promise.resolve(existing[occurrence - 1])
  return new Promise((resolve, reject) => {
    const waiter = {
      matches,
      isReady: () => getOrders().length >= occurrence,
      resolve: () => {
        clearTimeout(timeout)
        resolve(getOrders()[occurrence - 1])
      },
    }
    const timeout = setTimeout(() => {
      const index = waiters.indexOf(waiter)
      if (index >= 0) waiters.splice(index, 1)
      reject(new Error(
        "Timed out waiting for " + symbol + " " + side + " order #" + occurrence +
        "; observed " + getOrders().length + " matching orders",
      ))
    }, 5000)
    waiters.push(waiter)
  })
}

async function createReplayHarness(symbol) {
  const pair = config.strategies.CG_coinGrabber.pairs[symbol]
  const expectedSellOrder = {
    initialPrice: "0.07161000",
    buyPrice: "0.07157",
    nextBuyPrice: "0.07153",
    sellPrice: "0.07203",
    sellFillPrice: "0.07204",
    expectedSellQuantity: "398",
    expectedFreeQuantity: "1.6",
    expectedProfit: "0.01524808",
  }
  const submittedList = []
  const outgoingOrderRequestsList = []
  const receivedPricesList = []
  const receivedExecutionReportsList = []
  const priceHandlers = new Map()
  const openOrders = new Map()
  const orderHistory = new Map()
  const canonicalFills = new Map()
  const cancelledOrdersList = []
  const orderWaitersList = []
  let userDataHandler
  let nextBrokerOrderId = 1
  let cycleCompletion
  let cycleWaiter

  const notifyOrderWaiters = () => {
    for (let index = orderWaitersList.length - 1; index >= 0; index -= 1) {
      const waiter = orderWaitersList[index]
      if (!waiter.isReady()) continue
      orderWaitersList.splice(index, 1)
      waiter.resolve()
    }
  }

  const waitForOrderSide = (side, occurrence = 1) =>
    waitForOrder(submittedList, orderWaitersList, symbol, side, occurrence)

  const waitForCycle = () => {
    if (cycleCompletion) return Promise.resolve(cycleCompletion)
    return new Promise((resolve, reject) => {
      const resolveCycle = (data) => {
        clearTimeout(timeout)
        resolve(data)
      }
      const timeout = setTimeout(() => {
        if (cycleWaiter === resolveCycle) cycleWaiter = undefined
        reject(new Error("Timed out waiting for recovery.cycle_completed for " + symbol))
      }, 5000)
      cycleWaiter = resolveCycle
    })
  }

  const brokerFactory = ({ config: brokerConfig, logger }) => {
    const broker = new BinanceWebSocketBroker({
      apiKey: brokerConfig.apiKey,
      apiSecret: brokerConfig.apiSecret,
      logger,
    })
    broker.connect = async () => {
      broker.connected = true
    }
    broker.disconnect = async () => {
      broker.connected = false
    }
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
        const canonicalOrder = result.data
        // The replay assertions use exchange-shaped price/quantity fields while
        // the engine and broker now exchange canonical Money/Quantity values.
        submittedList.push({
          clientOrderId: canonicalOrder.clientOrderId,
          brokerOrderId: canonicalOrder.brokerOrderId,
          market: canonicalOrder.market,
          side: canonicalOrder.side,
          type: canonicalOrder.type,
          limitPrice: canonicalOrder.limitPrice,
          originalQuantity: canonicalOrder.originalQuantity,
          executedQuantity: canonicalOrder.executedQuantity,
          status: canonicalOrder.status,
          createdAt: canonicalOrder.createdAt,
          acknowledgedAt: canonicalOrder.acknowledgedAt,
          updatedAt: canonicalOrder.updatedAt,
          completedAt: canonicalOrder.completedAt,
          price: canonicalOrder.limitPrice.amount,
          quantity: canonicalOrder.originalQuantity.amount,
        })
        openOrders.set(canonicalOrder.clientOrderId, canonicalOrder)
        orderHistory.set(canonicalOrder.brokerOrderId, canonicalOrder)
        notifyOrderWaiters()
      }
      return result
    }
    broker.getOpenOrders = async ({ symbol: requestedSymbol } = {}) => ({
      ok: true,
      data: [...openOrders.values()].filter(
        (order) => !requestedSymbol || order.market.symbol === requestedSymbol,
      ),
    })
    broker.getFills = async ({ orderId } = {}) => ({
      ok: true,
      data: canonicalFills.get(String(orderId)) ?? [],
    })
    broker.getCanonicalOrderHistory = async ({
      orderId,
      symbol: requestedSymbol,
    } = {}) => ({
      ok: true,
      data: [...orderHistory.values()].filter(
        (order) =>
          (!orderId || order.brokerOrderId === String(orderId)) &&
          (!requestedSymbol || order.market.symbol === requestedSymbol),
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
        const fill = message.event?.fill
        const fillOrderId = fill?.brokerOrderId ?? fill?.orderId
        if (fill && fillOrderId !== undefined && fillOrderId !== null) {
          const brokerOrderId = String(fillOrderId)
          const order = orderHistory.get(brokerOrderId)
          if (order) {
            const commissionAsset = fill.commissionAsset === order.market.baseAsset.code
              ? order.market.baseAsset
              : order.market.quoteAsset
            const commissions = fill.commissionAmount && fill.commissionAmount !== "0"
              ? [new Commission({
                amount: new Money({ amount: fill.commissionAmount, asset: commissionAsset }),
              })]
              : []
            const canonicalFill = new Fill({
              tradeId: String(fill.tradeId ?? fill.id),
              brokerOrderId,
              clientOrderId: order.clientOrderId,
              market: order.market,
              side: fill.side,
              price: new Money({ amount: fill.price, asset: order.market.quoteAsset }),
              quantity: new Quantity({ amount: fill.quantity, asset: order.market.baseAsset }),
              quoteQuantity: new Money({ amount: fill.quoteQuantity, asset: order.market.quoteAsset }),
              liquidityRole: fill.isMaker ? "MAKER" : "TAKER",
              executedAt: fill.time,
              commissions,
              commissionStatus: "COMPLETE",
            })
            const fills = canonicalFills.get(brokerOrderId) ?? []
            fills.push(canonicalFill)
            canonicalFills.set(brokerOrderId, fills)
          }
        }
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
    broker.cancelOrder = async ({ orderId } = {}) => {
      const key = String(orderId)
      const order = orderHistory.get(key)
      if (!order)
        return {
          ok: false,
          errors: [new Error("simulated exchange order not found")],
        }
      const timestamp = Date.now()
      const canceled = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        market: order.market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: order.executedQuantity,
        status: "CANCELED",
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: timestamp,
        completedAt: timestamp,
      })
      openOrders.delete(order.clientOrderId)
      orderHistory.set(key, canceled)
      cancelledOrdersList.push(canceled)
      return { ok: true, data: canceled }
    }
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
    const filledOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      side: order.side,
      type: order.type,
      limitPrice: order.limitPrice,
      originalQuantity: order.originalQuantity,
      executedQuantity: new Quantity({ amount: quantity, asset: order.market.baseAsset }),
      status: "FILLED",
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: timestamp,
      completedAt: timestamp,
    })
    openOrders.delete(order.clientOrderId)
    orderHistory.set(order.brokerOrderId, filledOrder)
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
          side: order.side,
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
    cancelledOrders: cancelledOrdersList,
    outgoingOrderRequests: outgoingOrderRequestsList,
    receivedPrices: receivedPricesList,
    receivedExecutionReports: receivedExecutionReportsList,
    waitForOrder: waitForOrderSide,
    waitForCycle,
    triggerPrice,
    fillOrder,
  }
}

async function getInitialBuy(replay) {
  const { scenario, waitForOrder, triggerPrice } = replay
  const submitted = waitForOrder("BUY")
  await triggerPrice(scenario.initialPrice)
  return submitted
}

async function getRecoveryOrders(replay) {
  const { scenario, waitForOrder, triggerPrice, fillOrder } = replay
  const buy = await getInitialBuy(replay)
  const recoverySellSubmitted = waitForOrder("SELL")
  const nextStandingBuySubmitted = waitForOrder("BUY", 2)
  await triggerPrice(scenario.buyPrice)
  await fillOrder({
    order: buy,
    price: scenario.buyPrice,
    tradeId: "645",
  })
  const [recoverySell, nextStandingBuy] = await Promise.all([
    recoverySellSubmitted,
    nextStandingBuySubmitted,
  ])
  return { initialBuy: buy, recoverySell, nextStandingBuy }
}
