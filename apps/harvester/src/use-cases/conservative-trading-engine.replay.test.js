import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"
import { startHarvester } from "../bootstrap/start-harvester.js"

const tradingConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        minProfit: 0.01,
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        BTCUSDT: {
          enabled: true,
          investment: 100,
          orderQuantity: 0.001,
          keepQuantity: 0.0001,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
        },
      },
    },
  },
}

function createMarketMetadata() {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  })
  return { market, tradingRules, supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"] }
}

const eventPublisher = {
  publish: () => ({ ok: true }),
  flush: async () => ({ ok: true, durable: true }),
}

function createMockBroker() {
  const metadata = createMarketMetadata()
  const priceHandlers = new Map()
  const bookHandlers = new Map()
  let userDataHandlers
  let fillHistory = []
  let placedOrder
  let acknowledgedOrder

  const broker = {
    placedOrder: () => placedOrder,
    connect: async () => {},
    disconnect: async () => {},
    getSymbolFilters: async () => ({ ok: true, data: metadata }),
    getAccountSnapshot: async () => ({
      ok: true,
      data: {
        sourceTime: 1,
        balances: ["BTC", "USDT"].map((code) => {
          const asset = code === "BTC" ? metadata.market.baseAsset : metadata.market.quoteAsset
          return new Balance({
            free: new Quantity({ amount: code === "USDT" ? "1000" : "0", asset }),
            locked: new Quantity({ amount: "0", asset }),
          })
        }),
      },
    }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    getCanonicalOrder: async () => ({ ok: false, errors: [new Error("not found")] }),
    getFills: async ({ orderId }) => ({
      ok: true,
      data: fillHistory.filter((fill) => fill.brokerOrderId === orderId),
    }),
    getPrices: async ({ symbol }) => ({ ok: true, data: { symbol, price: "65000" } }),
    subscribeForPrices: async ({ symbol, onPrice }) => {
      priceHandlers.set(symbol, onPrice)
      return { ok: true, data: { unsubscribe: async () => {} } }
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker }) => {
      bookHandlers.set(symbol, onBookTicker)
      return { ok: true, data: { unsubscribe: async () => {} } }
    },
    subscribeForUserData: async (handlers) => {
      userDataHandlers = handlers
      return { ok: true, data: { disconnect: async () => {} } }
    },
    placeOrder: async ({ order }) => {
      placedOrder = order
      acknowledgedOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: "mock-exchange-order-1",
        market: metadata.market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: metadata.market.quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: metadata.market.baseAsset }),
        executedQuantity: new Quantity({ amount: "0", asset: metadata.market.baseAsset }),
        status: "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
      })
      return { ok: true, data: acknowledgedOrder }
    },
    emitPrice: async (price, timestamp) => {
      await priceHandlers.get("BTCUSDT")?.({
        eventType: "aggTrade",
        symbol: "BTCUSDT",
        price,
        timestamp,
      })
    },
    fillPlacedOrder: async () => {
      assert.ok(acknowledgedOrder, "strategy must submit and register a BUY before the mock exchange fills it")
      const quote = multiplyDecimal({
        left: placedOrder.price,
        right: placedOrder.quantity,
      })
      const fill = new Fill({
        tradeId: "mock-trade-1",
        brokerOrderId: acknowledgedOrder.brokerOrderId,
        clientOrderId: acknowledgedOrder.clientOrderId,
        market: metadata.market,
        side: "BUY",
        price: new Money({ amount: placedOrder.price, asset: metadata.market.quoteAsset }),
        quantity: new Quantity({ amount: placedOrder.quantity, asset: metadata.market.baseAsset }),
        quoteQuantity: new Money({ amount: quote, asset: metadata.market.quoteAsset }),
        commissions: [],
        commissionStatus: "COMPLETE",
      })
      fillHistory = [fill]
      const filledOrder = new CanonicalOrder({
        clientOrderId: acknowledgedOrder.clientOrderId,
        brokerOrderId: acknowledgedOrder.brokerOrderId,
        market: metadata.market,
        side: acknowledgedOrder.side,
        type: acknowledgedOrder.type,
        limitPrice: acknowledgedOrder.limitPrice,
        originalQuantity: acknowledgedOrder.originalQuantity,
        executedQuantity: acknowledgedOrder.originalQuantity,
        status: "FILLED",
        createdAt: acknowledgedOrder.createdAt,
        acknowledgedAt: acknowledgedOrder.acknowledgedAt,
        updatedAt: 2,
        completedAt: 2,
      })
      userDataHandlers.onEvent({
        event: {
          eventType: "executionReport",
          executionType: "TRADE",
          executedOrder: filledOrder,
          fill,
        },
      })
      return fill
    },
  }
  return broker
}

test("start-harvester BUY flow: strategy prices an order, mock broker fills it, registry and Portfolio account it", async () => {
  const broker = createMockBroker()
  let resolveAccounted
  const accounted = new Promise((resolve) => { resolveAccounted = resolve })
  const runtime = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {
      HARVESTER_BROKER: "binance",
      HARVESTER_ENABLE_TRADING: "true",
      HARVESTER_TRADING_MODE: "testnet",
      NODE_ENV: "test",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    now: () => 100,
    onUserDataEvent: async ({ event, portfolio, recoveryLedger }) => {
      if (event?.executionType === "TRADE") resolveAccounted({ portfolio, recoveryLedger })
    },
    logger: { info() {}, error() {}, debug() {} },
  })

  try {
    assert.equal(runtime.tradingEnabled, true)
    assert.equal(runtime.userDataReady, true)

    await broker.emitPrice("65000", 100)

    const submitted = broker.placedOrder()
    assert.ok(submitted, "a market-price event should cause the real Conservative strategy to submit a BUY")
    assert.equal(submitted.side, "BUY")
    assert.equal(submitted.type, "LIMIT_MAKER")
    assert.equal(submitted.price, "64967.5")
    assert.equal(submitted.quantity, "0.001")
    assert.equal(multiplyDecimal({ left: submitted.price, right: submitted.quantity }), "64.9675")

    const fill = await broker.fillPlacedOrder()
    const accountedState = await Promise.race([
      accounted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("mock execution was not accounted")), 2_000)),
    ])

    assert.equal(accountedState.portfolio.getPosition({ marketId: fill.market.id }).baseQuantity.amount, "0.001")
    assert.equal(accountedState.portfolio.getPosition({ marketId: fill.market.id }).spent.amount, "64.9675")
    assert.equal(accountedState.recoveryLedger.buyCost, "64.9675")
    assert.equal(accountedState.recoveryLedger.netSellProceeds, "0")
    assert.equal(accountedState.portfolio.appliedFillIds.length, 1)
    assert.equal(accountedState.recoveryLedger.appliedFillIds.length, 1)
    assert.equal(runtime.portfolio.getPosition({ marketId: fill.market.id }).baseQuantity.amount, "0.001")
  } finally {
    await runtime.stop()
  }
})
