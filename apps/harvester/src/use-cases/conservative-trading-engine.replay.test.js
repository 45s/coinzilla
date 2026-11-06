import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { addDecimal, divideDecimal, multiplyDecimal, subtractDecimal } from "@coinzilla/utils"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"

const baseAsset = new Asset({ id: "zro", code: "ZRO" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})

const marketMetadata = { market }

const tradingConfig = await loadTradingConfig()
const zroPairConfig = tradingConfig.strategies.CG_coinGrabber.pairs.ZROUSDT

// These are the eight confirmed BUY executions from the 2026-11-06 ZROUSDT
// history. Quote amounts are exchange-reported facts, not recomputed prices.
const historicalBuys = [
  { tradeId: "11658", price: "1.604", quantity: "5", quote: "8.020" },
  { tradeId: "11659", price: "1.603", quantity: "5", quote: "8.015" },
  { tradeId: "11660", price: "1.602", quantity: "5", quote: "8.010" },
  { tradeId: "11661", price: "1.601", quantity: "5", quote: "8.005" },
  { tradeId: "11662", price: "1.600", quantity: "5", quote: "8.000" },
  { tradeId: "11663", price: "1.599", quantity: "5", quote: "7.995" },
  { tradeId: "11664", price: "1.598", quantity: "5", quote: "7.990" },
  { tradeId: "11665", price: "1.597", quantity: "5", quote: "7.985" },
]

function makeHistoricalBuyFill({ tradeId, price, quantity, quote }) {
  return new Fill({
    tradeId,
    brokerOrderId: "historical-buy-" + tradeId,
    clientOrderId: "historical-zro-buy-" + tradeId,
    market,
    side: "BUY",
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quote, asset: quoteAsset }),
    commissions: [
      new Commission({
        amount: new Money({ amount: String(zroPairConfig.orderQuantity * zroPairConfig.makerPercent / 100), asset: baseAsset }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function makeOrder({ status, executedQuantity }) {
  return new CanonicalOrder({
    clientOrderId: "historical-zro-sell-727904",
    brokerOrderId: "727904",
    market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "1.606", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "39.91", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: status === "FILLED" ? 2 : 1,
    ...(status === "FILLED" ? { completedAt: 2 } : {}),
  })
}

test("replays ZROUSDT trade 11666 without completing recovery while 0.05 ZRO remains above keepQuantity", async () => {
  // Seed only confirmed BUY fills. No market-price observations or missing
  // historical exchange-filter values are invented for this execution replay.
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })

  for (const trade of historicalBuys) {
    const fill = makeHistoricalBuyFill(trade)
    portfolio = portfolio.applyFill({ fill }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill }).ledger
  }

  const initialPosition = portfolio.getPosition({ marketId: market.id })
  assert.equal(initialPosition.baseQuantity.amount, "39.96")
  assert.equal(initialPosition.spent.amount, "64.02")
  assert.equal(recoveryLedger.buyCost, "64.02")

  const openSell = makeOrder({ status: "OPEN", executedQuantity: "0" })
  const sellFill = new Fill({
    tradeId: "11666",
    brokerOrderId: "727904",
    clientOrderId: openSell.clientOrderId,
    market,
    side: "SELL",
    price: new Money({ amount: "1.606", asset: quoteAsset }),
    quantity: new Quantity({ amount: "39.91", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "64.09546", asset: quoteAsset }),
    commissions: [
      new Commission({
        amount: new Money({ amount: "0.06409546", asset: quoteAsset }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })

  const completionEvaluations = []
  const accountedFills = []
  const pauses = []
  const accountSnapshot = {
    getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
      ? new Quantity({ amount: "1000", asset: quoteAsset })
      : new Quantity({ amount: "0", asset: baseAsset }),
  }

  const engine = makeConservativeTradingEngine({
    broker: {
      placeOrder: async () => ({ ok: false, errors: [new Error("Unexpected order submission in fill replay")] }),
      cancelOrder: async () => ({ ok: false, errors: [new Error("Unexpected cancellation in fill replay")] }),
      getFills: async ({ orderId }) => ({
        ok: true,
        data: accountedFills.filter((fill) => fill.brokerOrderId === orderId),
      }),
      getCanonicalOrder: async () => ({ ok: false, errors: [new Error("Unexpected canonical-order lookup")] }),
      getOpenOrders: async () => ({ ok: true, data: [] }),
      getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    },
    strategyPolicy: conservativeStrategyPolicy,
    tradingConfig,
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting: async ({ fill }) => {
      const portfolioUpdate = portfolio.applyFill({ fill })
      const ledgerUpdate = recoveryLedger.applyFill({ fill })
      portfolio = portfolioUpdate.portfolio
      recoveryLedger = ledgerUpdate.ledger
      if (portfolioUpdate.applied && ledgerUpdate.applied) accountedFills.push(fill)
      return {
        ok: true,
        data: {
          applied: portfolioUpdate.applied && ledgerUpdate.applied,
          duplicate: portfolioUpdate.duplicate || ledgerUpdate.duplicate,
        },
      }
    },
    completeRecoveryCycle: async ({ marketId, keepQuantity, minProfit }) => {
      const position = portfolio.getPosition({ marketId })
      const completion = evaluateRecoveryCompletion({
        sellOrderFullyFilled: true,
        spent: position.spent.amount,
        netSellProceeds: recoveryLedger.netSellProceeds,
        activeQuantity: position.baseQuantity.amount,
        keepQuantity,
        minProfit,
      })
      completionEvaluations.push(completion)
      if (completion.eligible) {
        portfolio = portfolio.allocateFreeQuantity({
          marketId,
          quantity: completion.freeQuantity,
        })
        portfolio = portfolio.resetRecoveryBasis({ marketId })
        recoveryLedger = recoveryLedger.resetCycle()
      }
      return { ok: true, data: completion }
    },
    canTrade: () => true,
    onPause: async ({ reason }) => pauses.push(reason),
    isStopping: () => false,
    isMarketPriceFresh: () => true,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [openSell] }),
    },
  })

  const event = {
    eventType: "executionReport",
    executionType: "TRADE",
    executedOrder: makeOrder({ status: "FILLED", executedQuantity: "39.91" }),
    fill: sellFill,
  }
  const result = await engine.processUserDataEvent({ event })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.residualSellThrough, true)
  assert.equal(result.data.reevaluate, true)
  assert.equal(completionEvaluations.length, 1)
  assert.equal(completionEvaluations[0].eligible, false)
  assert.equal(completionEvaluations[0].reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  assert.equal(completionEvaluations[0].realizedNetProfit, "0.01136454")

  const positionAfterSell = portfolio.getPosition({ marketId: market.id })
  assert.equal(positionAfterSell.baseQuantity.amount, "0.05")
  assert.equal(positionAfterSell.freeBaseQuantity.amount, "0")
  assert.equal(positionAfterSell.spent.amount, "64.02")
  assert.equal(recoveryLedger.buyCost, "64.02")
  assert.equal(recoveryLedger.netSellProceeds, "64.03136454")
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "0")
  assert.equal(portfolio.appliedFillIds.length, 9)
  assert.equal(recoveryLedger.appliedFillIds.length, 9)
  assert.deepEqual(pauses, [])

  // A duplicate terminal execution report must not apply the SELL twice,
  // allocate inventory, or reset the still-open recovery basis.
  const duplicate = await engine.processUserDataEvent({ event })
  assert.equal(duplicate.ok, true, duplicate.errors?.[0]?.message)
  assert.equal(duplicate.data.ignored, true)
  assert.equal(completionEvaluations.length, 1)
  assert.equal(portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "0.05")
  assert.equal(recoveryLedger.netSellProceeds, "64.03136454")
})

// Actual DOGEUSDT executions from AUDIT_DOGE_TRADES_2026-11-06.md.
// These are the three BUY fills preceding SELL order 1276698 and its two
// exchange-reported SELL fills. The SELL occurred after the observed shutdown;
// this test replays the exchange execution facts through the engine boundary.
const historicalDogeBuys = [
  { tradeId: "221733", price: "0.07157", quantity: "400", quote: "28.628", commission: "0.4" },
  { tradeId: "221736", price: "0.07153", quantity: "400", quote: "28.612", commission: "0.4" },
  { tradeId: "221738", price: "0.07149", quantity: "400", quote: "28.596", commission: "0.4" },
]
const historicalDogeSells = [
  { tradeId: "221990", quantity: "278", quote: "19.97430000", commission: "0.01997430" },
  { tradeId: "221991", quantity: "918", quote: "65.95830000", commission: "0.06595830" },
]

test("replays DOGEUSDT order 1276698 and preserves the recovery basis with 2.8 DOGE above keepQuantity", async () => {
  const dogePairConfig = tradingConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT
  assert.ok(dogePairConfig)
  assert.equal(dogePairConfig.enabled, true)

  // Asset identity is supplied by market metadata, not strategy config.
  const dogeAsset = new Asset({ id: "doge", code: "DOGE" })
  const dogeMarket = new Market({
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAsset: dogeAsset,
    quoteAsset,
  })
  const makeDogeFill = ({ tradeId, side, price, quantity, quote, commission, commissionAsset }) =>
    new Fill({
      tradeId,
      brokerOrderId: side === "BUY" ? "historical-doge-buy-" + tradeId : "1276698",
      clientOrderId: side === "BUY" ? "historical-doge-buy-" + tradeId : "historical-doge-sell-1276698",
      market: dogeMarket,
      side,
      price: new Money({ amount: price, asset: quoteAsset }),
      quantity: new Quantity({ amount: quantity, asset: dogeAsset }),
      quoteQuantity: new Money({ amount: quote, asset: quoteAsset }),
      commissions: [
        new Commission({
          amount: new Money({
            amount: commission,
            asset: commissionAsset === "DOGE" ? dogeAsset : quoteAsset,
          }),
        }),
      ],
      commissionStatus: "COMPLETE",
    })

  const buyFills = historicalDogeBuys.map((trade) => makeDogeFill({
    ...trade,
    side: "BUY",
    commissionAsset: "DOGE",
  }))
  const sellFills = historicalDogeSells.map((trade) => makeDogeFill({
    ...trade,
    side: "SELL",
    price: "0.07185",
    commissionAsset: "USDT",
  }))

  const sum = (values) => values.reduce(
    (total, value) => addDecimal({ left: total, right: value }),
    "0",
  )
  const expectedGrossBought = sum(buyFills.map((fill) => fill.quantity.amount))
  const expectedBuyCommissions = sum(buyFills.map((fill) => fill.commissions[0].amount.amount))
  const expectedNetBought = subtractDecimal({
    left: expectedGrossBought,
    right: expectedBuyCommissions,
  })
  const expectedBuyCost = sum(buyFills.map((fill) => fill.quoteQuantity.amount))
  const expectedGrossSold = sum(sellFills.map((fill) => fill.quantity.amount))
  const expectedGrossSellProceeds = sum(sellFills.map((fill) => fill.quoteQuantity.amount))
  const expectedSellCommissions = sum(sellFills.map((fill) => fill.commissions[0].amount.amount))
  const expectedNetSellProceeds = subtractDecimal({
    left: expectedGrossSellProceeds,
    right: expectedSellCommissions,
  })
  const expectedResidual = subtractDecimal({
    left: expectedNetBought,
    right: expectedGrossSold,
  })
  const expectedRealizedProfit = subtractDecimal({
    left: expectedNetSellProceeds,
    right: expectedBuyCost,
  })

  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market: dogeMarket })
  for (const fill of buyFills) {
    portfolio = portfolio.applyFill({ fill }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill }).ledger
  }

  const sellOrder = new CanonicalOrder({
    clientOrderId: "historical-doge-sell-1276698",
    brokerOrderId: "1276698",
    market: dogeMarket,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({ amount: "0.07185", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: expectedGrossSold, asset: dogeAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: dogeAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  const accountedFills = []
  const completionEvaluations = []
  const pauses = []
  const engine = makeConservativeTradingEngine({
    broker: {
      placeOrder: async () => ({ ok: false, errors: [new Error("Unexpected order submission in historical replay")] }),
      cancelOrder: async () => ({ ok: false, errors: [new Error("Unexpected cancellation in historical replay")] }),
      getFills: async ({ orderId }) => ({
        ok: true,
        data: accountedFills.filter((fill) => fill.brokerOrderId === orderId),
      }),
      getCanonicalOrder: async () => ({ ok: false, errors: [new Error("Unexpected canonical-order lookup")] }),
      getOpenOrders: async () => ({ ok: true, data: [] }),
      getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    },
    strategyPolicy: conservativeStrategyPolicy,
    tradingConfig,
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    getMarketMetadata: () => ({ market: dogeMarket }),
    getAccountSnapshot: () => ({
      getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
        ? new Quantity({ amount: "1000", asset: quoteAsset })
        : new Quantity({ amount: "0", asset: dogeAsset }),
    }),
    updateTradingAccounting: async ({ fill }) => {
      const portfolioUpdate = portfolio.applyFill({ fill })
      const ledgerUpdate = recoveryLedger.applyFill({ fill })
      portfolio = portfolioUpdate.portfolio
      recoveryLedger = ledgerUpdate.ledger
      if (portfolioUpdate.applied && ledgerUpdate.applied) accountedFills.push(fill)
      return {
        ok: true,
        data: {
          applied: portfolioUpdate.applied && ledgerUpdate.applied,
          duplicate: portfolioUpdate.duplicate || ledgerUpdate.duplicate,
        },
      }
    },
    completeRecoveryCycle: async ({ marketId, keepQuantity, minProfit }) => {
      const position = portfolio.getPosition({ marketId })
      const completion = evaluateRecoveryCompletion({
        sellOrderFullyFilled: true,
        spent: position.spent.amount,
        netSellProceeds: recoveryLedger.netSellProceeds,
        activeQuantity: position.baseQuantity.amount,
        keepQuantity,
        minProfit,
      })
      completionEvaluations.push(completion)
      if (completion.eligible) {
        portfolio = portfolio.allocateFreeQuantity({
          marketId,
          quantity: completion.freeQuantity,
        })
        portfolio = portfolio.resetRecoveryBasis({ marketId })
        recoveryLedger = recoveryLedger.resetCycle()
      }
      return { ok: true, data: completion }
    },
    canTrade: () => true,
    onPause: async ({ reason }) => pauses.push(reason),
    isStopping: () => false,
    isMarketPriceFresh: () => true,
    initialState: { orderRegistry: new OrderRegistry({ orders: [sellOrder] }) },
  })

  const partialSellOrder = new CanonicalOrder({
    clientOrderId: sellOrder.clientOrderId,
    brokerOrderId: sellOrder.brokerOrderId,
    market: dogeMarket,
    side: "SELL",
    type: sellOrder.type,
    limitPrice: sellOrder.limitPrice,
    originalQuantity: sellOrder.originalQuantity,
    executedQuantity: new Quantity({ amount: historicalDogeSells[0].quantity, asset: dogeAsset }),
    status: "PARTIALLY_FILLED",
    createdAt: sellOrder.createdAt,
    acknowledgedAt: sellOrder.acknowledgedAt,
    updatedAt: 2,
  })
  const filledSellOrder = new CanonicalOrder({
    clientOrderId: sellOrder.clientOrderId,
    brokerOrderId: sellOrder.brokerOrderId,
    market: dogeMarket,
    side: "SELL",
    type: sellOrder.type,
    limitPrice: sellOrder.limitPrice,
    originalQuantity: sellOrder.originalQuantity,
    executedQuantity: sellOrder.originalQuantity,
    status: "FILLED",
    createdAt: sellOrder.createdAt,
    acknowledgedAt: sellOrder.acknowledgedAt,
    updatedAt: 3,
    completedAt: 3,
  })

  const firstExecution = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: partialSellOrder,
      fill: sellFills[0],
    },
  })
  assert.equal(firstExecution.ok, true, firstExecution.errors?.[0]?.message)

  const finalExecutionEvent = {
    eventType: "executionReport",
    executionType: "TRADE",
    executedOrder: filledSellOrder,
    fill: sellFills[1],
  }
  const finalExecution = await engine.processUserDataEvent({ event: finalExecutionEvent })

  assert.equal(finalExecution.ok, true, finalExecution.errors?.[0]?.message)
  assert.equal(completionEvaluations.length, 1)
  assert.equal(completionEvaluations[0].eligible, false)
  assert.equal(completionEvaluations[0].reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  assert.equal(completionEvaluations[0].realizedNetProfit, expectedRealizedProfit)

  const positionAfterSell = portfolio.getPosition({ marketId: dogeMarket.id })
  assert.equal(positionAfterSell.baseQuantity.amount, expectedResidual)
  assert.equal(positionAfterSell.freeBaseQuantity.amount, "0")
  assert.equal(positionAfterSell.spent.amount, expectedBuyCost)
  assert.equal(recoveryLedger.buyCost, expectedBuyCost)
  assert.equal(recoveryLedger.netSellProceeds, expectedNetSellProceeds)
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "0")
  assert.equal(portfolio.appliedFillIds.length, buyFills.length + sellFills.length)
  assert.equal(recoveryLedger.appliedFillIds.length, buyFills.length + sellFills.length)
  assert.deepEqual(pauses, [])

  const duplicate = await engine.processUserDataEvent({ event: finalExecutionEvent })
  assert.equal(duplicate.ok, true, duplicate.errors?.[0]?.message)
  assert.equal(duplicate.data.ignored, true)
  assert.equal(completionEvaluations.length, 1)
  assert.equal(portfolio.getPosition({ marketId: dogeMarket.id }).baseQuantity.amount, expectedResidual)
  assert.equal(recoveryLedger.netSellProceeds, expectedNetSellProceeds)
})
