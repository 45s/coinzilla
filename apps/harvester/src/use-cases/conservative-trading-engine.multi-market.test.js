import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"

const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const dogeAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const solAsset = new Asset({ id: "asset:SOL", code: "SOL" })
const markets = [
  new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset: dogeAsset, quoteAsset }),
  new Market({ venue: "binance", symbol: "SOLUSDT", baseAsset: solAsset, quoteAsset }),
]
const marketsBySymbol = new Map(markets.map((market) => [market.symbol, market]))
const marketsById = new Map(markets.map((market) => [market.id, market]))
const assetsById = new Map([
  [quoteAsset.id, quoteAsset],
  [dogeAsset.id, dogeAsset],
  [solAsset.id, solAsset],
])

function makeMarketMetadata(market) {
  return {
    market,
    orderType: "LIMIT_MAKER",
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    tradingRules: new TradingRules({
      market,
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: market.baseAsset }) },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: market.baseAsset }) },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
      ],
    }),
  }
}

function createHarness() {
  const orders = []
  const pauses = []
  const accountedTradeIds = new Set()
  const accountedFills = []
  const portfolio = new Portfolio()
  const metadataBySymbol = new Map(markets.map((market) => [
    market.symbol,
    makeMarketMetadata(market),
  ]))
  const tradingConfig = {
    settings: { minProfit: 0.01 },
    pairs: Object.fromEntries(markets.map((market) => [market.symbol, {
      enabled: true,
      investment: 1000,
      orderQuantity: 1,
      keepQuantity: 0.1,
      priceStepPercent: 0.05,
      makerPercent: 0,
      takerPercent: 0.075,
    }])),
  }
  const broker = {
    placeOrder: async ({ order }) => {
      orders.push(order)
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "broker-" + order.clientOrderId,
          market: order.market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: order.market.quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: order.market.baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: order.market.baseAsset }),
          status: "OPEN",
          createdAt: 1,
          acknowledgedAt: 1,
          updatedAt: 1,
        }),
      }
    },
    cancelOrder: async ({ order }) => ({
      ok: true,
      data: new CanonicalOrder({
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
        updatedAt: 2,
        completedAt: 2,
      }),
    }),
    getFills: async () => ({ ok: true, data: [] }),
  }
  const engine = makeConservativeTradingEngine({
    broker,
    tradingConfig,
    getPortfolio: () => portfolio,
    getRecoveryLedger: ({ marketId }) => RecoveryLedger.empty({ market: marketsById.get(marketId) }),
    getMarketMetadata: ({ symbol }) => metadataBySymbol.get(symbol),
    getAccountSnapshot: () => ({
      getFreeBalance: ({ assetId }) => new Quantity({
        amount: "10000",
        asset: assetsById.get(assetId),
      }),
    }),
    updateTradingAccounting: async ({ fill }) => {
      if (accountedTradeIds.has(fill.tradeId)) {
        return { ok: true, data: { applied: false, duplicate: true } }
      }
      accountedTradeIds.add(fill.tradeId)
      accountedFills.push(fill)
      return { ok: true, data: { applied: true, duplicate: false } }
    },
    completeRecoveryCycle: async () => ({
      ok: true,
      data: { eligible: true, freeQuantity: "0.1", realizedNetProfit: "1" },
    }),
    canTrade: () => true,
    isStopping: () => false,
    onPause: async ({ symbol, reason }) => pauses.push({ symbol, reason }),
  })

  return { engine, orders, pauses, accountedFills }
}

async function startBothMarkets(engine) {
  for (const market of markets) {
    const result = await engine.processMarketPrice({
      symbol: market.symbol,
      priceEvent: { symbol: market.symbol, price: "100", timestamp: 1 },
    })
    assert.equal(result.ok, true)
  }
}

function makePartialFillEvent({ order, tradeId, quantity, quoteQuantity }) {
  const executedOrder = new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({ amount: quantity, asset: order.market.baseAsset }),
    status: "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: 2,
  })
  const fill = new Fill({
    tradeId,
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market: order.market,
    side: order.side,
    price: order.limitPrice,
    quantity: new Quantity({ amount: quantity, asset: order.market.baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: order.market.quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
    executedAt: 2,
  })
  return { executionType: "TRADE", executedOrder, fill }
}

test("an unowned order in one market pauses only that market and cannot block another market fill", async () => {
  const { engine, pauses, accountedFills } = createHarness()
  await startBothMarkets(engine)
  const dogeOrder = engine.getOrders().find((order) => order.market.symbol === "DOGEUSDT")
  const solMarket = marketsBySymbol.get("SOLUSDT")
  const unownedSolOrder = new CanonicalOrder({
    clientOrderId: "manual-sol-client",
    brokerOrderId: "manual-sol-order",
    market: solMarket,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "99.95", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: solAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: solAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  const unowned = await engine.processUserDataEvent({
    event: { eventType: "executionReport", executedOrder: unownedSolOrder },
  })
  assert.equal(unowned.ok, false)
  assert.deepEqual(pauses, [{
    symbol: "SOLUSDT",
    reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT",
  }])
  assert.deepEqual(accountedFills, [])

  const dogeFillEvent = makePartialFillEvent({
    order: dogeOrder,
    tradeId: "doge-execution-1",
    quantity: "0.4",
    quoteQuantity: "39.98",
  })
  const accepted = await engine.processUserDataEvent({ event: dogeFillEvent })

  assert.equal(accepted.ok, true)
  assert.equal(accepted.data.waitingForFullFill, true)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), ["doge-execution-1"])
  assert.deepEqual(engine.getPausedMarkets(), ["SOLUSDT"])
})

test("duplicate fills and stale order updates do not double-account across markets", async () => {
  const { engine, pauses, accountedFills } = createHarness()
  await startBothMarkets(engine)
  const dogeOrder = engine.getOrders().find((order) => order.market.symbol === "DOGEUSDT")
  const solOrder = engine.getOrders().find((order) => order.market.symbol === "SOLUSDT")
  const dogeEvent = makePartialFillEvent({
    order: dogeOrder,
    tradeId: "doge-execution-2",
    quantity: "0.4",
    quoteQuantity: "39.98",
  })
  const solEvent = makePartialFillEvent({
    order: solOrder,
    tradeId: "sol-execution-1",
    quantity: "0.3",
    quoteQuantity: "29.985",
  })

  const dogeResult = await engine.processUserDataEvent({ event: dogeEvent })
  const solResult = await engine.processUserDataEvent({ event: solEvent })
  const duplicate = await engine.processUserDataEvent({ event: dogeEvent })
  const staleOpen = new CanonicalOrder({
    clientOrderId: dogeOrder.clientOrderId,
    brokerOrderId: dogeOrder.brokerOrderId,
    market: dogeOrder.market,
    side: dogeOrder.side,
    type: dogeOrder.type,
    limitPrice: dogeOrder.limitPrice,
    originalQuantity: dogeOrder.originalQuantity,
    executedQuantity: new Quantity({ amount: "0", asset: dogeAsset }),
    status: "OPEN",
    createdAt: dogeOrder.createdAt,
    acknowledgedAt: dogeOrder.acknowledgedAt,
    updatedAt: 1,
  })
  const stale = await engine.processUserDataEvent({ event: { executedOrder: staleOpen } })

  assert.equal(dogeResult.ok, true)
  assert.equal(solResult.ok, true)
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.ignored, true)
  assert.equal(stale.ok, true)
  assert.equal(stale.data.ignored, true)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), [
    "doge-execution-2",
    "sol-execution-1",
  ])
  assert.equal(engine.getOrders().find((order) => order.market.symbol === "DOGEUSDT").status, "PARTIALLY_FILLED")
  assert.equal(engine.getOrders().find((order) => order.market.symbol === "SOLUSDT").status, "PARTIALLY_FILLED")
  assert.deepEqual(pauses, [])
})
