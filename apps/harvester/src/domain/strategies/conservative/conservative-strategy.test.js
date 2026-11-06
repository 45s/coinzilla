import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { evaluateConservativeStrategy } from "./conservative-strategy.js"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"

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
    { side: "SELL", price: "0.102", quantity: "99" },
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
  assert.equal(sell.price, "0.104")
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
          rule.type === "QUANTITY_INCREMENT" || rule.type === "MIN_QUANTITY"
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
    quantity: "1",
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
          rule.type === "QUANTITY_INCREMENT" || rule.type === "MIN_QUANTITY"
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
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.1")
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

test("fails closed when active inventory has no positive recovery cost basis", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger: recoveryLedger.resetCycle(),
    marketMetadata,
    lastBuyPrice: "0.1",
  }), /Position\.spent and legacy RecoveryLedger cost mirror diverged/)

  const proceedsOnlyLedger = new RecoveryLedger({
    market,
    buyCost: "0",
    netSellProceeds: "1",
  })
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger: proceedsOnlyLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  }), /no recovery cost\/profit basis/)
})


test("defers a BUY below MIN_NOTIONAL without blocking a valid recovery SELL", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, orderQuantity: 1 },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
  assert.deepEqual(decision.buyDisposition, {
    status: "EXCHANGE_CONSTRAINED_BUY",
    reason: "MIN_NOTIONAL",
    quantity: "1",
    notional: "0.099",
    minimumQuantity: "1",
    minimumNotional: "5",
  })
})

test("defers a BUY below MIN_QUANTITY without emitting an invalid order", () => {
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, orderQuantity: 0.5 },
    settings,
    portfolio: new Portfolio(),
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
  })

  assert.deepEqual(decision.actions, [])
  assert.equal(decision.buyDisposition.reason, "MIN_QUANTITY")
  assert.equal(decision.buyDisposition.quantity, "0.5")
})

test("defers a BUY that rounds to zero at the exchange quantity step", () => {
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, orderQuantity: 0.5 },
    settings,
    portfolio: new Portfolio(),
    marketMetadata,
  })

  assert.deepEqual(decision.actions, [])
  assert.deepEqual(decision.buyDisposition, {
    status: "EXCHANGE_CONSTRAINED_BUY",
    reason: "QUANTITY_INCREMENT",
    configuredQuantity: "0.5",
    quantityStepSize: "1",
  })
})

test("rejects a RecoveryLedger belonging to a different market", () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "DOGEUSDC",
    baseAsset,
    quoteAsset: new Asset({ id: "asset:USDC", code: "USDC" }),
  })
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: otherMarket }),
    marketMetadata,
  }), /RecoveryLedger market does not match/)
})

test("fails closed when RecoveryLedger has cycle accounting but Portfolio has no Position", () => {
  const { recoveryLedger } = makeBoughtState()
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: new Portfolio(),
    recoveryLedger,
    marketMetadata,
  }), /cycle accounting without an active Position/)
})


test("caps residual SELL quantity at MAX_QUANTITY and leaves the rest for sell-through", () => {
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
        constraints: [
          ...marketMetadata.tradingRules.constraints.map((rule) =>
            rule.type === "QUANTITY_INCREMENT" || rule.type === "MIN_QUANTITY"
              ? { ...rule, value: { amount: "0.1" } }
              : rule.type === "MIN_NOTIONAL"
                ? { ...rule, value: { amount: "0.05" } }
                : rule,
          ),
          { type: "MAX_QUANTITY", status: "SUPPORTED", value: { amount: "0.5" } },
        ],
      },
    },
    lastBuyPrice: "0.1",
  })

  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(sell.quantity, "0.5")
  assert.equal(sell.price, "0.1")
})

test("caps residual SELL quantity at MAX_NOTIONAL and leaves the rest for sell-through", () => {
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
        constraints: [
          ...marketMetadata.tradingRules.constraints.map((rule) =>
            rule.type === "QUANTITY_INCREMENT" || rule.type === "MIN_QUANTITY"
              ? { ...rule, value: { amount: "0.1" } }
              : rule.type === "MIN_NOTIONAL"
                ? { ...rule, value: { amount: "0.05" } }
                : rule,
          ),
          { type: "MAX_NOTIONAL", status: "SUPPORTED", value: { amount: "0.06" } },
        ],
      },
    },
    lastBuyPrice: "0.1",
  })

  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(sell.quantity, "0.6")
  assert.equal(multiplyDecimal({ left: sell.price, right: sell.quantity }), "0.06")
})

test("defers a recovery SELL when its profit-preserving price exceeds MAX_PRICE", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: [
          ...marketMetadata.tradingRules.constraints,
          { type: "MAX_PRICE", status: "SUPPORTED", value: { amount: "0.101" } },
        ],
      },
    },
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "PRICE_FILTER_BLOCKED")
  assert.equal(decision.inventoryDisposition.reason, "MAX_PRICE")
})

test("defers a configured BUY above MAX_QUANTITY without blocking a valid SELL", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, orderQuantity: 100 },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: [
          ...marketMetadata.tradingRules.constraints,
          { type: "MAX_QUANTITY", status: "SUPPORTED", value: { amount: "50" } },
        ],
      },
    },
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
  assert.equal(decision.buyDisposition.reason, "MAX_QUANTITY")
})

test("fails closed rather than inventing a next BUY reference while active inventory lacks completed-BUY VWAP", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
  }), /requires the reconciled completed-BUY VWAP/)
})


test("reconciles actual DOGE fills and keeps the 1.8 DOGE excess as MIN_NOTIONAL dust", () => {
  const dogeBase = new Asset({ id: "asset:DOGE", code: "DOGE" })
  const dogeMarket = new Market({
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAsset: dogeBase,
    quoteAsset,
  })
  const metadata = {
    market: dogeMarket,
    orderType: "LIMIT",
    tradingRules: {
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.00001" } },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: { amount: "1" } },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: { amount: "1" } },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: { amount: "5" } },
      ],
    },
  }
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market: dogeMarket })
  const apply = (fill) => {
    portfolio = portfolio.applyFill({ fill }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill }).ledger
  }

  for (const [tradeId, price, quote] of [
    ["221733", "0.07157", "28.628"],
    ["221736", "0.07153", "28.612"],
    ["221738", "0.07149", "28.596"],
  ]) {
    apply(new Fill({
      tradeId,
      brokerOrderId: "DOGE-BUY-" + tradeId,
      market: dogeMarket,
      side: "BUY",
      price: new Money({ amount: price, asset: quoteAsset }),
      quantity: new Quantity({ amount: "400", asset: dogeBase }),
      quoteQuantity: new Money({ amount: quote, asset: quoteAsset }),
      commissions: [
        new Commission({ amount: new Money({ amount: "0.4", asset: dogeBase }) }),
      ],
      commissionStatus: "COMPLETE",
    }))
  }

  for (const [tradeId, quantity, quote, commission] of [
    ["221990", "278", "19.9743", "0.0199743"],
    ["221991", "918", "65.9583", "0.0659583"],
  ]) {
    apply(new Fill({
      tradeId,
      brokerOrderId: "1276698",
      market: dogeMarket,
      side: "SELL",
      price: new Money({ amount: "0.07185", asset: quoteAsset }),
      quantity: new Quantity({ amount: quantity, asset: dogeBase }),
      quoteQuantity: new Money({ amount: quote, asset: quoteAsset }),
      commissions: [
        new Commission({ amount: new Money({ amount: commission, asset: quoteAsset }) }),
      ],
      commissionStatus: "COMPLETE",
    }))
  }

  const position = portfolio.getPosition({ symbol: "DOGEUSDT" })
  assert.equal(position.quantity.amount, "2.8")
  assert.equal(position.spent.amount, "85.836")
  assert.equal(recoveryLedger.netSellProceeds, "85.8466674")

  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.quantity.amount,
    keepQuantity: "1",
    minProfit: "0.01",
  })
  assert.equal(completion.eligible, false)
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  assert.equal(completion.freeQuantity, "0")

  const decision = evaluateConservativeStrategy({
    marketPrice: { symbol: "DOGEUSDT", price: "0.07185", timestamp: 100 },
    pairConfig: {
      priceStepPercent: 0.05,
      orderQuantity: 400,
      keepQuantity: 1,
      makerPercent: 0.1,
      takerPercent: 0.1,
    },
    settings: { minProfit: 0.01 },
    portfolio,
    recoveryLedger,
    marketMetadata: metadata,
    lastBuyPrice: "0.07153",
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL")
  assert.equal(decision.inventoryDisposition.quantity, "1.8")
  assert.equal(decision.inventoryDisposition.evaluatedQuantity, "1")
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.07185")
})

test("reconciles actual ZRO fills and keeps the 0.04 excess as MIN_NOTIONAL dust", () => {
  const zroBase = new Asset({ id: "asset:ZRO", code: "ZRO" })
  const zroMarket = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset: zroBase,
    quoteAsset,
  })
  const metadata = {
    market: zroMarket,
    orderType: "LIMIT",
    tradingRules: {
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.001" } },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: { amount: "0.01" } },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: { amount: "0.01" } },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: { amount: "5" } },
      ],
    },
  }
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market: zroMarket })
  const apply = (fill) => {
    portfolio = portfolio.applyFill({ fill }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill }).ledger
  }

  for (const [tradeId, price, quote] of [
    ["11658", "1.604", "8.02"],
    ["11659", "1.603", "8.015"],
    ["11660", "1.602", "8.01"],
    ["11661", "1.601", "8.005"],
    ["11662", "1.6", "8"],
    ["11663", "1.599", "7.995"],
    ["11664", "1.598", "7.99"],
    ["11665", "1.597", "7.985"],
  ]) {
    apply(new Fill({
      tradeId,
      brokerOrderId: "ZRO-BUY-" + tradeId,
      market: zroMarket,
      side: "BUY",
      price: new Money({ amount: price, asset: quoteAsset }),
      quantity: new Quantity({ amount: "5", asset: zroBase }),
      quoteQuantity: new Money({ amount: quote, asset: quoteAsset }),
      commissions: [
        new Commission({ amount: new Money({ amount: "0.005", asset: zroBase }) }),
      ],
      commissionStatus: "COMPLETE",
    }))
  }

  apply(new Fill({
    tradeId: "11666",
    brokerOrderId: "727904",
    market: zroMarket,
    side: "SELL",
    price: new Money({ amount: "1.606", asset: quoteAsset }),
    quantity: new Quantity({ amount: "39.91", asset: zroBase }),
    quoteQuantity: new Money({ amount: "64.09546", asset: quoteAsset }),
    commissions: [
      new Commission({ amount: new Money({ amount: "0.06409546", asset: quoteAsset }) }),
    ],
    commissionStatus: "COMPLETE",
  }))

  const position = portfolio.getPosition({ symbol: "ZROUSDT" })
  assert.equal(position.quantity.amount, "0.05")
  assert.equal(position.spent.amount, "64.02")
  assert.equal(recoveryLedger.netSellProceeds, "64.03136454")

  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.quantity.amount,
    keepQuantity: "0.01",
    minProfit: "0.01",
  })
  assert.equal(completion.eligible, false)
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  assert.equal(completion.freeQuantity, "0")

  const decision = evaluateConservativeStrategy({
    marketPrice: { symbol: "ZROUSDT", price: "1.606", timestamp: 100 },
    pairConfig: {
      priceStepPercent: 0.05,
      orderQuantity: 5,
      keepQuantity: 0.01,
      makerPercent: 0.1,
      takerPercent: 0.1,
    },
    settings: { minProfit: 0.01 },
    portfolio,
    recoveryLedger,
    marketMetadata: metadata,
    activeOrders: [{ market: zroMarket, side: "BUY", status: "OPEN" }],
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL")
  assert.equal(decision.inventoryDisposition.quantity, "0.04")
  assert.equal(decision.inventoryDisposition.evaluatedQuantity, "0.03")
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.04818")
})
