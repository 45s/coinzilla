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

function createHarness({ cancelWithFill = false, placeOrderGate, onPlaceOrderStarted } = {}) {
  const orders = []
  const pauses = []
  const accountedFills = []
  const cancellationIds = []
  const broker = {
    placeOrder: async ({ order }) => {
      orders.push(order)
      onPlaceOrderStarted?.({ order })
      if (placeOrderGate) await placeOrderGate.promise
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
    cancelOrder: async ({ order }) => {
      cancellationIds.push(order.brokerOrderId)
      return {
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
      }
    },
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
  return { engine, orders, pauses, accountedFills, cancellationIds }
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


test("serializes market transitions until broker acknowledgement before cancel/replace", async () => {
  let resolveAcknowledgement
  const placeOrderGate = {
    promise: new Promise((resolve) => { resolveAcknowledgement = resolve }),
  }
  let signalPlaceOrderStarted
  const placeOrderStarted = new Promise((resolve) => { signalPlaceOrderStarted = resolve })
  const { engine, orders, cancellationIds } = createHarness({
    placeOrderGate,
    onPlaceOrderStarted: () => signalPlaceOrderStarted(),
  })

  const initialPrice = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  await placeOrderStarted

  const risingPrice = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })

  assert.equal(orders.length, 1)
  assert.deepEqual(cancellationIds, [])

  resolveAcknowledgement()
  const [initialResult, replacementResult] = await Promise.all([initialPrice, risingPrice])

  assert.equal(initialResult.ok, true)
  assert.equal(replacementResult.ok, true)
  assert.equal(cancellationIds.length, 1)
  assert.equal(cancellationIds[0], "broker-h-DOGEUSDT-1")
  assert.equal(orders.length, 2)
})
