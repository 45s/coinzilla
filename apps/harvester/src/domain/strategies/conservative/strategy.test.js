import { StrategyId } from "../strategy-ids.js"
import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[strategy.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { evaluateConservativeStrategy } from "./strategy.js"
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
  minProfit: 0.01,
  makerPercent: 0,
  takerPercent: 0.075,
}
const settings = {}
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
  const portfolio = new Portfolio().applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const recoveryLedger = RecoveryLedger.empty({ market }).applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).ledger
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


test("uses the market-specific minimum profit when planning its recovery SELL", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig, minProfit: 0.1 },
    settings: {},
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })

  assert.equal(
    decision.actions.find((action) => action.side === "SELL")?.price,
    "0.103",
    "A 0.1 quote-unit threshold must produce a higher recovery price than the unrelated global 0.01 threshold.",
  )
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
  assert.equal(decision.actions.find((action) => action.side === "SELL").purpose, "RECOVERY_SELL")
  assert.deepEqual(decision.actions.map(({ side, price, quantity }) => ({
    side, price, quantity,
  })), [
    { side: "SELL", price: "0.102", quantity: "99" },
    { side: "BUY", price: "0.099", quantity: "100" },
  ])
})

test("allows the next BUY only after the recovery SELL is acknowledged", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()

  for (const status of ["OPEN", "PARTIALLY_FILLED"]) {
    const decision = evaluateConservativeStrategy({
      marketPrice,
      pairConfig,
      settings,
      portfolio,
      recoveryLedger,
      marketMetadata,
      activeOrders: [{
        market,
        side: "SELL",
        status,
        brokerOrderId: "broker-sell-1",
      }],
      lastBuyPrice: "0.1",
    })

    assert.deepEqual(
      decision.actions,
      [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "0.099",
        quantity: "100",
        reason: "NEXT_STANDING_BUY",
      }],
      "An acknowledged " + status + " recovery SELL may coexist with exactly one next standing BUY.",
    )
    assert.equal(
      decision.action,
      "PLACE_ORDERS",
      "The strategy must keep the next BUY eligible after recovery SELL acknowledgement: " + status,
    )
  }
})

test("blocks the next BUY while the recovery SELL acknowledgement is pending or unknown", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()

  for (const status of ["PENDING", "UNKNOWN"]) {
    const decision = evaluateConservativeStrategy({
      marketPrice,
      pairConfig,
      settings,
      portfolio,
      recoveryLedger,
      marketMetadata,
      activeOrders: [{ market, side: "SELL", status }],
      lastBuyPrice: "0.1",
    })

    assert.deepEqual(
      decision.actions,
      [],
      "A " + status + " recovery SELL must not be bypassed by submitting the next standing BUY.",
    )
    assert.equal(
      decision.action,
      "NO_ACTION",
      "The strategy must wait for an acknowledged recovery SELL before enabling the next BUY; current SELL status: " + status,
    )
  }
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

test("keeps the partial BUY active while continuing recovery SELL planning", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice, pairConfig, settings, portfolio, recoveryLedger, marketMetadata,
    activeOrders: [{ market, side: "BUY", status: "PARTIALLY_FILLED" }],
    lastBuyPrice: "0.1",
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
})

test("respects exact investment-cap equality and blocks the next BUY immediately below it", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const expectedRecoverySell = {
    side: "SELL",
    purpose: "RECOVERY_SELL",
    type: "LIMIT_MAKER",
    price: "0.102",
    quantity: "99",
    reason: "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT",
    requiredNetProceeds: "10.01",
  }
  const expectedNextStandingBuy = {
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "0.099",
    quantity: "100",
    reason: "NEXT_STANDING_BUY",
  }
  const scenarios = [
    {
      name: "exact capital equality",
      investment: 19.9,
      expectedActions: [expectedRecoverySell, expectedNextStandingBuy],
    },
    {
      name: "capital limit one thousandth below the required amount",
      investment: 19.899,
      expectedActions: [expectedRecoverySell],
    },
    {
      name: "capital limit materially below the required amount",
      investment: 15,
      expectedActions: [expectedRecoverySell],
    },
  ]

  for (const scenario of scenarios) {
    const decision = evaluateConservativeStrategy({
      marketPrice,
      pairConfig: { ...pairConfig, investment: scenario.investment },
      settings,
      portfolio,
      recoveryLedger,
      marketMetadata,
      lastBuyPrice: "0.1",
    })

    assert.deepEqual(
      decision.actions,
      scenario.expectedActions,
      "The " + scenario.name + " scenario must preserve the recovery SELL and permit a next BUY only when the outstanding 10.00 recovery plus the 9.90 BUY notional fits the configured investment.",
    )
    assert.equal(
      decision.action,
      "PLACE_ORDERS",
      "The recovery SELL must remain executable even when the configured investment limit blocks the next BUY in the " + scenario.name + " scenario.",
    )
  }
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

function makeProfitableResidualState({
  soldQuantity = "98",
  quoteQuantity = "10.78",
} = {}) {
  const bought = makeBoughtState()
  const fill = new Fill({
    tradeId: "sell-1",
    brokerOrderId: "sell-order-1",
    market,
    side: "SELL",
    price: new Money({ amount: "0.11", asset: quoteAsset }),
    quantity: new Quantity({ amount: soldQuantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: bought.portfolio.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).portfolio,
    recoveryLedger: bought.recoveryLedger.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).ledger,
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
  const { portfolio, recoveryLedger } = makeProfitableResidualState({ soldQuantity: "98.95", quoteQuantity: "10.8845" })
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

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false, "The DOGE residual below MIN_NOTIONAL must not produce another SELL order.")
  assert.deepEqual(decision.inventoryDisposition, {
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity: "0.05",
    reason: "QUANTITY_INCREMENT",
    quantityStepSize: "0.1",
    evaluatedQuantity: "0",
  })
})

test("combines exchange-constrained dust with a later BUY and preserves the full recovery basis", () => {
  const dustState = makeProfitableResidualState({ soldQuantity: "98.95", quoteQuantity: "10.8845" })
  const laterBuy = new Fill({
    tradeId: "later-buy-after-dust",
    brokerOrderId: "later-buy-order",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: "100", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const portfolio = dustState.portfolio.applyFill({ fill: laterBuy, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const recoveryLedger = dustState.recoveryLedger.applyFill({ fill: laterBuy, strategyId: StrategyId.COIN_GRABBER }).ledger
  const position = portfolio.getPosition({ symbol: market.symbol })

  assert.equal(position.quantity.amount, "101.05")
  assert.equal(position.spent.amount, "20")
  assert.equal(recoveryLedger.buyCost, "20")
  assert.equal(recoveryLedger.netSellProceeds, "10.8845")

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
  assert.ok(sell)
  assert.equal(sell.quantity, "100")
  assert.equal(sell.reason, "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT")
  assert.equal(decision.inventoryDisposition, undefined)
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

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false, "The DOGE residual below MIN_NOTIONAL must not produce another SELL order.")
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST", "The DOGE residual must be classified as exchange-constrained dust.")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL", "The DOGE dust blocker must identify the minimum-notional filter.")
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

  assert.equal(decision.actions.some((action) => action.side === "SELL"), false, "The ZRO residual below MIN_NOTIONAL must not produce another SELL order.")
})

test("fails closed when active inventory has no positive recovery cost basis", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger: new RecoveryLedger({
      market,
      buyCost: "0",
      netSellProceeds: "0",
      appliedFillIds: recoveryLedger.appliedFillIds,
      appliedFillFingerprints: recoveryLedger.appliedFillFingerprints,
    }),
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
  }), /Position\.spent and legacy RecoveryLedger cost mirror diverged/)
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
  assert.equal(sell.price, "0.1", "The exchange-filter constrained residual SELL must retain its exact admissible price.")
  assert.equal(sell.quantity, "0.6", "At the exact 0.06 USDT MAX_NOTIONAL boundary and a 0.1 USDT price, the residual SELL must be capped at 0.6 DOGE.")
})

test("blocks the next BUY when the required recovery SELL exceeds MAX_PRICE", () => {
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

  assert.deepEqual(
    decision.actions,
    [],
    "A MAX_PRICE-blocked recovery SELL must prevent the next standing BUY from being submitted.",
  )
  assert.equal(
    decision.action,
    "NO_ACTION",
    "The strategy must fail closed instead of returning an executable BUY while recovery SELL pricing is blocked.",
  )
  assert.deepEqual(
    decision.inventoryDisposition,
    {
      status: "PRICE_FILTER_BLOCKED",
      quantity: "99",
      reason: "MAX_PRICE",
      requiredPrice: "0.102",
      maximumPrice: "0.101",
    },
    "The decision must preserve the exact blocked recovery inventory and exchange price-filter evidence.",
  )
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
    portfolio = portfolio.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).ledger
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
  assert.equal(position.quantity.amount, "2.8", "After the three DOGE BUY fills and SELL recovery, active quantity must match the retained strategy position.")
  assert.equal(position.spent.amount, "85.836", "The three DOGE BUY fills must accumulate their exact quote notional in Position cost basis.")
  assert.equal(recoveryLedger.buyCost, "85.836", "RecoveryLedger must mirror the accumulated quote cost of all three DOGE BUY fills.")
  assert.equal(recoveryLedger.netSellProceeds, "85.8466674", "RecoveryLedger must accumulate the exact net quote proceeds from the DOGE SELL fills.")

  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.quantity.amount,
    keepQuantity: "1",
    minProfit: "0.01",
  })
  assert.equal(completion.eligible, false, "Recovery must remain incomplete while exchange-constrained DOGE inventory still requires sell-through.")
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "The DOGE residual must be classified for sell-through rather than retained as free inventory.")
  assert.equal(completion.freeQuantity, "0", "No DOGE quantity may be allocated to free inventory before sell-through completes.")

  const decision = evaluateConservativeStrategy({
    marketPrice: { symbol: "DOGEUSDT", price: "0.07185", timestamp: 100 },
    pairConfig: {
      priceStepPercent: 0.05,
      orderQuantity: 400,
      keepQuantity: 1,
      minProfit: 0.01,
      makerPercent: 0.1,
      takerPercent: 0.1,
    },
    settings: {},
    portfolio,
    recoveryLedger,
    marketMetadata: metadata,
    lastBuyPrice: "0.07153",
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST", "The DOGE residual must be classified as exchange-constrained dust.")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL", "The DOGE dust blocker must identify the minimum-notional filter.")
  assert.equal(decision.inventoryDisposition.quantity, "1.8", "The full DOGE residual quantity must be retained in the dust disposition.")
  assert.equal(decision.inventoryDisposition.evaluatedQuantity, "1", "The DOGE quantity evaluated for the exchange filter must remain independently exact.")
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.07185", "The DOGE evaluated notional must match the exact residual quantity and current price.")
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
    portfolio = portfolio.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    recoveryLedger = recoveryLedger.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }).ledger
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
  assert.equal(position.quantity.amount, "0.05", "After the eight ZRO BUY fills and SELL recovery, active quantity must match the retained strategy position.")
  assert.equal(position.spent.amount, "64.02", "The eight ZRO BUY fills must accumulate their exact quote notional in Position cost basis.")
  assert.equal(recoveryLedger.buyCost, "64.02", "RecoveryLedger must mirror the accumulated quote cost of all eight ZRO BUY fills.")
  assert.equal(recoveryLedger.netSellProceeds, "64.03136454", "RecoveryLedger must accumulate the exact net quote proceeds from the ZRO SELL fills.")

  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.quantity.amount,
    keepQuantity: "0.01",
    minProfit: "0.01",
  })
  assert.equal(completion.eligible, false, "Recovery must remain incomplete while exchange-constrained ZRO inventory still requires sell-through.")
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "The ZRO residual must be classified for sell-through rather than retained as free inventory.")
  assert.equal(completion.freeQuantity, "0", "No ZRO quantity may be allocated to free inventory before sell-through completes.")

  const decision = evaluateConservativeStrategy({
    marketPrice: { symbol: "ZROUSDT", price: "1.606", timestamp: 100 },
    pairConfig: {
      priceStepPercent: 0.05,
      orderQuantity: 5,
      keepQuantity: 0.01,
      minProfit: 0.01,
      makerPercent: 0.1,
      takerPercent: 0.1,
    },
    settings: {},
    portfolio,
    recoveryLedger,
    marketMetadata: metadata,
    activeOrders: [{ market: zroMarket, side: "BUY", status: "OPEN" }],
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST", "The ZRO residual must be classified as exchange-constrained dust.")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL", "The ZRO dust blocker must identify the minimum-notional filter.")
  assert.equal(decision.inventoryDisposition.quantity, "0.04", "The full ZRO residual quantity must be retained in the dust disposition.")
  assert.equal(decision.inventoryDisposition.evaluatedQuantity, "0.03", "The ZRO quantity evaluated for the exchange filter must remain independently exact.")
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.04818", "The ZRO evaluated notional must match the exact residual quantity and current price.")
})
