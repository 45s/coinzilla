import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { evaluateConservativeStrategy } from "./conservative-strategy.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.001" } },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: { amount: "1" } },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: { amount: "1" } },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: { amount: "5" } },
    ],
  },
}
const pairConfig = {
  priceStepPercent: 0.05,
  orderQuantity: 100,
  keepQuantity: 1,
  makerPercent: 0,
  takerPercent: 0.075,
}
const settings = { minProfit: 0.01 }
const marketPrice = { symbol: "DOGEUSDT", price: "0.100", timestamp: 100 }

function makeBoughtState() {
  const fill = new Fill({
    tradeId: "buy-1",
    brokerOrderId: "order-1",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: "100", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const portfolio = new Portfolio().applyFill({ fill }).portfolio
  const recoveryLedger = RecoveryLedger.empty({ market }).applyFill({ fill }).ledger
  return { portfolio, recoveryLedger }
}

test("creates the initial BUY below last traded price and rounds down to tick", () => {
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: new Portfolio(),
    marketMetadata,
  })
  assert.equal(decision.strategy, "CONSERVATIVE")
  assert.equal(decision.action, "PLACE_ORDERS")
  assert.deepEqual(decision.actions, [{
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "0.099",
    quantity: "100",
    reason: "INITIAL_BUY",
  }])
})

test("does not duplicate an already active BUY on repeated price events", () => {
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: new Portfolio(),
    marketMetadata,
    activeOrders: [{
      market,
      side: "BUY",
      status: "OPEN",
    }],
  })
  assert.equal(decision.action, "NO_ACTION")
  assert.deepEqual(decision.actions, [])
})

test("submits only the recovery SELL after a BUY fill; the next BUY waits for cycle completion", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })
  assert.deepEqual(decision.actions.map(({ side, price, quantity }) => ({
    side, price, quantity,
  })), [
    { side: "SELL", price: "0.102", quantity: "99" },
  ])
})

test("does not create a second SELL while a recovery SELL is active", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    activeOrders: [{ market, side: "SELL", status: "PARTIALLY_FILLED" }],
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
})


test("does not submit a BUY while recovery capital remains outstanding, even without an active SELL", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    activeOrders: [],
    lastBuyPrice: "0.1",
  })
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
})

test("does not start a new BUY when proceeds cover principal but recovery completion has not reset the ledger", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const sellFill = new Fill({
    tradeId: "sell-1",
    brokerOrderId: "order-2",
    market,
    side: "SELL",
    price: new Money({ amount: "0.102", asset: quoteAsset }),
    quantity: new Quantity({ amount: "99", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10.098", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const nextPortfolio = portfolio.applyFill({ fill: sellFill }).portfolio
  const nextLedger = recoveryLedger.applyFill({ fill: sellFill }).ledger

  assert.equal(nextLedger.outstandingRecoveryAmount, "0")
  assert.equal(nextLedger.buyCost, "10")
  assert.equal(nextLedger.netSellProceeds, "10.098")

  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: nextPortfolio,
    recoveryLedger: nextLedger,
    marketMetadata,
  })

  assert.deepEqual(decision.actions, [])
})

test("rejects missing exchange increments and invalid strategy context", () => {
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: new Portfolio(),
    marketMetadata: { ...marketMetadata, tradingRules: { constraints: [] } },
  }), /PRICE_INCREMENT/)
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: {},
    marketMetadata,
  }), /requires a Portfolio/)
})

test("waits for a partially filled order before advancing either side of the strategy", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice, pairConfig, settings, portfolio, recoveryLedger, marketMetadata,
    activeOrders: [{ market, side: "BUY", status: "PARTIALLY_FILLED" }],
    lastBuyPrice: "0.1",
  })
  assert.equal(decision.action, "NO_ACTION")
  assert.equal(decision.reason, "WAIT_FOR_ORDER_TO_FINISH_AFTER_PARTIAL_FILL")
  assert.deepEqual(decision.actions, [])
})

test("does not create another BUY when outstanding recovery plus the next order exceeds investment", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, investment: 15 },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
})
