import { StrategyId } from "../strategy-ids.js"
import nodeTest from "node:test"
const test = (...args) => nodeTest(`[strategy.test.js] ${  args[0]}`, ...args.slice(1))
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { evaluateConservativeStrategy } from "./strategy.js"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"

const baseAsset = new Asset({ id: "asset:DOGE",
code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT",
code: "USDT" })
const market = new Market({ venue: "binance",
symbol: "DOGEUSDT",
baseAsset,
quoteAsset })
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      { type: "PRICE_INCREMENT",
status: "SUPPORTED",
value: { amount: "0.001" } },
      { type: "QUANTITY_INCREMENT",
status: "SUPPORTED",
value: { amount: "1" } },
      { type: "MIN_QUANTITY",
status: "SUPPORTED",
value: { amount: "1" } },
      { type: "MIN_NOTIONAL",
status: "SUPPORTED",
value: { amount: "5" } },
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
const marketPrice = { symbol: "DOGEUSDT",
price: "0.100",
timestamp: 100 }

function makeBoughtState({ quoteCommission = "0" } = {}) {
  const fill = new Fill({
    tradeId: "buy-1",
    brokerOrderId: "order-1",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1",
asset: quoteAsset }),
    quantity: new Quantity({ amount: "100",
asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10",
asset: quoteAsset }),
    commissions: quoteCommission === "0" ? [] : [
      new Commission({ amount: new Money({ amount: quoteCommission,
asset: quoteAsset }) }),
    ],
    commissionStatus: "COMPLETE",
  })
  const {portfolio} = new Portfolio().applyFill({ fill,
strategyId: StrategyId.COIN_GRABBER })
  const recoveryLedger = RecoveryLedger.empty({ market }).applyFill({ fill,
strategyId: StrategyId.COIN_GRABBER }).ledger
  return { portfolio,
recoveryLedger }
}

function withExchangeRuleOverrides({ rule, quantityIncrement, minimumNotional, includeMinQuantity = true }) {
  if (rule.type === "QUANTITY_INCREMENT" ||
      (includeMinQuantity && rule.type === "MIN_QUANTITY")) {
    return { ...rule,
value: { amount: quantityIncrement } }
  }
  if (rule.type === "MIN_NOTIONAL") {
    return { ...rule,
value: { amount: minimumNotional } }
  }
  return rule
}

function createDustMarketMetadata({ market: dustMarket, priceIncrement, quantityIncrement, minQuantity, minNotional }) {
  return {
    market: dustMarket,
    orderType: "LIMIT",
    tradingRules: {
      constraints: [
        { type: "PRICE_INCREMENT",
status: "SUPPORTED",
value: { amount: priceIncrement } },
        { type: "QUANTITY_INCREMENT",
status: "SUPPORTED",
value: { amount: quantityIncrement } },
        { type: "MIN_QUANTITY",
status: "SUPPORTED",
value: { amount: minQuantity } },
        { type: "MIN_NOTIONAL",
status: "SUPPORTED",
value: { amount: minNotional } },
      ],
    },
  }
}

function applyDustFill({ state, market: dustMarket, baseAsset: dustBaseAsset, side, tradeId, brokerOrderId, price, quantity, quoteQuantity, commissionAmount, commissionAsset }) {
  const fill = new Fill({
    tradeId,
    brokerOrderId,
    market: dustMarket,
    side,
    price: new Money({ amount: price,
asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity,
asset: dustBaseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity,
asset: quoteAsset }),
    commissions: commissionAmount === "0" ? [] : [
      new Commission({ amount: new Money({ amount: commissionAmount,
asset: commissionAsset }) }),
    ],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: state.portfolio.applyFill({
      fill,
      strategyId: StrategyId.COIN_GRABBER,
    }).portfolio,
    recoveryLedger: state.recoveryLedger.applyFill({
      fill,
      strategyId: StrategyId.COIN_GRABBER,
    }).ledger,
  }
}

function createDogeDustScenario() {
  const dustBaseAsset = new Asset({ id: "asset:DOGE",
code: "DOGE" })
  const dustMarket = new Market({ venue: "binance",
symbol: "DOGEUSDT",
baseAsset: dustBaseAsset,
quoteAsset })
  const metadata = createDustMarketMetadata({
    market: dustMarket,
    priceIncrement: "0.00001",
    quantityIncrement: "1",
    minQuantity: "1",
    minNotional: "5",
  })
  let state = {
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: dustMarket }),
  }
  for (const [tradeId, price, quote] of [
    ["221733", "0.07157", "28.628"],
    ["221736", "0.07153", "28.612"],
    ["221738", "0.07149", "28.596"],
  ]) {
    state = applyDustFill({
      state,
      market: dustMarket,
      baseAsset: dustBaseAsset,
      side: "BUY",
      tradeId,
      brokerOrderId: `DOGE-BUY-${tradeId}`,
      price,
      quantity: "400",
      quoteQuantity: quote,
      commissionAmount: "0.4",
      commissionAsset: dustBaseAsset,
    })
  }
  for (const [tradeId, quantity, quote, commission] of [
    ["221990", "278", "19.9743", "0.0199743"],
    ["221991", "918", "65.9583", "0.0659583"],
  ]) {
    state = applyDustFill({
      state,
      market: dustMarket,
      baseAsset: dustBaseAsset,
      side: "SELL",
      tradeId,
      brokerOrderId: "1276698",
      price: "0.07185",
      quantity,
      quoteQuantity: quote,
      commissionAmount: commission,
      commissionAsset: quoteAsset,
    })
  }
  return { ...state,
metadata }
}

function createZroDustScenario() {
  const dustBaseAsset = new Asset({ id: "asset:ZRO",
code: "ZRO" })
  const dustMarket = new Market({ venue: "binance",
symbol: "ZROUSDT",
baseAsset: dustBaseAsset,
quoteAsset })
  const metadata = createDustMarketMetadata({
    market: dustMarket,
    priceIncrement: "0.001",
    quantityIncrement: "0.01",
    minQuantity: "0.01",
    minNotional: "5",
  })
  let state = {
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: dustMarket }),
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
    state = applyDustFill({
      state,
      market: dustMarket,
      baseAsset: dustBaseAsset,
      side: "BUY",
      tradeId,
      brokerOrderId: `ZRO-BUY-${tradeId}`,
      price,
      quantity: "5",
      quoteQuantity: quote,
      commissionAmount: "0.005",
      commissionAsset: dustBaseAsset,
    })
  }
  state = applyDustFill({
    state,
    market: dustMarket,
    baseAsset: dustBaseAsset,
    side: "SELL",
    tradeId: "11666",
    brokerOrderId: "727904",
    price: "1.606",
    quantity: "39.91",
    quoteQuantity: "64.09546",
    commissionAmount: "0.06409546",
    commissionAsset: quoteAsset,
  })
  return { ...state,
metadata,
market: dustMarket }
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
    pairConfig: { ...pairConfig,
minProfit: 0.1 },
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

test("plans only a recovery SELL while a filled Position remains active", () => {
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
  assert.deepEqual(decision.actions, [{
    side: "SELL",
    purpose: "RECOVERY_SELL",
    type: "LIMIT_MAKER",
    price: "0.102",
    quantity: "99",
    reason: "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT",
    requiredNetProceeds: "10.01",
  }], "An active recovery Position must not produce a next standing BUY.")
})
test("blocks the next BUY while an acknowledged recovery SELL remains open", () => {
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
        remainingQuantity: new Quantity({
          amount: "99",
          asset: baseAsset,
        }),
      }],
      lastBuyPrice: "0.1",
    })

    assert.deepEqual(
      decision.actions,
      [],
      `An acknowledged ${status} recovery SELL must not release the BUY gate before cycle completion.`,
    )
    assert.equal(
      decision.action,
      "NO_ACTION",
      `The strategy must wait for full recovery-cycle completion; current SELL status: ${status}`,
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
      activeOrders: [{
        market,
        side: "SELL",
        status,
        remainingQuantity: new Quantity({
          amount: "99",
          asset: baseAsset,
        }),
      }],
      lastBuyPrice: "0.1",
    })

    assert.deepEqual(
      decision.actions,
      [],
      `A ${  status  } recovery SELL must not be bypassed by submitting the next standing BUY.`,
    )
    assert.equal(
      decision.action,
      "NO_ACTION",
      `The strategy must wait for an acknowledged recovery SELL before enabling the next BUY; current SELL status: ${  status}`,
    )
  }
})

test("rejects missing exchange increments and invalid strategy context", () => {
  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio: new Portfolio(),
    marketMetadata: { ...marketMetadata,
tradingRules: { constraints: [] } },
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
    marketPrice,
pairConfig,
settings,
portfolio,
recoveryLedger,
marketMetadata,
    activeOrders: [{
      market,
      side: "BUY",
      status: "PARTIALLY_FILLED",
    }],
    lastBuyPrice: "0.1",
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
})

function assertInvestmentCapScenario({ investment }) {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: {
      ...pairConfig,
      investment,
    },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })
  const expectedRecoverySell = {
    side: "SELL",
    purpose: "RECOVERY_SELL",
    type: "LIMIT_MAKER",
    price: "0.102",
    quantity: "99",
    reason: "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT",
    requiredNetProceeds: "10.01",
  }
  assert.deepEqual(
    decision.actions,
    [expectedRecoverySell],
    "Investment limits must not make a new BUY eligible while the recovery Position remains active.",
  )
  assert.equal(decision.action, "PLACE_ORDERS")
}

test("keeps recovery SELL eligible while investment limits cannot reopen BUY during an active cycle", () => {
  for (const scenario of [
    {
      investment: 19.9,
    },
    {
      investment: 19.901,
      expectedBuy: true,
    },
    {
      investment: 19.899,
    },
    {
      investment: 15,
      expectedBuy: false,
    },
  ]) {
    assertInvestmentCapScenario(scenario)
  }
})
test("reserves the higher takerPercent for recovery SELL planning when taker is more expensive", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: {
      ...pairConfig,
      makerPercent: 0.1,
      takerPercent: 0.2,
    },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      orderType: "LIMIT",
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule,
value: { amount: "0.1" } }
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
    price: new Money({ amount: "0.11",
asset: quoteAsset }),
    quantity: new Quantity({ amount: soldQuantity,
asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity,
asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: bought.portfolio.applyFill({ fill,
strategyId: StrategyId.COIN_GRABBER }).portfolio,
    recoveryLedger: bought.recoveryLedger.applyFill({ fill,
strategyId: StrategyId.COIN_GRABBER }).ledger,
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
          withExchangeRuleOverrides({
            rule,
            quantityIncrement: "0.1",
            minimumNotional: "0.05",
          })
        ),
      },
    },
    lastBuyPrice: "0.1",
  })

  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "0")
  assert.equal(recoveryLedger.realizedNetProfit, "0.78")
  assert.equal(portfolio.getPosition({ symbol: market.symbol }).baseQuantity.amount, "2")
  assert.deepEqual({ price: sell.price,
quantity: sell.quantity,
reason: sell.reason }, {
    price: "0.1",
    quantity: "1",
    reason: "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY",
  })
})

test("classifies residual quantity below the exchange quantity step instead of submitting an invalid SELL", () => {
  const { portfolio, recoveryLedger } = makeProfitableResidualState({ soldQuantity: "98.95",
quoteQuantity: "10.8845" })
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
            ? { ...rule,
value: { amount: "0.1" } }
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
    evaluatedPrice: "0.1",
    evaluatedNotional: "0.005",
  })
})

test("combines exchange-constrained dust with a later BUY and preserves the full recovery basis", () => {
  const dustState = makeProfitableResidualState({ soldQuantity: "98.95",
quoteQuantity: "10.8845" })
  const laterBuy = new Fill({
    tradeId: "later-buy-after-dust",
    brokerOrderId: "later-buy-order",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1",
asset: quoteAsset }),
    quantity: new Quantity({ amount: "100",
asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10",
asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const {portfolio} = dustState.portfolio.applyFill({ fill: laterBuy,
strategyId: StrategyId.COIN_GRABBER })
  const recoveryLedger = dustState.recoveryLedger.applyFill({ fill: laterBuy,
strategyId: StrategyId.COIN_GRABBER }).ledger
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
            ? { ...rule,
value: { amount: "0.1" } }
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
          withExchangeRuleOverrides({
            rule,
            quantityIncrement: "0.1",
            minimumNotional: "0.05",
            includeMinQuantity: false,
          })
        ),
      },
    },
    activeOrders: [{
      market,
      side: "SELL",
      status: "OPEN",
      remainingQuantity: new Quantity({
          amount: "0.5",
          asset: baseAsset,
        }),
    }],
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


test("keeps recovery SELL eligible without evaluating a new BUY below MIN_NOTIONAL", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig,
orderQuantity: 1 },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    lastBuyPrice: "0.1",
  })

  assert.equal(decision.actions.some((action) => action.side === "SELL"), true)
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
  assert.deepEqual(
    decision.actions.map(({ side }) => side),
    ["SELL"],
    "An active recovery cycle suppresses BUY admission before exchange-specific BUY sizing is evaluated.",
  )
})

test("defers a BUY below MIN_QUANTITY without emitting an invalid order", () => {
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig,
orderQuantity: 0.5 },
    settings,
    portfolio: new Portfolio(),
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "QUANTITY_INCREMENT"
            ? { ...rule,
value: { amount: "0.1" } }
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
    pairConfig: { ...pairConfig,
orderQuantity: 0.5 },
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
    quoteAsset: new Asset({ id: "asset:USDC",
code: "USDC" }),
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
            withExchangeRuleOverrides({
              rule,
              quantityIncrement: "0.1",
              minimumNotional: "0.05",
            })
          ),
          { type: "MAX_QUANTITY",
status: "SUPPORTED",
value: { amount: "0.5" } },
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
            withExchangeRuleOverrides({
              rule,
              quantityIncrement: "0.1",
              minimumNotional: "0.05",
            })
          ),
          { type: "MAX_NOTIONAL",
status: "SUPPORTED",
value: { amount: "0.06" } },
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
          { type: "MAX_PRICE",
status: "SUPPORTED",
value: { amount: "0.101" } },
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
      evaluatedPrice: "0.102",
      evaluatedNotional: "10.098",
    },
    "The decision must preserve the exact blocked recovery inventory and exchange price-filter evidence.",
  )
})

test("keeps recovery SELL eligible without evaluating a new BUY above MAX_QUANTITY", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig: { ...pairConfig,
orderQuantity: 100 },
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: [
          ...marketMetadata.tradingRules.constraints,
          { type: "MAX_QUANTITY",
status: "SUPPORTED",
value: { amount: "50" } },
        ],
      },
    },
    lastBuyPrice: "0.1",
  })

  assert.deepEqual(
    decision.actions.map(({ side }) => side),
    ["SELL"],
    "The active recovery cycle must block a new BUY before MAX_QUANTITY sizing is considered.",
  )
})

test("does not require a next BUY reference while recovery remains active", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()
  const decision = evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
  })

  assert.deepEqual(
    decision.actions.map(({ side }) => side),
    ["SELL"],
    "The strategy must plan recovery SELL without evaluating or inventing a next-cycle BUY reference.",
  )
})


test("reconciles actual DOGE fills and keeps the 1.8 DOGE excess as MIN_NOTIONAL dust", () => {
  const { portfolio, recoveryLedger, metadata } = createDogeDustScenario()
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
    marketPrice: { symbol: "DOGEUSDT",
price: "0.07185",
timestamp: 100 },
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
  const { portfolio, recoveryLedger, metadata, market: dustMarket } = createZroDustScenario()
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
    marketPrice: { symbol: "ZROUSDT",
price: "1.606",
timestamp: 100 },
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
    activeOrders: [{ market: dustMarket,
side: "BUY",
status: "OPEN" }],
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST", "The ZRO residual must be classified as exchange-constrained dust.")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL", "The ZRO dust blocker must identify the minimum-notional filter.")
  assert.equal(decision.inventoryDisposition.quantity, "0.04", "The full ZRO residual quantity must be retained in the dust disposition.")
  assert.equal(decision.inventoryDisposition.evaluatedQuantity, "0.03", "The ZRO quantity evaluated for the exchange filter must remain independently exact.")
  assert.equal(decision.inventoryDisposition.evaluatedNotional, "0.04818", "The ZRO evaluated notional must match the exact residual quantity and current price.")
})

function createAdaResidualState({ adaMarket, adaBaseAsset }) {
  let state = {
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: adaMarket }),
  }
  const fills = [
    {
      side: "BUY",
      tradeId: "ada-buy-738419",
      brokerOrderId: "738419",
      price: "0.1524",
      quantity: "50",
      quoteQuantity: "7.62",
      commissionAmount: "0.05",
      commissionAsset: adaBaseAsset,
    },
    {
      side: "BUY",
      tradeId: "ada-buy-738559",
      brokerOrderId: "738559",
      price: "0.1519",
      quantity: "50",
      quoteQuantity: "7.595",
      commissionAmount: "0.05",
      commissionAsset: adaBaseAsset,
    },
    {
      side: "SELL",
      tradeId: "ada-sell-738736",
      brokerOrderId: "738736",
      price: "0.1531",
      quantity: "99.8",
      quoteQuantity: "15.27938",
      commissionAmount: "0.01527938",
      commissionAsset: quoteAsset,
    },
  ]
  for (const fill of fills) {
    state = applyDustFill({
      state,
      market: adaMarket,
      baseAsset: adaBaseAsset,
      ...fill,
    })
  }
  return state
}

function evaluateAdaResidualState({ state, metadata }) {
  return evaluateConservativeStrategy({
    marketPrice: {
      symbol: "ADAUSDT",
      price: "0.1531",
      timestamp: 100,
    },
    pairConfig: {
      priceStepPercent: 0.3,
      orderQuantity: 50,
      keepQuantity: 0,
      minProfit: 0.05,
      makerPercent: 0.075,
      takerPercent: 0.075,
    },
    settings: {},
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    marketMetadata: metadata,
    lastBuyPrice: "0.1519",
  })
}

function assertAdaRecoveryCompletionProfitBoundaries({ state, position, inventoryDisposition }) {
  const completionInput = {
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    activeQuantity: position.quantity.amount,
    keepQuantity: "0",
    minProfit: "0.05",
    inventoryDisposition,
  }
  const belowMinimumProfit = evaluateRecoveryCompletion({
    ...completionInput,
    netSellProceeds: state.recoveryLedger.netSellProceeds,
  })
  assert.equal(belowMinimumProfit.realizedNetProfit, "0.04910062")
  assert.equal(belowMinimumProfit.eligible, false)
  assert.equal(belowMinimumProfit.pause, true)
  assert.equal(belowMinimumProfit.reason, "RECOVERY_SELL_FAILED_MIN_PROFIT")
  assert.equal(belowMinimumProfit.freeQuantity, "0")
  assert.equal(belowMinimumProfit.dust?.reason, "MIN_NOTIONAL")

  const atMinimumProfit = evaluateRecoveryCompletion({
    ...completionInput,
    netSellProceeds: "15.265",
  })
  assert.equal(atMinimumProfit.realizedNetProfit, "0.05")
  assert.equal(atMinimumProfit.eligible, true)
  assert.equal(atMinimumProfit.pause, false)
  assert.equal(atMinimumProfit.freeQuantity, "0.1")

  const aboveMinimumProfit = evaluateRecoveryCompletion({
    ...completionInput,
    netSellProceeds: "15.26500001",
  })
  assert.equal(aboveMinimumProfit.realizedNetProfit, "0.05000001")
  assert.equal(aboveMinimumProfit.eligible, true)
  assert.equal(aboveMinimumProfit.pause, false)
  assert.equal(aboveMinimumProfit.freeQuantity, "0.1")
}

test("classifies the ADA 0.1 residual as MIN_NOTIONAL when one fee-reserved step cannot be sold", () => {
  const adaBaseAsset = new Asset({
    id: "asset:ADA",
    code: "ADA",
  })
  const adaMarket = new Market({
    venue: "binance",
    symbol: "ADAUSDT",
    baseAsset: adaBaseAsset,
    quoteAsset,
  })
  const metadata = createDustMarketMetadata({
    market: adaMarket,
    priceIncrement: "0.0001",
    quantityIncrement: "0.1",
    minQuantity: "0.1",
    minNotional: "5",
  })
  const state = createAdaResidualState({
    adaMarket,
    adaBaseAsset,
  })
  const position = state.portfolio.getPosition({
    symbol: "ADAUSDT",
  })
  const decision = evaluateAdaResidualState({
    state,
    metadata,
  })

  assert.equal(position.quantity.amount, "0.1")
  assert.equal(position.spent.amount, "15.215")
  assert.equal(state.recoveryLedger.netSellProceeds, "15.26410062")
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.deepEqual(decision.inventoryDisposition, {
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity: "0.1",
    reason: "MIN_NOTIONAL",
    minimumQuantity: "0.1",
    minimumNotional: "5",
    evaluatedQuantity: "0.1",
    evaluatedNotional: "0.01531",
    evaluatedPrice: "0.1531",
  })

  assertAdaRecoveryCompletionProfitBoundaries({
    state,
    position,
    inventoryDisposition: decision.inventoryDisposition,
  })
})
test("fails closed when an active Position is missing its RecoveryLedger", () => {
  const { portfolio } = makeBoughtState()

  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    marketMetadata,
  }), /active Position requires its recovery proceeds ledger/)
})

test("fails closed when Position.spent and RecoveryLedger buyCost diverge", () => {
  const { portfolio } = makeBoughtState()
  const recoveryLedger = {
    market,
    buyCost: "9.99",
    netSellProceeds: "0",
  }

  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
  }), /Position.spent and legacy RecoveryLedger cost mirror diverged/)
})

test("fails closed when active recovery SELL commitments exceed sellable Position inventory", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()

  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    activeOrders: [{
      market,
      side: "SELL",
      status: "OPEN",
      remainingQuantity: new Quantity({
        amount: "100",
        asset: baseAsset,
      }),
    }],
  }), /Aggregate active Conservative recovery SELL commitments exceed sellable Position inventory/)
})

test("rejects a negative remaining quantity on an active recovery SELL", () => {
  const { portfolio, recoveryLedger } = makeBoughtState()

  assert.throws(() => evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    activeOrders: [{
      market,
      side: "SELL",
      status: "OPEN",
      remainingQuantity: {
        amount: "-1",
      },
    }],
  }), /remainingQuantity cannot be negative/)
})


function createDogeIncidentResidualScenario() {
  const incidentBaseAsset = new Asset({
    id: "asset:DOGE",
    code: "DOGE",
  })
  const incidentMarket = new Market({
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAsset: incidentBaseAsset,
    quoteAsset,
  })
  const metadata = createDustMarketMetadata({
    market: incidentMarket,
    priceIncrement: "0.00001",
    quantityIncrement: "1",
    minQuantity: "1",
    minNotional: "5",
  })
  let state = {
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: incidentMarket }),
  }
  for (const [tradeId, price, quote] of [
    ["incident-doge-buy-1", "0.05696", "22.784"],
    ["incident-doge-buy-2", "0.05693", "22.772"],
    ["incident-doge-buy-3", "0.0569", "22.76"],
  ]) {
    state = applyDustFill({
      state,
      market: incidentMarket,
      baseAsset: incidentBaseAsset,
      side: "BUY",
      tradeId,
      brokerOrderId: tradeId,
      price,
      quantity: "400",
      quoteQuantity: quote,
      commissionAmount: "0.4",
      commissionAsset: incidentBaseAsset,
    })
  }
  state = applyDustFill({
    state,
    market: incidentMarket,
    baseAsset: incidentBaseAsset,
    side: "SELL",
    tradeId: "incident-doge-sell",
    brokerOrderId: "incident-doge-sell-order",
    price: "0.05719",
    quantity: "1196",
    quoteQuantity: "68.39924",
    commissionAmount: "0.06839924",
    commissionAsset: quoteAsset,
  })
  return {
    ...state,
    metadata,
    market: incidentMarket,
  }
}

function createZroIncidentResidualScenario({
  quantityIncrement = "0.01",
  minQuantity = "0.01",
  minNotional = "5",
} = {}) {
  const incidentBaseAsset = new Asset({
    id: "asset:ZRO",
    code: "ZRO",
  })
  const incidentMarket = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset: incidentBaseAsset,
    quoteAsset,
  })
  const metadata = createDustMarketMetadata({
    market: incidentMarket,
    priceIncrement: "0.001",
    quantityIncrement,
    minQuantity,
    minNotional,
  })
  let state = {
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: incidentMarket }),
  }
  state = applyDustFill({
    state,
    market: incidentMarket,
    baseAsset: incidentBaseAsset,
    side: "BUY",
    tradeId: "incident-zro-buy",
    brokerOrderId: "incident-zro-buy-order",
    price: "1.084",
    quantity: "5",
    quoteQuantity: "5.42",
    commissionAmount: "0.005",
    commissionAsset: incidentBaseAsset,
  })
  state = applyDustFill({
    state,
    market: incidentMarket,
    baseAsset: incidentBaseAsset,
    side: "SELL",
    tradeId: "incident-zro-sell",
    brokerOrderId: "incident-zro-sell-order",
    price: "1.092",
    quantity: "4.98",
    quoteQuantity: "5.43816",
    commissionAmount: "0.00543816",
    commissionAsset: quoteAsset,
  })
  return {
    ...state,
    metadata,
    market: incidentMarket,
  }
}

function evaluateIncidentResidual({
  symbol,
  price,
  keepQuantity,
  orderQuantity,
  portfolio,
  recoveryLedger,
  incidentMarketMetadata,
  lastBuyPrice,
} = {}) {
  return evaluateConservativeStrategy({
    marketPrice: {
      symbol,
      price,
      timestamp: 100,
    },
    pairConfig: {
      priceStepPercent: 0.05,
      orderQuantity,
      keepQuantity,
      minProfit: 0.01,
      makerPercent: 0.1,
      takerPercent: 0.1,
    },
    settings: {},
    portfolio,
    recoveryLedger,
    marketMetadata: incidentMarketMetadata,
    lastBuyPrice,
  })
}

test("sells the fee-reserved 1.7 DOGE quantity from the incident 2.8 DOGE residual under explicit sellable test filters", () => {
  const { portfolio, recoveryLedger, metadata } = createDogeIncidentResidualScenario()
  const position = portfolio.getPosition({ symbol: "DOGEUSDT" })
  assert.equal(position.quantity.amount, "2.8")
  assert.equal(recoveryLedger.realizedNetProfit, "0.01484076")
  const sellableMetadata = {
    ...metadata,
    tradingRules: {
      constraints: metadata.tradingRules.constraints.map((rule) =>
        withExchangeRuleOverrides({
          rule,
          quantityIncrement: "0.1",
          minimumNotional: "0.05",
        })
      ),
    },
  }
  const decision = evaluateIncidentResidual({
    symbol: "DOGEUSDT",
    price: "0.05719",
    keepQuantity: 1,
    orderQuantity: 400,
    portfolio,
    recoveryLedger,
    incidentMarketMetadata: sellableMetadata,
    lastBuyPrice: "0.0569",
  })
  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(sell?.quantity, "1.7")
  assert.equal(sell?.reason, "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY")
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
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
})

test("classifies the incident 2.8 DOGE residual as dust only with explicit minimum-notional test filters", () => {
  const { portfolio, recoveryLedger, metadata } = createDogeIncidentResidualScenario()
  const position = portfolio.getPosition({ symbol: "DOGEUSDT" })
  const decision = evaluateIncidentResidual({
    symbol: "DOGEUSDT",
    price: "0.05719",
    keepQuantity: 1,
    orderQuantity: 400,
    portfolio,
    recoveryLedger,
    incidentMarketMetadata: metadata,
    lastBuyPrice: "0.0569",
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST")
  assert.equal(decision.inventoryDisposition.quantity, "1.8")
  assert.equal(decision.inventoryDisposition.reason, "MIN_NOTIONAL")
  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.quantity.amount,
    keepQuantity: "1",
    minProfit: "0.01",
    inventoryDisposition: decision.inventoryDisposition,
  })
  assert.equal(completion.eligible, true, "Validated fixture dust may complete without a residual SELL.")
  assert.equal(completion.dust.quantity, "1.8")
  assert.equal(completion.freeQuantity, "2.8")
})

test("sells the fee-reserved 0.004 ZRO quantity from the incident 0.015 ZRO residual under explicit sellable test filters", () => {
  const { portfolio, recoveryLedger, metadata } = createZroIncidentResidualScenario({
    quantityIncrement: "0.001",
    minQuantity: "0.001",
    minNotional: "0.001",
  })
  const position = portfolio.getPosition({ symbol: "ZROUSDT" })
  assert.equal(position.quantity.amount, "0.015")
  assert.equal(recoveryLedger.realizedNetProfit, "0.01272184")
  const decision = evaluateIncidentResidual({
    symbol: "ZROUSDT",
    price: "1.092",
    keepQuantity: 0.01,
    orderQuantity: 5,
    portfolio,
    recoveryLedger,
    incidentMarketMetadata: metadata,
    lastBuyPrice: "1.084",
  })
  const sell = decision.actions.find((action) => action.side === "SELL")
  assert.equal(sell?.quantity, "0.004")
  assert.equal(sell?.reason, "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY")
  assert.equal(decision.actions.some((action) => action.side === "BUY"), false)
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
})

test("classifies the incident 0.015 ZRO residual as quantity-step dust with explicit filter test fixtures", () => {
  const { portfolio, recoveryLedger, metadata } = createZroIncidentResidualScenario()
  const position = portfolio.getPosition({ symbol: "ZROUSDT" })
  const decision = evaluateIncidentResidual({
    symbol: "ZROUSDT",
    price: "1.092",
    keepQuantity: 0.01,
    orderQuantity: 5,
    portfolio,
    recoveryLedger,
    incidentMarketMetadata: metadata,
    lastBuyPrice: "1.084",
  })
  assert.equal(decision.actions.some((action) => action.side === "SELL"), false)
  assert.equal(decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST")
  assert.equal(decision.inventoryDisposition.quantity, "0.005")
  assert.equal(decision.inventoryDisposition.reason, "QUANTITY_INCREMENT")
  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.quantity.amount,
    keepQuantity: "0.01",
    minProfit: "0.01",
    inventoryDisposition: decision.inventoryDisposition,
  })
  assert.equal(completion.eligible, true, "Validated fixture dust may complete without a residual SELL.")
  assert.equal(completion.dust.quantity, "0.005")
  assert.equal(completion.freeQuantity, "0.015")
})
