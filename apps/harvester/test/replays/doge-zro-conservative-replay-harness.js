import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Commission, Fill, Money, Order, Quantity } from "@coinzilla/entities"
import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import {
  multiplyDecimal,
  percentageToRate,
} from "@coinzilla/utils"
import { createBinanceBrokerAdapter } from "../../src/infrastructure/brokers/binance-broker-adapter.js"
import { startHarvester } from "../../src/bootstrap/start-harvester.js"

function createOpenOrderSnapshot({ order }) {
  const openOrder = new Order({
    symbol: order.market.symbol,
    type: order.type,
    side: order.side,
    quantity: Number(order.originalQuantity.amount) - Number(order.executedQuantity.amount),
    price: Number(order.limitPrice.amount),
    id: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
  })
  openOrder.originalPrice = order.limitPrice.amount
  openOrder.originalQuantity = order.originalQuantity.amount
  openOrder.executedQuantity = order.executedQuantity.amount
  openOrder.status = order.status === "OPEN" ? "NEW" : "PARTIALLY_FILLED"
  return openOrder
}

function createExchangeMarketMetadata(marketSymbol, appConfig) {
  const baseAsset = marketSymbol.slice(0, -4)
  const marketConfiguration = appConfig.strategies.CG_coinGrabber.pairs[marketSymbol]
  return {
    symbol: marketSymbol,
    baseAsset,
    quoteAsset: "USDT",
    orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
    filters: [
      {
        filterType: "PRICE_FILTER",
        minPrice: "0",
        maxPrice: "100000",
        tickSize: marketConfiguration.pricePrecision === 5 ? "0.00001" : "0.001",
      },
      {
        filterType: "LOT_SIZE",
        minQty: marketConfiguration.quantityPrecision === 0 ? "1" : "0.01",
        maxQty: "100000000",
        stepSize: marketConfiguration.quantityPrecision === 0 ? "1" : "0.01",
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

function waitForSubmittedOrder(submittedCanonicalOrders, submittedOrderWaiters, marketSymbol, side, occurrence = 1) {
  const matches = (order) =>
    order.market.symbol === marketSymbol && order.side === side
  const getOrders = () => submittedCanonicalOrders.filter(matches)
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
      const index = submittedOrderWaiters.indexOf(waiter)
      if (index >= 0) submittedOrderWaiters.splice(index, 1)
      reject(new Error(
        "Timed out waiting for " + marketSymbol + " " + side + " order #" + occurrence +
        "; observed " + getOrders().length + " matching orders",
      ))
    }, 5000)
    submittedOrderWaiters.push(waiter)
  })
}

export async function createDogeTradingReplay({ marketSymbol, appConfig }) {
  const marketConfiguration = appConfig.strategies.CG_coinGrabber.pairs[marketSymbol]
  const dogeExchangeInfo = createExchangeMarketMetadata(marketSymbol, appConfig)
  const scenarioExpectations = {
    initialPrice: "0.07161000",
    buyPrice: "0.07157",
    nextBuyPrice: "0.07153",
    sellPrice: "0.07203",
    sellFillPrice: "0.07204",
    expectedSellQuantity: "398",
    expectedFreeQuantity: "1.6",
    expectedProfit: "0.01524808",
  }
  const submittedCanonicalOrders = []
  const brokerOrderPlacementRequests = []
  const receivedMarketPriceEvents = []
  const receivedExecutionReports = []
  const harvesterRuntimeErrors = []
  const marketPriceEventHandlers = new Map()
  const exchangeOpenOrders = new Map()
  const exchangeOrderHistory = new Map()
  const exchangeCanonicalFills = new Map()
  const confirmedCanceledOrders = []
  const submittedOrderWaiters = []
  let publishUserDataEvent
  let nextExchangeOrderId = 1
  let recoveryCycleCompletionResult
  let recoveryCycleCompletionWaiter

  const notifyOrderWaiters = () => {
    for (let index = submittedOrderWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = submittedOrderWaiters[index]
      if (!waiter.isReady()) continue
      submittedOrderWaiters.splice(index, 1)
      waiter.resolve()
    }
  }

  const waitForSubmittedOrderSide = (side, occurrence = 1) =>
    waitForSubmittedOrder(submittedCanonicalOrders, submittedOrderWaiters, marketSymbol, side, occurrence)

  const waitForRecoveryCycleCompletion = () => {
    if (recoveryCycleCompletionResult) return Promise.resolve(recoveryCycleCompletionResult)
    return new Promise((resolve, reject) => {
      const resolveCycle = (data) => {
        clearTimeout(timeout)
        resolve(data)
      }
      const timeout = setTimeout(() => {
        if (recoveryCycleCompletionWaiter === resolveCycle) recoveryCycleCompletionWaiter = undefined
        reject(new Error("Timed out waiting for recovery.cycle_completed for " + marketSymbol))
      }, 5000)
      recoveryCycleCompletionWaiter = resolveCycle
    })
  }

  const brokerFactory = ({ config: brokerConfig, logger }) => {
    const broker = new BinanceWebSocketBroker({
      apiKey: brokerConfig.apiKey,
      apiSecret: brokerConfig.apiSecret,
      tradingMode: brokerConfig.tradingMode,
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
        brokerOrderPlacementRequests.push({ method, params: { ...params } })
      }
      if (method === "exchangeInfo") {
        return { data: { symbols: [dogeExchangeInfo] } }
      }
      if (method === "myFilters") {
        return { data: { symbolFilters: [], exchangeFilters: [], assetFilters: [] } }
      }
      if (method === "ticker.price") {
        return { data: { symbol: marketSymbol, price: scenarioExpectations.initialPrice } }
      }
      if (method === "order.place") {
        const timestamp = Date.now()
        return {
          data: {
            symbol: params.symbol,
            orderId: nextExchangeOrderId++,
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
      const canonicalOrderCreationResult = await createCanonicalOrder(order)
      if (canonicalOrderCreationResult?.ok) {
        const canonicalOrder = canonicalOrderCreationResult.data
        // The replay assertions use exchange-shaped price/quantity fields while
        // the engine and broker now exchange canonical Money/Quantity values.
        submittedCanonicalOrders.push({
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
        exchangeOpenOrders.set(canonicalOrder.clientOrderId, canonicalOrder)
        exchangeOrderHistory.set(canonicalOrder.brokerOrderId, canonicalOrder)
        notifyOrderWaiters()
      }
      return canonicalOrderCreationResult
    }
    broker.getOpenOrders = async ({ symbol: requestedSymbol } = {}) => ({
      ok: true,
      data: [...exchangeOpenOrders.values()]
        .filter((order) => !requestedSymbol || order.market.symbol === requestedSymbol)
        .map((order) => createOpenOrderSnapshot({ order })),
    })
    broker.getFills = async ({ orderId } = {}) => ({
      ok: true,
      data: exchangeCanonicalFills.get(String(orderId)) ?? [],
    })
    broker.getCanonicalOrderHistory = async ({
      orderId,
      symbol: requestedSymbol,
    } = {}) => ({
      ok: true,
      data: [...exchangeOrderHistory.values()].filter(
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
        balances: [marketSymbol.slice(0, -4), "USDT"].map((code) => {
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
      publishUserDataEvent = (message) => {
        receivedExecutionReports.push(message.event)
        const executionFill = message.event?.fill
        const fillOrderId = executionFill?.brokerOrderId ?? executionFill?.orderId
        if (executionFill && fillOrderId !== undefined && fillOrderId !== null) {
          const brokerOrderId = String(fillOrderId)
          const order = exchangeOrderHistory.get(brokerOrderId)
          if (order) {
            const commissionAsset = executionFill.commissionAsset === order.market.baseAsset.code
              ? order.market.baseAsset
              : order.market.quoteAsset
            const commissions = executionFill.commissionAmount && executionFill.commissionAmount !== "0"
              ? [new Commission({
                amount: new Money({ amount: executionFill.commissionAmount, asset: commissionAsset }),
              })]
              : []
            // Match adaptCanonicalFill: Binance REST and user-data fills do not
            // include clientOrderId, so both sources produce identical canonical values.
            const canonicalFill = new Fill({
              tradeId: String(executionFill.tradeId ?? executionFill.id),
              brokerOrderId,
              market: order.market,
              side: executionFill.side,
              price: new Money({ amount: executionFill.price, asset: order.market.quoteAsset }),
              quantity: new Quantity({ amount: executionFill.quantity, asset: order.market.baseAsset }),
              quoteQuantity: new Money({ amount: executionFill.quoteQuantity, asset: order.market.quoteAsset }),
              liquidityRole: executionFill.isMaker ? "MAKER" : "TAKER",
              executedAt: executionFill.time,
              commissions,
              commissionStatus: "COMPLETE",
            })
            const canonicalFillsForOrder = exchangeCanonicalFills.get(brokerOrderId) ?? []
            canonicalFillsForOrder.push(canonicalFill)
            exchangeCanonicalFills.set(brokerOrderId, canonicalFillsForOrder)
          }
        }
        return onEvent(message)
      }
      return { data: { disconnect: async () => {} } }
    }
    // The replay harness must remain fully offline. Provide deterministic
    // completed candle history and a no-op live Kline subscription instead of
    // allowing the newly composed candle service to reach Binance.
    broker.getCandles = async ({ symbol: requestedSymbol, interval, limit = 101 } = {}) => {
      if (requestedSymbol !== marketSymbol || interval !== "1m") {
        throw new Error("Unexpected simulated candle request: " + requestedSymbol + " " + interval)
      }
      return {
        ok: true,
        data: Array.from({ length: Math.min(limit, 101) }, (_, index) => ({
          symbol: requestedSymbol,
          interval,
          openTime: index * 60_000,
          closeTime: index * 60_000 + 59_999,
          open: "1",
          high: "1.1",
          low: "0.9",
          close: "1",
          volume: "1",
          isClosed: index < Math.min(limit, 101) - 1,
        })),
      }
    }
    broker.subscribeForCandles = async ({ symbol: requestedSymbol, interval, onCandle } = {}) => {
      for (const index of [100, 101, 102]) {
        await onCandle({
          symbol: requestedSymbol,
          interval,
          openTime: index * 60_000,
          closeTime: index * 60_000 + 59_999,
          open: "1",
          high: "1.1",
          low: "0.9",
          close: "1",
          volume: "1",
          isClosed: true,
        })
      }
      return {
        ok: true,
        data: {
          stream: requestedSymbol.toLowerCase() + "@kline_" + interval,
          unsubscribe: async () => {},
        },
      }
    }
    broker.subscribeForPrices = async ({
      subscribedSymbol,
      symbol: requestedSymbol,
      onPrice,
    }) => {
      const targetMarketSymbol = requestedSymbol ?? subscribedSymbol ?? marketSymbol
      marketPriceEventHandlers.set(targetMarketSymbol, (event) => {
        receivedMarketPriceEvents.push(event)
        return onPrice(event)
      })
      return { ok: true, data: { unsubscribe: async () => {} } }
    }
    broker.subscribeForBookTicker = async () => ({
      ok: true,
      data: { unsubscribe: async () => {} },
    })
    broker.cancelOrder = async ({ orderId } = {}) => {
      const brokerOrderId = String(orderId)
      const order = exchangeOrderHistory.get(brokerOrderId)
      if (!order)
        return {
          ok: false,
          errors: [new Error("simulated exchange order not found")],
        }
      const timestamp = Date.now()
      const canceledCanonicalOrder = new CanonicalOrder({
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
      exchangeOpenOrders.delete(order.clientOrderId)
      exchangeOrderHistory.set(brokerOrderId, canceledCanonicalOrder)
      confirmedCanceledOrders.push(canceledCanonicalOrder)
      return { ok: true, data: canceledCanonicalOrder }
    }
    return broker
  }

  const runtime = await startHarvester({
    loadConfig: async () => appConfig,
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
      NODE_ENV: "development",
      TRADING_MODE: "testnet",
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
          recoveryCycleCompletionResult = event.data
          recoveryCycleCompletionWaiter?.(event.data)
          recoveryCycleCompletionWaiter = undefined
        }
        return { ok: true }
      },
      flush: async () => ({ ok: true, durable: true }),
    },
    logger: {
      info() {},
      debug() {},
      error: (entry) => harvesterRuntimeErrors.push(entry),
    },
  })

  assert.equal(runtime.userDataReady, true, "the replay must complete user-data reconciliation before accepting simulated market events")

  const publishMarketPrice = async (price) => {
    const marketPriceHandler = marketPriceEventHandlers.get(marketSymbol)
    assert.equal(typeof marketPriceHandler, "function", marketSymbol + " must have an active market-price subscription before a price event is published")
    await marketPriceHandler({
      eventType: "aggTrade",
      eventTime: Date.now(),
      timestamp: Date.now(),
      symbol: marketSymbol,
      price,
      quantity: "100",
      isBuyerMaker: false,
      wasBestPrice: true,
      aggId: Date.now(),
      firstId: Date.now(),
      lastId: Date.now(),
    })
  }

  const publishFullOrderFill = async ({ order, price, tradeId }) => {
    const executedBaseQuantity = order.originalQuantity.amount
    const executedQuoteQuantity = multiplyDecimal({ left: price, right: executedBaseQuantity })
    const executionCommissionRate = percentageToRate({
      percent: String(
        order.type === "LIMIT_MAKER" ? marketConfiguration.makerPercent : marketConfiguration.takerPercent,
      ),
    })
    const executionCommissionAsset =
      order.side === "BUY" ? order.market.baseAsset : order.market.quoteAsset
    const commissionCalculationBasis = order.side === "BUY" ? executedBaseQuantity : executedQuoteQuantity
    const executionCommissionAmount = multiplyDecimal({
      left: commissionCalculationBasis,
      right: executionCommissionRate,
    })
    const timestamp = Date.now()
    const fullyFilledCanonicalOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      side: order.side,
      type: order.type,
      limitPrice: order.limitPrice,
      originalQuantity: order.originalQuantity,
      executedQuantity: new Quantity({ amount: executedBaseQuantity, asset: order.market.baseAsset }),
      status: "FILLED",
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: timestamp,
      completedAt: timestamp,
    })
    exchangeOpenOrders.delete(order.clientOrderId)
    exchangeOrderHistory.set(order.brokerOrderId, fullyFilledCanonicalOrder)
    return publishUserDataEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: {
          symbol: marketSymbol,
          id: order.brokerOrderId,
          clientOrderId: order.clientOrderId,
          type: order.type,
          side: order.side,
          quantity: executedBaseQuantity,
          executedQuantity: executedBaseQuantity,
          price: order.limitPrice.amount,
          status: "FILLED",
          createdAt: order.createdAt,
          updatedAt: timestamp,
        },
        fill: {
          symbol: marketSymbol,
          id: tradeId,
          orderId: order.brokerOrderId,
          side: order.side,
          commissionAmount: executionCommissionAmount,
          commissionAsset: executionCommissionAsset.code,
          isMaker: order.type === "LIMIT_MAKER",
          price,
          quantity: executedBaseQuantity,
          quoteQuantity: executedQuoteQuantity,
          time: timestamp,
        },
      },
    })
  }

  return {
    runtime,
    symbol: marketSymbol,
    marketConfiguration,
    scenarioExpectations,
    submittedCanonicalOrders,
    confirmedCanceledOrders,
    brokerOrderPlacementRequests,
    receivedMarketPriceEvents,
    receivedExecutionReports,
    harvesterRuntimeErrors,
    waitForSubmittedOrder: waitForSubmittedOrderSide,
    waitForRecoveryCycleCompletion,
    publishMarketPrice,
    publishFullOrderFill,
  }
}

async function submitInitialBuyOrder(dogeTradingReplay) {
  const initialBuyOrderSubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY")
  await dogeTradingReplay.publishMarketPrice(dogeTradingReplay.scenarioExpectations.initialPrice)
  return initialBuyOrderSubmitted
}

async function submitFirstBuyAndWaitForRecoveryOrders(dogeTradingReplay) {
  const initialBuyOrder = await submitInitialBuyOrder(dogeTradingReplay)
  const recoverySellOrderSubmitted = dogeTradingReplay.waitForSubmittedOrder("SELL")
  const nextStandingBuyOrderSubmitted = dogeTradingReplay.waitForSubmittedOrder("BUY", 2)

  await dogeTradingReplay.publishMarketPrice(dogeTradingReplay.scenarioExpectations.buyPrice)
  await dogeTradingReplay.publishFullOrderFill({
    order: initialBuyOrder,
    price: dogeTradingReplay.scenarioExpectations.buyPrice,
    tradeId: "645",
  })

  try {
    const [recoverySellOrder, nextStandingBuyOrder] = await Promise.all([
      recoverySellOrderSubmitted,
      nextStandingBuyOrderSubmitted,
    ])
    return { initialBuyOrder, recoverySellOrder, nextStandingBuyOrder }
  } catch (error) {
    const runtimeErrorDetails = dogeTradingReplay.harvesterRuntimeErrors.map(
      (runtimeError) => ({
        message: runtimeError.message,
        symbol: runtimeError.symbol,
        side: runtimeError.side,
        orderStatus: runtimeError.orderStatus,
        errors: runtimeError.errors?.map(
          (underlyingError) => underlyingError.message ?? String(underlyingError),
        ),
      }),
    )
    error.message += "\nHarvester runtime errors: " + JSON.stringify(runtimeErrorDetails)
    throw error
  }
}
