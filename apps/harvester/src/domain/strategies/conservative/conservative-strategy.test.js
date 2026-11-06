import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"
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

function makeBoughtState({ quoteCommission = "0" } = {}) {
  const fill = new Fill({
    tradeId: "buy-1",
    brokerOrderId: "order-1",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: "100", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    commissions: quoteCommission === "0" ? [] : [
      new Commission({ amount: new Money({ amount: quoteCommission, asset: quoteAsset }) }),
    ],
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

test("creates a recovery SELL and the next standing BUY from actual filled inventory", () => {
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
  assert.equal(decision.actions.length, 2)
  assert.deepEqual(decision.actions.map(({ side, price, quantity }) => ({
    side, price, quantity,
  })), [
    { side: "SELL", price: "0.103", quantity: "98" },
    { side: "BUY", price: "0.099", quantity: "100" },
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
  assert.equal(decision.actions.some((action) => action.side === "BUY"), true)
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

test("reserves the higher takerPercent for recovery SELL planning when taker is more expensive", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, makerPercent: 0.1, takerPercent: 0.2 },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      orderType: "LIMIT",
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule, value: { amount: "0.1" } }
            : rule,
        ),
      },
    },
    lastBuyPrice: "0.1",
  })

  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(sell.type, "LIMIT")
  assert.equal(sell.quantity, "98.8")
  assert.equal(sell.price, "0.102")
})

test("includes the actual BUY quote commission in the recovery SELL limit price", () => {
  const { portfolio, recoveryLedger } = makeBoughtState({ quoteCommission: "0.2" })
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })

  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(recoveryLedger.buyCost, "10.2")
  assert.equal(sell.price, "0.105")
})

function makeProfitableResidualState({ soldQuantity = "98" } = {}) {
  const bought = makeBoughtState()
  const fill = new Fill({
    tradeId: "sell-1",
    brokerOrderId: "sell-order-1",
    market,
    side: "SELL",
    price: new Money({ amount: "0.11", asset: quoteAsset }),
    quantity: new Quantity({ amount: soldQuantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: multiplyDecimal({ left: soldQuantity, right: "0.11" }), asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: bought.portfolio.applyFill({ fill }).portfolio,
    recoveryLedger: bought.recoveryLedger.applyFill({ fill }).ledger,
  }
}

test("continues selling residual inventory after cumulative recovery profit is already secured", () => {
  const { portfolio, recoveryLedger } = makeProfitableResidualState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule, value: { amount: "0.1" } }
            : rule.type === "MIN_NOTIONAL"
              ? { ...rule, value: { amount: "0.05" } }
              : rule,
        ),
      },
    },
    lastBuyPrice: "0.1",
  })

  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "0")
  assert.equal(recoveryLedger.realizedNetProfit, "0.78")
  assert.equal(portfolio.getPosition({ symbol: market.symbol }).baseQuantity.amount, "2")
  assert.deepEqual({ price: sell.price, quantity: sell.quantity, reason: sell.reason }, {
    price: "0.1",
    quantity: "0.9",
    reason: "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY",
  })
})

test("classifies residual quantity below the exchange quantity step instead of submitting an invalid SELL", () => {
  const { portfolio, recoveryLedger } = makeProfitableResidualState({ soldQuantity: "98.95" })
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule, value: { amount: "0.1" } }
            : rule,
        ),
      },
    },
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.deepEqual(decision.inventoryDisposition, {
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity: "0.05",
    reason: "QUANTITY_INCREMENT",
    quantityStepSize: "0.1",
  })
})

test("classifies residual quantity below MIN_NOTIONAL instead of submitting an invalid SELL", () => {
  const { portfolio, recoveryLedger } = makeProfitableResidualState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule, value: { amount: "0.1" } }
            : rule,
        ),
      },
    },
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL")
  assert.equal(decision.inventoryDisposition.quantity, "1")
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.09")
})

test("does not create a duplicate residual SELL while one is active", () => {
  const { portfolio, recoveryLedger } = makeProfitableResidualState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule, value: { amount: "0.1" } }
            : rule.type === "MIN_NOTIONAL"
              ? { ...rule, value: { amount: "0.05" } }
              : rule,
        ),
      },
    },
    activeOrders: [{ market, side: "SELL", status: "OPEN" }],
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
})

test("fails closed when active inventory has lost its recovery cost/profit basis", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger: recoveryLedger.resetCycle(),
    marketMetadata,
    lastBuyPrice: "0.1",
  }), /no recovery cost\/profit basis/)
})
