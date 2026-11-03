import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../src/domain/strategies/conservative/recovery-ledger.js"
import { evaluateConservativeStrategy } from "../../src/domain/strategies/conservative/conservative-strategy.js"

const createFixture = () => {
  const baseAsset = new Asset({ id: "asset-zro", code: "ZRO" })
  const quoteAsset = new Asset({ id: "asset-usdt", code: "USDT" })
  const market = new Market({
    venue: "test",
    symbol: "ZROUSDT",
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.001", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.01", asset: baseAsset }) },
    ],
  })
  const marketMetadata = { market, tradingRules, orderType: "LIMIT_MAKER" }
  const pairConfig = {
    priceStepPercent: "0.5",
    orderQuantity: "10",
    keepQuantity: "1",
    makerPercent: "0",
    takerPercent: "0",
    investment: "1000",
  }
  const settings = { minProfit: "0.01" }
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })

  const applyFill = ({ side, tradeId, quantity, price }) => {
    const fill = new Fill({
      tradeId,
      brokerOrderId: side === "BUY" ? "buy-1" : "sell-1",
      clientOrderId: side === "BUY" ? "client-buy-1" : "client-sell-1",
      market,
      side,
      price: new Money({ amount: price, asset: quoteAsset }),
      quantity: new Quantity({ amount: quantity, asset: baseAsset }),
      quoteQuantity: new Money({
        amount: String(Number(price) * Number(quantity)),
        asset: quoteAsset,
      }),
      liquidityRole: "MAKER",
      commissionStatus: "COMPLETE",
      executedAt: Number(tradeId.replace(/\\D/g, "")) || 1,
    })
    portfolio = portfolio.applyFill({ fill }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill }).ledger
    return fill
  }

  const evaluate = ({ activeOrders = [], price = "1" } = {}) => evaluateConservativeStrategy({
    marketPrice: { symbol: market.symbol, price, timestamp: 1 },
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    activeOrders,
  })

  return {
    market,
    evaluate,
    applyFill,
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    resetRecoveryCycle: () => { recoveryLedger = recoveryLedger.resetCycle() },
  }
}

test("Conservative domain policy completes recovery before making the next BUY eligible", () => {
  const fixture = createFixture()
  const { market, evaluate, applyFill, getRecoveryLedger, resetRecoveryCycle } = fixture

  const initial = evaluate()
  assert.deepEqual(initial.actions.map(({ side }) => side), ["BUY"])

  applyFill({ side: "BUY", tradeId: "trade-1", quantity: "10", price: "1" })
  assert.equal(getRecoveryLedger().outstandingRecoveryAmount, "10")

  // Outstanding recovery capital permits only the recovery SELL.
  const recovery = evaluate()
  assert.deepEqual(recovery.actions.map(({ side }) => side), ["SELL"])
  const recoverySell = recovery.actions[0]

  const openSell = {
    market,
    side: "SELL",
    status: "OPEN",
    originalQuantity: new Quantity({ amount: recoverySell.quantity, asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
  }
  assert.deepEqual(evaluate({ activeOrders: [openSell], price: "1.01" }).actions, [])
  assert.deepEqual(evaluate({ activeOrders: [openSell], price: "1.02" }).actions, [])

  applyFill({ side: "SELL", tradeId: "trade-2", quantity: "2", price: recoverySell.price })
  const partiallyFilledSell = {
    ...openSell,
    status: "PARTIALLY_FILLED",
    executedQuantity: new Quantity({ amount: "2", asset: market.baseAsset }),
  }
  assert.deepEqual(evaluate({ activeOrders: [partiallyFilledSell], price: "1.03" }).actions, [])
  assert.notEqual(getRecoveryLedger().outstandingRecoveryAmount, "0")

  applyFill({ side: "SELL", tradeId: "trade-3", quantity: "7", price: recoverySell.price })
  assert.equal(getRecoveryLedger().outstandingRecoveryAmount, "0")

  // The application may reset the ledger only after its recovery-completion
  // workflow succeeds. The remaining keep quantity is not sellable inventory.
  resetRecoveryCycle()
  const nextCycle = evaluate({ price: "1.04" })
  assert.deepEqual(nextCycle.actions.map(({ side }) => side), ["BUY"])
})
