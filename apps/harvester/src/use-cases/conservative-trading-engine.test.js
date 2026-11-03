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

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  tradingRules: new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  }),
}
const tradingConfig = {
  settings: { minProfit: 0.01 },
  pairs: {
    DOGEUSDT: {
      enabled: true,
      investment: 1000,
      orderQuantity: 1,
      keepQuantity: 0.1,
      priceStepPercent: 0.05,
      makerPercent: 0,
      takerPercent: 0.075,
    },
  },
}

function createHarness({ cancelWithFill = false, eventPublisher } = {}) {
  const orders = []
  const pauses = []
  const accountedFills = []
  const broker = {
    placeOrder: async ({ order }) => {
      orders.push(order)
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "broker-" + order.clientOrderId,
          market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
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
        market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: new Quantity({
          amount: cancelWithFill ? "0.1" : "0",
          asset: baseAsset,
        }),
        status: "CANCELED",
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: 2,
        completedAt: 2,
      }),
    }),
    getFills: async ({ orderId }) => ({
      ok: true,
      data: cancelWithFill
        ? [new Fill({
            tradeId: "trailing-cancel-fill",
            brokerOrderId: orderId,
            market,
            side: "BUY",
            price: new Money({ amount: "99.95", asset: quoteAsset }),
            quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
            quoteQuantity: new Money({ amount: "9.995", asset: quoteAsset }),
            commissions: [],
            commissionStatus: "COMPLETE",
          })]
        : [],
    }),
  }
  const accountSnapshot = {
    getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
      ? new Quantity({ amount: "1000", asset: quoteAsset })
      : new Quantity({ amount: "0", asset: baseAsset }),
  }
  const engine = makeConservativeTradingEngine({
    broker,
    eventPublisher,
    tradingConfig,
    getPortfolio: () => new Portfolio(),
    getRecoveryLedger: () => RecoveryLedger.empty({ market }),
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting: async ({ fill }) => {
      accountedFills.push(fill)
      return { ok: true }
    },
    completeRecoveryCycle: async () => ({ ok: true, data: { eligible: true } }),
    canTrade: () => true,
    isStopping: () => false,
    onPause: async ({ reason }) => pauses.push(reason),
  })
  return { engine, orders, pauses, accountedFills }
}

test("trails an initial BUY upward only after one full step and replaces it below the latest trade", async () => {
  const { engine, orders, pauses } = createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].price, "99.95")

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })
  assert.equal(orders.length, 2)
  assert.equal(orders[1].price, "100")
  assert.deepEqual(pauses, [])

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.11", timestamp: 3 },
  })
  assert.equal(orders.length, 2)

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.11003", timestamp: 4 },
  })
  assert.equal(orders.length, 3)
  assert.equal(orders[2].price, "100.05")
})

test("reconciles and pauses when a BUY fills during trailing cancellation", async () => {
  const { engine, orders, pauses, accountedFills } = createHarness({ cancelWithFill: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })
  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  assert.equal(accountedFills.length, 1)
  assert.ok(pauses.includes("TRAILING_BUY_FILLED_DURING_CANCEL"))
})


test("publishes actionable decisions and order submission facts in execution order", async () => {
  const events = []
  const { engine, orders } = createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(orders.length, 1)
  assert.deepEqual(events.map(({ name }) => name), [
    "strategy.decision",
    "order.submission_requested",
    "order.submitted",
  ])
  assert.deepEqual(events[0].data, {
    strategy: "CONSERVATIVE",
    symbol: "DOGEUSDT",
    referencePrice: "100",
    actions: [{
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.95",
      quantity: "1",
      reason: "INITIAL_BUY",
    }],
  })
  assert.equal(events[1].data.status, "PENDING")
  assert.equal(events[1].data.clientOrderId, "h-DOGEUSDT-1")
  assert.equal(events[2].data.status, "OPEN")
  assert.equal(events[2].data.brokerOrderId, "broker-h-DOGEUSDT-1")
})

test("EventBus publication failure cannot prevent a broker order", async () => {
  const { engine, orders } = createHarness({
    eventPublisher: { publish: () => { throw new Error("observer unavailable") } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, true)
  assert.equal(orders.length, 1)
})
