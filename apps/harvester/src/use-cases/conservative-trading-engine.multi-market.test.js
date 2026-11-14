import { StrategyId } from "../domain/strategies/strategy-ids.js"
import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[conservative-trading-engine.multi-market.test.js] " + name, ...args)
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
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"

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
    unvalidatedConstraints: [],
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

async function createHarness({ quoteFreeBalance = "10000", portfolio: initialPortfolio, initialState, strategyPolicy = conservativeStrategyPolicy, recoveryLedgersByMarket = new Map(), volatilityProtectionEnabled = false, externalOrdersPolicyBySymbol = {} } = {}) {
  const orders = []
  const pauses = []
  const accountedFillIds = new Set()
  const accountedFills = []
  const portfolio = initialPortfolio ?? new Portfolio()
  const metadataBySymbol = new Map(markets.map((market) => [
    market.symbol,
    makeMarketMetadata(market),
  ]))
  const appConfig = {
    strategies: {
      [StrategyId.COIN_GRABBER]: {
        enabled: true,
        settings: { conservative: { enabled: true }, aggressive: { enabled: false } },
        pairs: Object.fromEntries(markets.map((market) => [market.symbol, {
      enabled: true,
      ...(externalOrdersPolicyBySymbol[market.symbol] === undefined
        ? {}
        : { externalOrdersPolicy: externalOrdersPolicyBySymbol[market.symbol] }),
      investment: 1000,
      orderQuantity: 1,
      keepQuantity: 0.1,
      minProfit: market.symbol === "DOGEUSDT" ? 0.1 : 0.01,
      priceStepPercent: 0.05,
      makerPercent: 0,
      takerPercent: 0.075,
        }])),
      },
    },
  }
  const broker = {
    placeOrder: async ({ order }) => {
      orders.push(order)
      const market = marketsBySymbol.get(order.symbol)
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "broker-" + order.clientOrderId,
          market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: market.quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: market.baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
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
    strategyPolicy,
    appConfig,
    getPortfolio: () => portfolio,
    getRecoveryLedger: ({ marketId }) => recoveryLedgersByMarket.get(marketId) ?? RecoveryLedger.empty({ market: marketsById.get(marketId) }),
    getMarketMetadata: ({ symbol }) => metadataBySymbol.get(symbol),
    getAccountSnapshot: () => ({
      getFreeBalance: ({ assetId }) => new Quantity({
        amount: assetId === quoteAsset.id ? quoteFreeBalance : "10000",
        asset: assetsById.get(assetId),
      }),
      getPortfolioBaseQuantityBaseline: () => "0",
      getCommittedQuoteBalanceBaseline: () => "0",
      getCommittedBaseBalanceBaseline: () => "0",
    }),
    updateTradingAccounting: async ({ fill }) => {
      if (accountedFillIds.has(fill.id)) {
        return { ok: true, data: { applied: false, duplicate: true } }
      }
      accountedFillIds.add(fill.id)
      accountedFills.push(fill)
      return { ok: true, data: { applied: true, duplicate: false } }
    },
    completeRecoveryCycle: async () => ({
      ok: true,
      data: { eligible: true, freeQuantity: "0.1", realizedNetProfit: "1" },
    }),
    canTrade: () => true,
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    isStopping: () => false,
    onPause: async ({ symbol, reason }) => pauses.push({ symbol, reason }),
    getVolatilityData: volatilityProtectionEnabled
      ? () => ({ ok: false, error: new Error("test volatility snapshot unavailable") })
      : undefined,
    initialState,
  })

  for (const market of markets) {
    await engine.processBookTicker({ symbol: market.symbol, bookTicker: {
      symbol: market.symbol,
      bestBidPrice: "0.01",
      bestBidQuantity: "1",
      bestAskPrice: "1000",
      bestAskQuantity: "1",
      timestamp: 1,
    } })
  }

  return { engine, orders, pauses, accountedFills }
}

async function startBothMarkets(engine) {
  for (const market of markets) {
    const result = await engine.processMarketPrice({
      symbol: market.symbol,
      priceEvent: { symbol: market.symbol, price: "100", timestamp: 1 },
    })
    assert.equal(result.ok, true, result.errors?.map((error) => error.message).join("; ") ?? "Market evaluation failed")
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

test("shared quote-asset BUY commitments are reserved across markets", async () => {
  const { engine, orders } = await createHarness({ quoteFreeBalance: "150" })
  const [dogeResult, solResult] = await Promise.all([
    engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
    }),
    engine.processMarketPrice({
      symbol: "SOLUSDT",
      priceEvent: { symbol: "SOLUSDT", price: "100", timestamp: 1 },
    }),
  ])

  assert.equal(dogeResult.ok, true)
  assert.equal(solResult.ok, true)
  const deferred = [dogeResult, solResult].find((result) => result.data.waitingForAvailableQuoteBalance)
  assert.ok(deferred)
  assert.equal(deferred.data.deferredActions[0].reason, "INSUFFICIENT_QUOTE_BALANCE")
  assert.equal(orders.length, 1)
  assert.ok(["DOGEUSDT", "SOLUSDT"].includes(orders[0].symbol))
  assert.equal(engine.getOrders().length, 1)
  assert.equal(orders.length, 1)
})

test("shared quote cash flow from another market reduces the account-wide BUY budget", async () => {
  const priorDogeBuy = new Fill({
    tradeId: "prior-doge-buy",
    brokerOrderId: "broker-prior-doge-buy",
    clientOrderId: "prior-doge-client",
    market: marketsBySymbol.get("DOGEUSDT"),
    side: "BUY",
    price: new Money({ amount: "99.95", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: dogeAsset }),
    quoteQuantity: new Money({ amount: "99.95", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
    executedAt: 1,
  })
  const portfolio = new Portfolio().applyFill({ fill: priorDogeBuy, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const { engine, orders } = await createHarness({
    quoteFreeBalance: "150",
    portfolio,
  })

  const result = await engine.processMarketPrice({
    symbol: "SOLUSDT",
    priceEvent: { symbol: "SOLUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.waitingForAvailableQuoteBalance, true)
  assert.equal(result.data.deferredActions[0].reason, "INSUFFICIENT_QUOTE_BALANCE")
  assert.equal(orders.length, 0)
})

test("an unowned order in one market pauses only that market and cannot block another market fill", async () => {
  const { engine, pauses, accountedFills } = await createHarness({
    externalOrdersPolicyBySymbol: { SOLUSDT: "block" },
  })
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

test("accounts the same broker trade ID independently for different markets", async () => {
  const { engine, accountedFills } = await createHarness()
  await startBothMarkets(engine)
  const dogeOrder = engine.getOrders().find((order) => order.market.symbol === "DOGEUSDT")
  const solOrder = engine.getOrders().find((order) => order.market.symbol === "SOLUSDT")
  const dogeEvent = makePartialFillEvent({
    order: dogeOrder,
    tradeId: "shared-trade-id",
    quantity: "0.4",
    quoteQuantity: "39.98",
  })
  const solEvent = makePartialFillEvent({
    order: solOrder,
    tradeId: "shared-trade-id",
    quantity: "0.3",
    quoteQuantity: "29.985",
  })

  assert.notEqual(
    dogeEvent.fill.id,
    solEvent.fill.id,
    "Canonical Fill identity must include market identity even when two markets reuse the same broker trade ID.",
  )
  const dogeResult = await engine.processUserDataEvent({ event: dogeEvent })
  const solResult = await engine.processUserDataEvent({ event: solEvent })

  assert.equal(
    dogeResult.ok,
    true,
    "The DOGEUSDT execution must be accepted for its own market-scoped Fill identity.",
  )
  assert.equal(
    solResult.ok,
    true,
    "The SOLUSDT execution must be accepted independently even though its trade ID matches the DOGEUSDT execution.",
  )
  assert.deepEqual(
    accountedFills.map((fill) => ({ symbol: fill.market.symbol, tradeId: fill.tradeId })),
    [
      { symbol: "DOGEUSDT", tradeId: "shared-trade-id" },
      { symbol: "SOLUSDT", tradeId: "shared-trade-id" },
    ],
    "Both executions must reach accounting; deduplication by raw tradeId alone must not suppress the second market's fill.",
  )
  assert.deepEqual(
    engine.getPausedMarkets(),
    [],
    "Reusing a trade ID across markets is valid and must not pause either market.",
  )
})

test("duplicate fills and stale order updates do not double-account across markets", async () => {
  const { engine, pauses, accountedFills } = await createHarness()
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


test("operator pause blocks new BUY exposure only for the selected market", async () => {
  const { engine, orders } = await createHarness()

  assert.equal(
    typeof engine.pauseMarket,
    "function",
    "The trading engine must expose a serialized operator-pause boundary before the operator capability can be used.",
  )

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })

  assert.equal(
    pauseResult.ok,
    true,
    "A configured market must accept an operator pause after its durable fact has been committed.",
  )
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "The operator pause must be tracked independently for the selected market.",
  )
  assert.deepEqual(
    engine.getPausedMarkets(),
    [],
    "An operator pause must not be represented as or overwrite a safety pause.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [{ symbol: "SOLUSDT", side: "BUY" }],
    "Pausing DOGEUSDT must suppress its new BUY while leaving SOLUSDT eligible for normal strategy evaluation.",
  )
})

test("operator pause does not change in-memory state when the durable fact commit fails", async () => {
  const { engine, orders } = await createHarness()

  assert.equal(
    typeof engine.pauseMarket,
    "function",
    "The trading engine must expose the operator-pause boundary for durable-before-apply verification.",
  )

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({
      ok: false,
      errors: [new Error("durable fact commit failed")],
    }),
  })

  assert.equal(
    pauseResult.ok,
    false,
    "A failed durable-fact append must reject the pause instead of acknowledging an unpersisted control change.",
  )
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    [],
    "A failed durable-fact append must leave the operator-pause projection unchanged.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [
      { symbol: "DOGEUSDT", side: "BUY" },
      { symbol: "SOLUSDT", side: "BUY" },
    ],
    "A rejected pause must not partially block either market's ordinary BUY evaluation.",
  )
})

test("operator pause leaves existing exchange orders untouched and suppresses trailing-BUY replacement", async () => {
  const { engine, orders } = await createHarness()
  await startBothMarkets(engine)
  const beforePause = engine.getOrders().map(({ clientOrderId, status, market }) => ({
    clientOrderId,
    status,
    symbol: market.symbol,
  }))

  assert.equal(
    typeof engine.pauseMarket,
    "function",
    "The trading engine must expose operator pause without routing it through exchange cancellation.",
  )

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })
  assert.equal(
    pauseResult.ok,
    true,
    "An operator pause must succeed without requiring cancellation of an already acknowledged order.",
  )

  const priceResult = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.1", timestamp: 2 },
  })

  assert.equal(
    priceResult.ok,
    true,
    "Market-price intake must continue while an operator pause is active.",
  )
  assert.deepEqual(
    engine.getOrders().map(({ clientOrderId, status, market }) => ({
      clientOrderId,
      status,
      symbol: market.symbol,
    })),
    beforePause,
    "Operator pause must preserve existing order identities and statuses without cancellation or replacement.",
  )
  assert.equal(
    orders.length,
    2,
    "Operator pause must not submit a trailing-BUY replacement or any other new order for the paused market.",
  )
})

test("operator pause restored from durable facts is active before the first market evaluation", async () => {
  const { engine, orders } = await createHarness({
    initialState: { operatorPausedMarkets: ["DOGEUSDT"] },
  })

  assert.equal(
    typeof engine.getOperatorPausedMarkets,
    "function",
    "The engine must expose its restored operator-pause projection for startup verification.",
  )
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "A restored operator pause must be available before any market event is evaluated.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [{ symbol: "SOLUSDT", side: "BUY" }],
    "The first DOGEUSDT strategy evaluation must observe the restored pause and submit no BUY.",
  )
})


test("operator pause preserves recovery SELL execution while suppressing the same market's BUY", async () => {
  const dogeMarket = marketsBySymbol.get("DOGEUSDT")
  const recoveryFill = new Fill({
    tradeId: "operator-pause-recovery-buy",
    brokerOrderId: "operator-pause-recovery-order",
    clientOrderId: "operator-pause-recovery-client",
    market: dogeMarket,
    side: "BUY",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: dogeAsset }),
    quoteQuantity: new Money({ amount: "100", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
    executedAt: 1,
  })
  const portfolio = new Portfolio().applyFill({ fill: recoveryFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const recoveryLedger = RecoveryLedger.empty({ market: dogeMarket }).applyFill({ fill: recoveryFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const strategyPolicy = {
    evaluate: ({ marketPrice }) => {
      const buy = {
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "99.95",
        quantity: "1",
        reason: "TEST_STANDING_BUY",
      }
      const recoverySell = {
        side: "SELL",
        purpose: "RECOVERY_SELL",
        type: "LIMIT_MAKER",
        price: "100.01",
        quantity: "0.9",
        reason: "TEST_RECOVERY_SELL",
      }
      return {
        strategy: "CONSERVATIVE",
        symbol: marketPrice.symbol,
        action: "PLACE_ORDERS",
        reason: "TEST_OPERATOR_PAUSE",
        actions: marketPrice.symbol === "DOGEUSDT" ? [recoverySell, buy] : [buy],
      }
    },
    evaluateTrailingBuyRepricing: conservativeStrategyPolicy.evaluateTrailingBuyRepricing,
  }
  const { engine, orders } = await createHarness({
    portfolio,
    strategyPolicy,
    recoveryLedgersByMarket: new Map([[dogeMarket.id, recoveryLedger]]),
  })

  assert.equal(
    typeof engine.pauseMarket,
    "function",
    "The engine must expose operator pause before recovery-Sell coexistence can be verified.",
  )
  const paused = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })
  assert.equal(
    paused.ok,
    true,
    "The operator pause must be established before evaluating the market's recovery and entry intents.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [
      { symbol: "DOGEUSDT", side: "SELL" },
      { symbol: "SOLUSDT", side: "BUY" },
    ],
    "The paused market must retain its risk-reducing recovery SELL while suppressing only its new BUY; another market remains active.",
  )
})

test("resume refuses to clear operator pause while a safety pause is active", async () => {
  const { engine } = await createHarness({
    initialState: {
      operatorPausedMarkets: ["DOGEUSDT"],
      pausedMarkets: ["DOGEUSDT"],
    },
  })
  let durableCommits = 0

  assert.equal(
    typeof engine.resumeMarket,
    "function",
    "The engine must expose an explicit resume boundary rather than reusing the safety-pause API.",
  )
  const result = await engine.resumeMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => {
      durableCommits += 1
      return { ok: true, data: { durable: true } }
    },
  })

  assert.equal(
    result.ok,
    false,
    "An operator resume must be rejected while the independent safety pause remains active.",
  )
  assert.equal(
    result.errors[0].code,
    "SAFETY_BLOCKER_ACTIVE",
    "The rejection must identify the unresolved safety blocker.",
  )
  assert.equal(
    durableCommits,
    0,
    "A rejected resume must not append a durable resume fact.",
  )
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "A rejected resume must preserve the operator-owned pause.",
  )
  assert.deepEqual(
    engine.getPausedMarkets(),
    ["DOGEUSDT"],
    "A rejected resume must preserve the independent safety pause.",
  )
})

test("repeated operator pause is idempotent and does not append another durable fact", async () => {
  const { engine } = await createHarness()
  let durableCommits = 0
  const beforeApply = async () => {
    durableCommits += 1
    return { ok: true, data: { durable: true } }
  }

  const first = await engine.pauseMarket({ symbol: "DOGEUSDT", beforeApply })
  const second = await engine.pauseMarket({ symbol: "DOGEUSDT", beforeApply })

  assert.equal(first.ok, true, "The first durable operator pause must succeed.")
  assert.equal(second.ok, true, "Repeating an already-active operator pause must be harmless.")
  assert.equal(
    second.data.alreadyPaused,
    true,
    "The repeated pause result must identify that the market was already paused.",
  )
  assert.equal(
    durableCommits,
    1,
    "An already-active pause must not append another durable fact.",
  )
})


test("resume removes only the operator pause after its durable fact commits", async () => {
  const { engine, orders } = await createHarness({
    initialState: { operatorPausedMarkets: ["DOGEUSDT"] },
  })
  let durableCommits = 0

  const result = await engine.resumeMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => {
      durableCommits += 1
      assert.deepEqual(
        engine.getOperatorPausedMarkets(),
        ["DOGEUSDT"],
        "The operator pause must remain active while the durable resume fact is being committed.",
      )
      return { ok: true, data: { durable: true } }
    },
  })

  assert.equal(result.ok, true, "A resume without safety or recovery blockers must succeed.")
  assert.equal(durableCommits, 1, "A successful resume must commit exactly one durable fact.")
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    [],
    "The in-memory operator pause may be removed only after durable resume acknowledgement.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [
      { symbol: "DOGEUSDT", side: "BUY" },
      { symbol: "SOLUSDT", side: "BUY" },
    ],
    "A durably resumed market must return to normal strategy evaluation without changing other markets.",
  )
})

test("failed durable resume leaves the operator pause active", async () => {
  const { engine } = await createHarness({
    initialState: { operatorPausedMarkets: ["DOGEUSDT"] },
  })
  const result = await engine.resumeMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({
      ok: false,
      errors: [new Error("durable resume commit failed")],
    }),
  })

  assert.equal(result.ok, false, "A failed durable resume commit must reject the state transition.")
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "A failed durable resume commit must leave the operator pause unchanged.",
  )
})


test("resume remains blocked while enabled high-volatility protection is in startup warmup", async () => {
  const { engine } = await createHarness({
    initialState: { operatorPausedMarkets: ["DOGEUSDT"] },
    volatilityProtectionEnabled: true,
  })
  let durableCommits = 0
  const result = await engine.resumeMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => {
      durableCommits += 1
      return { ok: true, data: { durable: true } }
    },
  })

  assert.equal(
    result.ok,
    false,
    "Operator resume must not bypass the enabled high-volatility startup-warmup protection.",
  )
  assert.equal(
    result.errors[0].code,
    "SAFETY_BLOCKER_ACTIVE",
    "The enabled volatility protection state must be reported as an independent safety blocker.",
  )
  assert.equal(
    durableCommits,
    0,
    "The resume fact must not be appended while high-volatility protection is still active.",
  )
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "The operator pause must remain active until the independent volatility blocker clears.",
  )
})
