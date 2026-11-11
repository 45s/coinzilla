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

async function createHarness({ quoteFreeBalance = "10000", portfolio: initialPortfolio, initialState, strategyPolicy = conservativeStrategyPolicy, recoveryLedgersByMarket = new Map() } = {}) {
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
      CG_coinGrabber: {
        enabled: true,
        settings: { conservative: { enabled: true }, aggressive: { enabled: false } },
        pairs: Object.fromEntries(markets.map((market) => [market.symbol, {
      enabled: true,
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
  const portfolio = new Portfolio().applyFill({ fill: priorDogeBuy }).portfolio
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
  const { engine, pauses, accountedFills } = await createHarness()
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

test("operator pause blocks new BUY orders only for the selected market without creating a safety pause", async () => {
  const { engine, orders } = await createHarness()

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })

  assert.equal(
    pauseResult.ok,
    true,
    "An operator must be able to request a pause for a configured market through the serialized engine boundary.",
  )
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "The selected market must retain an operator-owned pause reason independently of safety pause state.",
  )
  assert.deepEqual(
    engine.getPausedMarkets(),
    [],
    "An operator pause must not be represented as or overwrite an engine safety pause.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [{ symbol: "SOLUSDT", side: "BUY" }],
    "Operator pause must prevent new BUY exposure for DOGEUSDT while leaving an unrelated configured market eligible.",
  )
})

test("operator pause leaves already acknowledged exchange orders untouched", async () => {
  const { engine, orders } = await createHarness()
  await startBothMarkets(engine)
  const existingOrders = engine.getOrders().map(({ clientOrderId, status, market }) => ({
    clientOrderId,
    status,
    symbol: market.symbol,
  }))

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })

  assert.equal(
    pauseResult.ok,
    true,
    "Pausing a market with an acknowledged order must complete without requiring an exchange cancellation.",
  )
  assert.deepEqual(
    engine.getOrders().map(({ clientOrderId, status, market }) => ({
      clientOrderId,
      status,
      symbol: market.symbol,
    })),
    existingOrders,
    "Operator pause must preserve every existing owned order identity and canonical status; it must not cancel or rewrite exchange orders.",
  )
  assert.equal(
    orders.length,
    2,
    "Pausing one market must not submit replacement or cancellation requests for its already acknowledged order.",
  )
})



test("operator pause requires a durable fact before changing in-memory state", async () => {
  const { engine, orders } = await createHarness()

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({
      ok: false,
      errors: [new Error("durable fact commit failed")],
    }),
  })

  assert.equal(pauseResult.ok, false, "A failed durable-fact commit must reject the operator pause.")
  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    [],
    "A pause whose durable fact was not committed must not change in-memory operator state.",
  )

  await startBothMarkets(engine)
  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [{ symbol: "DOGEUSDT", side: "BUY" }, { symbol: "SOLUSDT", side: "BUY" }],
    "A failed durable commit must not partially pause the market or block its normal strategy evaluation.",
  )
})

test("operator pause state supplied by durable recovery is restored before market evaluation", async () => {
  const { engine, orders } = await createHarness({
    initialState: { operatorPausedMarkets: ["DOGEUSDT"] },
  })

  assert.deepEqual(
    engine.getOperatorPausedMarkets(),
    ["DOGEUSDT"],
    "The engine must accept the operator-pause projection supplied by the durable recovery boundary.",
  )

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [{ symbol: "SOLUSDT", side: "BUY" }],
    "A restored operator pause must block the selected market before its first strategy evaluation.",
  )
})


test("operator pause permits recovery SELLs while suppressing the next standing BUY", async () => {
  const dogeMarket = marketsBySymbol.get("DOGEUSDT")
  const portfolio = {
    positions: [{
      market: dogeMarket,
      totalBaseQuantity: { amount: "1" },
      quoteNetCashFlow: { amount: "-100" },
    }],
    getPosition: ({ marketId }) => marketId === dogeMarket.id
      ? { baseQuantity: { amount: "1" }, spent: { amount: "100" } }
      : undefined,
  }
  const recoveryLedgersByMarket = new Map([[
    dogeMarket.id,
    { market: dogeMarket, buyCost: "100", netSellProceeds: "0" },
  ]])
  const strategyPolicy = {
    name: "CONSERVATIVE",
    evaluate: ({ marketPrice }) => ({
      strategy: "CONSERVATIVE",
      symbol: marketPrice.symbol,
      action: "PLACE_ORDERS",
      actions: marketPrice.symbol === "DOGEUSDT"
        ? [
            { side: "SELL", type: "LIMIT_MAKER", price: "100", quantity: "1", reason: "RECOVERY" },
            { side: "BUY", type: "LIMIT_MAKER", price: "99", quantity: "1", reason: "NEXT_STANDING_BUY" },
          ]
        : [
            { side: "BUY", type: "LIMIT_MAKER", price: "99", quantity: "1", reason: "INITIAL_BUY" },
          ],
    }),
    evaluateTrailingBuyRepricing: conservativeStrategyPolicy.evaluateTrailingBuyRepricing,
  }
  const { engine, orders } = await createHarness({
    portfolio,
    recoveryLedgersByMarket,
    strategyPolicy,
  })

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })
  assert.equal(pauseResult.ok, true, "The operator pause must be committed before strategy evaluation.")

  await startBothMarkets(engine)

  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [
      { symbol: "DOGEUSDT", side: "SELL" },
      { symbol: "SOLUSDT", side: "BUY" },
    ],
    "Operator pause must preserve the Conservative recovery SELL while suppressing only the paused market's new BUY.",
  )
})

test("operator pause does not cancel or reprice an already acknowledged BUY", async () => {
  const { engine, orders } = await createHarness()
  await startBothMarkets(engine)
  const dogeOrder = engine.getOrders().find((order) => order.market.symbol === "DOGEUSDT")
  const before = engine.getOrders().map(({ clientOrderId, status }) => ({ clientOrderId, status }))

  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })
  assert.equal(pauseResult.ok, true, "The operator pause must be accepted for a configured market.")

  const priceResult = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.1", timestamp: 2 },
  })
  assert.equal(priceResult.ok, true, "A market update must continue to be processed while operator-paused.")
  assert.deepEqual(
    engine.getOrders().map(({ clientOrderId, status }) => ({ clientOrderId, status })),
    before,
    "The pause must leave the existing BUY order untouched and prevent trailing repricing/cancellation.",
  )
  assert.equal(orders.length, 2, "No replacement BUY may be submitted after the operator pause.")
  assert.ok(dogeOrder, "The pre-existing DOGEUSDT order must remain registered.")
})

test("operator resume commits its fact before removing only the operator pause", async () => {
  const { engine, orders } = await createHarness()
  const pauseResult = await engine.pauseMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })
  assert.equal(pauseResult.ok, true, "The test market must first enter the operator-paused state.")

  let durableResumeWrites = 0
  const resumeResult = await engine.resumeMarket({
    symbol: "DOGEUSDT",
    beforeApply: async () => {
      durableResumeWrites += 1
      return { ok: true, data: { durable: true } }
    },
  })

  assert.equal(resumeResult.ok, true, "A blocker-free operator pause must be resumable.")
  assert.equal(durableResumeWrites, 1, "The resume fact must be committed exactly once before state is cleared.")
  assert.deepEqual(engine.getOperatorPausedMarkets(), [], "Resume must remove the operator-owned pause.")
  assert.deepEqual(engine.getPausedMarkets(), [], "Resume must not create or clear a safety pause.")

  await startBothMarkets(engine)
  assert.deepEqual(
    orders.map(({ symbol, side }) => ({ symbol, side })),
    [{ symbol: "DOGEUSDT", side: "BUY" }, { symbol: "SOLUSDT", side: "BUY" }],
    "The next market evaluation may resume normal BUY planning after a committed operator resume.",
  )
})

test("operator resume refuses to clear a safety blocker and does not persist a resume fact", async () => {
  const { engine } = await createHarness()
  const solMarket = marketsBySymbol.get("SOLUSDT")
  const unownedSolOrder = new CanonicalOrder({
    clientOrderId: "manual-sol-client-for-resume",
    brokerOrderId: "manual-sol-order-for-resume",
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
  const safetyResult = await engine.processUserDataEvent({
    event: { eventType: "executionReport", executedOrder: unownedSolOrder },
  })
  assert.equal(safetyResult.ok, false, "The unowned order must establish the safety blocker.")

  const pauseResult = await engine.pauseMarket({
    symbol: "SOLUSDT",
    beforeApply: async () => ({ ok: true, data: { durable: true } }),
  })
  assert.equal(pauseResult.ok, true, "An operator pause may coexist with a safety blocker.")

  let durableResumeWrites = 0
  const resumeResult = await engine.resumeMarket({
    symbol: "SOLUSDT",
    beforeApply: async () => {
      durableResumeWrites += 1
      return { ok: true, data: { durable: true } }
    },
  })

  assert.equal(resumeResult.ok, false, "An operator resume must not clear a safety blocker.")
  assert.equal(resumeResult.errors[0].code, "SAFETY_BLOCKER_ACTIVE")
  assert.equal(durableResumeWrites, 0, "A forbidden resume must not append a resume fact.")
  assert.deepEqual(engine.getOperatorPausedMarkets(), ["SOLUSDT"])
  assert.deepEqual(engine.getPausedMarkets(), ["SOLUSDT"])
})

test("repeated operator pause is idempotent and does not append another fact", async () => {
  const { engine } = await createHarness()
  let durablePauseWrites = 0
  const beforeApply = async () => {
    durablePauseWrites += 1
    return { ok: true, data: { durable: true } }
  }

  const first = await engine.pauseMarket({ symbol: "DOGEUSDT", beforeApply })
  const second = await engine.pauseMarket({ symbol: "DOGEUSDT", beforeApply })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.data.alreadyPaused, true)
  assert.equal(durablePauseWrites, 1, "An already-paused market must not append another pause fact.")
})

test("operator pause rejects an unconfigured market before attempting a durable write", async () => {
  const { engine } = await createHarness()
  let durablePauseWrites = 0

  const result = await engine.pauseMarket({
    symbol: "UNKNOWNUSDT",
    beforeApply: async () => {
      durablePauseWrites += 1
      return { ok: true, data: { durable: true } }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(durablePauseWrites, 0)
  assert.deepEqual(engine.getOperatorPausedMarkets(), [])
})

