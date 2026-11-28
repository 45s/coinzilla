import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createLatestTransitionEvaluator } from "./create-latest-transition-evaluator.js"
import { createStrategyLogger } from "../application/logging/create-strategy-logger.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-latest-transition-evaluator.test.js] ${name}`, ...testArgs)
}

function createDurableEventPublisherStub() {
  const eventPublisher = {
    publish: () => ({ ok: true }),
    flush: async () => ({
      ok: true,
      durable: true,
    }),
  }
  eventPublisher.flushWrites = async () => ({
    ok: true,
    durable: true,
  })
  return eventPublisher
}

function createDependencies({ hardPause = false } = {}) {
  const symbol = "DOGEUSDT"
  const state = {
    shutdownBuyGate: true,
    paused: new Set([symbol]),
    recoveryManagedPausedMarkets: new Set([symbol]),
    durablePausedMarkets: hardPause ? new Set([symbol]) : new Set(),
    operatorPausedMarkets: new Set(),
    replacementIntents: new Set(),
    trailingBuyRepriceIntents: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
    deferredEvaluations: new Set(),
    prices: new Map([
      [symbol, {
        price: "100",
        timestamp: 1,
      }],
    ]),
    lastBuyPrices: new Map(),
    buyReferenceOverrides: new Map(),
    lastAdjustmentPrices: new Map(),
    marketPriceEventIds: new Map(),
    registry: {
      getActiveOrders: () => [],
    },
  }
  return {
    state,
    hasBlockingOpenOrdersForSymbol: () => false,
    isStopping: () => true,
    canTrade: () => false,
    isMarketPriceFresh: () => true,
    getCurrentMarketMetadata: () => ({
      market: {
        id: "DOGEUSDT",
      },
    }),
    nextEvaluationId: () => 1,
    getPortfolio: () => ({
      value: {},
      positions: [],
    }),
    getRecoveryLedger: () => ({
      value: {},
    }),
    pairs: { [symbol]: { enabled: true } },
    settings: {},
    logger: { debug: () => {} },
    eventPublisher: createDurableEventPublisherStub(),
    strategyPolicy: {
      evaluate: () => ({
        actions: [],
        reason: "NO_ACTION",
      }),
    },
  }
}

test("allows shutdown recovery evaluation through a recovery-managed pause", async () => {
  const evaluate = createLatestTransitionEvaluator(createDependencies())
  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, true)
  assert.notEqual(result.data?.skipped, true)
})

test("keeps RS-owned active orders out of Conservative policy inputs", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const rsOrder = {
    clientOrderId: "rs-buy-1",
    side: "BUY",
  }
  const cgOrder = {
    clientOrderId: "cg-buy-1",
    side: "BUY",
  }
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.delete(symbol)
  dependencies.state.recoveryManagedPausedMarkets.delete(symbol)
  dependencies.isStopping = () => false
  dependencies.canTrade = () => true
  dependencies.state.registry.getActiveOrders = () => [rsOrder, cgOrder]
  dependencies.state.registry.getOwnership = ({ clientOrderId }) => ({
    strategyId: clientOrderId === "rs-buy-1" ? "RS_recoverySeller" : "CG_coinGrabber",
  })
  let receivedOrders
  dependencies.strategyPolicy.evaluate = ({ activeOrders }) => {
    receivedOrders = activeOrders
    return {
      actions: [],
      reason: "NO_ACTION",
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol })

  assert.equal(result.ok, true)
  assert.deepEqual(
    receivedOrders,
    [cgOrder],
    "Conservative policy must receive its own active orders and exclude RS-owned orders",
  )
})

test("evaluates RS-owned symbols through the shared transition when CG has no route", async () => {
  const dependencies = createDependencies()
  dependencies.recoverySellerPairs = {
    RSUSDT: {
      enabled: true,
    },
  }
  let recoverySellerCalls = 0
  dependencies.evaluateRecoverySellerTransition = async ({ symbol }) => {
    recoverySellerCalls += 1
    return {
      ok: true,
      data: {
        symbol,
        submitted: true,
      },
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol: "RSUSDT" })

  assert.equal(recoverySellerCalls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.data?.submitted, true)
})

test("does not dispatch RS for a market without an RS execution route", async () => {
  const dependencies = createDependencies()
  dependencies.recoverySellerPairs = {
    OTHERUSDT: {
      enabled: true,
    },
  }
  let recoverySellerCalls = 0
  dependencies.evaluateRecoverySellerTransition = async () => {
    recoverySellerCalls += 1
    return { ok: true, data: {} }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  await evaluate({ symbol: "RSUSDT" })

  assert.equal(recoverySellerCalls, 0,
    "The shared engine must dispatch RS only for markets explicitly owned by RS.")
})

test("logs RS evaluation start and decisions with the RS strategy identity", async () => {
  const dependencies = createDependencies()
  dependencies.recoverySellerPairs = { RSUSDT: { enabled: true } }
  const records = []
  dependencies.recoverySellerLogger = createStrategyLogger({
    logger: {
      debug: (record) => records.push(record),
    },
    strategyId: StrategyId.RECOVERY_SELLER,
  })
  dependencies.evaluateRecoverySellerTransition = async () => ({
    ok: true,
    data: {
      decision: {
        outcome: "WAIT",
        reasonCode: "TEST_WAIT",
        explanation: "No eligible RS action.",
      },
    },
  })
  const evaluate = createLatestTransitionEvaluator(dependencies)

  await evaluate({ symbol: "RSUSDT" })

  assert.deepEqual(records.map(({ message, strategyId, symbol }) => ({
    message,
    strategyId,
    symbol,
  })), [
    {
      message: "Harvester Recovery Seller evaluation started",
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "RSUSDT",
    },
    {
      message: "Harvester Recovery Seller evaluation completed",
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "RSUSDT",
    },
  ], "RS decision logs must be identifiable by the RS marker and exact market.")
})

test("does not evaluate RS while the shared engine performs a preflight", async () => {
  const dependencies = createDependencies()
  let recoverySellerCalls = 0
  dependencies.evaluateRecoverySellerTransition = async () => {
    recoverySellerCalls += 1
    return {
      ok: true,
      data: {},
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  await evaluate({
    symbol: "DOGEUSDT",
    preflightOnly: true,
  })

  assert.equal(recoverySellerCalls, 0)
})

test("keeps a durable safety pause fail-closed during shutdown recovery", async () => {
  const evaluate = createLatestTransitionEvaluator(createDependencies({
    hardPause: true,
  }))
  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data?.skipped, true)
  assert.equal(result.data?.reason, "PAIR_PAUSED")
})


test("passes the complete account-scoped RS runtime dependencies to its production evaluator", async () => {
  const dependencies = createDependencies()
  const expected = {
    submitRecoverySellerOrder: async () => ({ ok: true }),
    recoverySellerWorkflow: { applyBuyFill: async () => ({ ok: true }) },
    recoverySellerStopWorkflow: { isStopped: () => false },
    recoverySellerPairs: { RSUSDT: { enabled: true } },
    getRecoverySellerMarketMetadata: () => ({
      market: {
        id: "RSUSDT",
      },
    }),
    getAccountSnapshot: () => ({
      ok: true,
      data: {},
    }),
    getAdditionalTrackedBaseQuantity: () => "0",
    getAdditionalTrackedQuoteCashFlow: () => "0",
    pause: async () => ({ ok: true }),
    eventPublisher: {
      publish: () => ({
        ok: true,
      }),
    },
  }
  Object.assign(dependencies, expected)
  let received
  dependencies.evaluateRecoverySellerTransition = async (input) => {
    received = input
    return {
      ok: true,
      data: { skipped: true },
    }
  }

  const evaluate = createLatestTransitionEvaluator(dependencies)
  const result = await evaluate({ symbol: "RSUSDT" })

  assert.equal(result.ok, true)
  assert.equal(received.state, dependencies.state)
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(received[key], value, `The production RS evaluator must receive the shared ${key} dependency.`)
  }
})


test("refreshes recovery filters before Conservative strategy evaluation", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const calls = []
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.delete(symbol)
  dependencies.state.recoveryManagedPausedMarkets.delete(symbol)
  dependencies.isStopping = () => false
  dependencies.canTrade = () => true
  dependencies.refreshRecoverySellMarketMetadata = async ({ symbol: refreshedSymbol }) => {
    calls.push(`refresh:${refreshedSymbol}`)
    return { ok: true }
  }
  dependencies.strategyPolicy.evaluate = () => {
    calls.push("evaluate")
    return {
      actions: [],
      reason: "NO_ACTION",
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol })

  assert.equal(result.ok, true, "A successful recovery filter refresh must allow Conservative evaluation.")
  assert.deepEqual(calls, [`refresh:${symbol}`, "evaluate"], "Recovery filters must refresh before the strategy policy is evaluated.")
})


test("stops Conservative evaluation when recovery filter refresh fails", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const refreshError = new Error("exchange filters unavailable")
  let strategyEvaluated = false
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.delete(symbol)
  dependencies.state.recoveryManagedPausedMarkets.delete(symbol)
  dependencies.isStopping = () => false
  dependencies.canTrade = () => true
  dependencies.refreshRecoverySellMarketMetadata = async () => ({
    ok: false,
    errors: [refreshError],
  })
  dependencies.strategyPolicy.evaluate = () => {
    strategyEvaluated = true
    return {
      actions: [],
      reason: "NO_ACTION",
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol })

  assert.equal(result.ok, false, "A failed recovery filter refresh must fail the evaluation.")
  assert.equal(result.errors[0], refreshError, "The evaluator must preserve the original refresh failure.")
  assert.equal(strategyEvaluated, false, "The strategy policy must not run after a failed filter refresh.")
})


function createDustCompletionFailureMarketMetadata({ symbol } = {}) {
  return {
    market: {
      id: symbol,
      baseAsset: { id: "asset:DOGE" },
      quoteAsset: { id: "asset:USDT" },
    },
    tradingRules: {
      constraints: [
        {
          type: "MIN_QUANTITY",
          status: "SUPPORTED",
          value: {
            amount: "1",
            asset: {
              code: "DOGE",
            },
          },
        },
        {
          type: "QUANTITY_INCREMENT",
          status: "SUPPORTED",
          value: {
            amount: "1",
            asset: {
              code: "DOGE",
            },
          },
        },
        {
          type: "MIN_NOTIONAL",
          status: "SUPPORTED",
          value: {
            amount: "5",
            asset: {
              code: "USDT",
            },
          },
        },
      ],
    },
    metadataCapturedAt: 1234,
    metadataVersion: null,
  }
}

function configureDustCompletionFailureMarket({ dependencies, symbol, publishedEvents } = {}) {
  dependencies.state.completedRecoverySellSymbols = new Set([symbol])
  dependencies.state.completedRecoverySellOrdersBySymbol = new Map([
    [symbol, {
      clientOrderId: "completed-sell",
      brokerOrderId: "completed-broker-sell",
    }],
  ])
  dependencies.state.trailingBuy = new Map()
  dependencies.pairs[symbol] = {
    enabled: true,
    orderQuantity: 400,
    investment: 100,
    keepQuantity: 1,
    priceStepPercent: 0.05,
    makerPercent: 0.1,
    takerPercent: 0.1,
    minProfit: 0.01,
  }
  dependencies.getCurrentMarketMetadata = () => createDustCompletionFailureMarketMetadata({ symbol })
  dependencies.eventPublisher = {
    publish: (event) => {
      publishedEvents.push(event)
      return { ok: true }
    },
    flushWrites: async () => {
      dependencies.state.recoveryDecisionFlushCount = (dependencies.state.recoveryDecisionFlushCount ?? 0) + 1
      return {
        ok: true,
        durable: true,
      }
    },
  }
}

function configureDustCompletionFailureCallbacks({
  dependencies,
  failure,
  pauses,
  publishedEvents,
} = {}) {
  dependencies.pause = async (input) => {
    pauses.push(input)
  }
  dependencies.state.recoveryCompletionCalls = 0
  dependencies.completeRecoveryCycle = async () => {
    assert.equal(dependencies.state.recoveryDecisionFlushCount, 1, "The recovery decision must be durably flushed before completion is attempted.")
    assert.equal(publishedEvents.length, 1, "The recovery decision must be published before completion is attempted.")
    dependencies.state.recoveryCompletionCalls += 1
    return {
      ok: false,
      errors: [failure],
    }
  }
  dependencies.strategyPolicy.evaluate = () => ({
    strategy: "CONSERVATIVE",
    actions: [],
    reason: "RESIDUAL_DUST",
    inventoryDisposition: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      reason: "MIN_NOTIONAL",
      quantity: "1.8",
      minimumQuantity: "1",
      minimumNotional: "5",
      quantityStepSize: "1",
      evaluatedQuantity: "1",
      evaluatedNotional: "0.05719",
      evaluatedPrice: "0.05719",
    },
  })
}

function configureDustCompletionFailureEvidence({
  dependencies,
  symbol,
  failure,
  pauses,
  publishedEvents,
} = {}) {
  configureDustCompletionFailureMarket({
    dependencies,
    symbol,
    publishedEvents,
  })
  configureDustCompletionFailureCallbacks({
    dependencies,
    failure,
    pauses,
    publishedEvents,
  })
}


test("forwards the original dust-completion failure and publishes exact filter evidence before pausing", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const failure = new Error("recovery completion fact append failed")
  failure.code = "RECOVERY_COMPLETION_WRITE_FAILED"
  const pauses = []
  const publishedEvents = []
  configureDustCompletionFailureEvidence({
    dependencies,
    symbol,
    failure,
    pauses,
    publishedEvents,
  })
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({
    symbol,
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, false, "A failed durable completion must remain fail-closed.")
  assert.equal(result.errors[0], failure, "The evaluator must preserve the original completion failure identity.")
  assert.equal(pauses.length, 1, "The completion failure must produce exactly one market pause.")
  assert.equal(pauses[0].reason, "RECOVERY_CYCLE_COMPLETION_FAILED", "The existing stable pause reason must remain compatible.")
  assert.equal(pauses[0].error, failure, "The original failure must reach the durable pause callback, not only a generic reason.")
  const decisionEvent = publishedEvents.find((event) => event.name === HARVESTER_EVENT_NAMES.STRATEGY_DECISION)
  assert.ok(decisionEvent, "The no-action recovery disposition must be durably published.")
  assert.equal(decisionEvent.data.actions.length, 0)
  assert.equal(decisionEvent.data.recoveryEvidence.residualQuantity, "1.8")
  assert.equal(decisionEvent.data.recoveryEvidence.candidateQuantity, "1")
  assert.equal(decisionEvent.data.recoveryEvidence.sellableQuantity, "0")
  assert.equal(decisionEvent.data.recoveryEvidence.residualNotional, "0.102942")
  assert.equal(decisionEvent.data.recoveryEvidence.filterSnapshot.capturedAt, 1234)
  assert.equal(decisionEvent.data.recoveryEvidence.filterSnapshot.version, null)
  assert.equal(decisionEvent.data.recoveryEvidence.filterSnapshot.constraints[2].value, "5")
})


function configureResidualSellThroughState({ dependencies, symbol, price } = {}) {
  const { state } = dependencies
  state.paused.add(symbol)
  state.recoveryManagedPausedMarkets.add(symbol)
  state.completedRecoverySellSymbols = new Set([symbol])
  state.completedRecoverySellOrdersBySymbol = new Map()
  state.trailingBuy = new Map()
  state.recoveryManagedCancellationClientOrderIds = new Set()
  state.prices.set(symbol, {
    symbol,
    price,
    timestamp: 100,
  })
  state.lastBuyPrices.set(symbol, price)
  state.residualSellThroughActiveOrders = []
  state.registry.getActiveOrders = () => state.residualSellThroughActiveOrders
  state.registry.getOwnership = () => ({ strategyId: "CG_coinGrabber" })
}

function configureResidualSellThroughPortfolio({
  dependencies,
  symbol,
  activeQuantity,
  baseAssetId,
  quoteAssetId,
} = {}) {
  dependencies.getCurrentMarketMetadata = () => ({
    market: {
      id: symbol,
      baseAsset: { id: baseAssetId },
      quoteAsset: { id: quoteAssetId },
    },
  })
  const position = {
    baseQuantity: { amount: activeQuantity },
    spent: { amount: "1" },
  }
  dependencies.getPortfolio = () => ({
    value: {},
    positions: [],
    getPosition: () => position,
  })
  dependencies.getRecoveryLedger = () => ({
    value: {},
    netSellProceeds: "1.01",
    outstandingRecoveryAmount: "0",
  })
  dependencies.getAccountSnapshot = () => ({
    getFreeBalance: () => ({
      amount: "100",
    }),
    getPortfolioBaseQuantityBaseline: () => "0",
    getCommittedQuoteBalanceBaseline: () => "0",
    getCommittedBaseBalanceBaseline: () => "0",
  })
}

function configureResidualSellThroughDecision({
  dependencies,
  symbol,
  activeQuantity,
  sellQuantity,
  price,
  keepQuantity,
} = {}) {
  dependencies.pairs[symbol] = {
    enabled: true,
    investment: 100,
    orderQuantity: activeQuantity,
    keepQuantity,
    priceStepPercent: 0.05,
    makerPercent: 0.1,
    takerPercent: 0.1,
    minProfit: 0.01,
  }
  dependencies.strategyPolicy.evaluate = ({ activeOrders = [] } = {}) => {
    const hasActiveRecoverySell = activeOrders.some((order) =>
      order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
    if (hasActiveRecoverySell) {
      return {
        actions: [],
        reason: "RECOVERY_SELL_ALREADY_ACTIVE",
        inventoryDisposition: {
          status: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
          quantity: activeQuantity,
        },
      }
    }
    return {
      strategy: "CONSERVATIVE",
      action: "PLACE_ORDERS",
      reason: "CONTINUE_SELL_THROUGH",
      actions: [{
        side: "SELL",
        type: "LIMIT_MAKER",
        price,
        quantity: sellQuantity,
        reason: "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY",
      }],
      inventoryDisposition: {
        status: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
        quantity: activeQuantity,
      },
    }
  }
}

function configureResidualSellThroughSubmission({
  dependencies,
  submissions,
  pauses,
  completionCalls,
  symbol,
  submitResult,
} = {}) {
  dependencies.allocateOrderCommitments = ({ actions }) => ({
    ok: true,
    data: {
      executableActions: actions,
      deferredActions: [],
    },
  })
  dependencies.submit = async ({ decision }) => {
    submissions.push(decision.actions)
    if (submitResult !== undefined) {
      return submitResult
    }
    dependencies.state.residualSellThroughActiveOrders.push({
      clientOrderId: "residual-sell-client",
      brokerOrderId: "residual-sell-broker",
      market: { id: symbol },
      side: "SELL",
      status: "OPEN",
    })
    return {
      ok: true,
      data: {
        submittedOrders: decision.actions.map(({ side, quantity }) => ({
          side,
          quantity,
        })),
      },
    }
  }
  dependencies.setShutdownRecoverySubmissionAllowed = () => {}
  dependencies.completeRecoveryCycle = async () => {
    completionCalls.count += 1
    return {
      ok: true,
      data: { eligible: true },
    }
  }
  dependencies.pause = async (input) => {
    pauses.push(input)
  }
}

function configureResidualSellThroughDependencies(input = {}) {
  const {
    dependencies,
    symbol,
    activeQuantity,
    sellQuantity,
    price,
    keepQuantity,
    baseAssetId,
    quoteAssetId,
    submitResult,
  } = input
  const submissions = []
  const pauses = []
  const completionCalls = { count: 0 }
  configureResidualSellThroughState({
    dependencies,
    symbol,
    price,
  })
  configureResidualSellThroughPortfolio({
    dependencies,
    symbol,
    activeQuantity,
    baseAssetId,
    quoteAssetId,
  })
  configureResidualSellThroughDecision({
    dependencies,
    symbol,
    activeQuantity,
    sellQuantity,
    price,
    keepQuantity,
  })
  configureResidualSellThroughSubmission({
    dependencies,
    submissions,
    pauses,
    completionCalls,
    symbol,
    submitResult,
  })
  return {
    submissions,
    pauses,
    completionCalls,
  }
}

test("submits the residual SELL on reevaluation after the recovery SELL fill without completing or pausing the cycle", async () => {
  const scenarios = [
    {
      symbol: "DOGEUSDT",
      activeQuantity: "2.8",
      sellQuantity: "1.7",
      keepQuantity: 1,
      price: "0.05719",
      baseAssetId: "asset:DOGE",
      quoteAssetId: "asset:USDT",
    },
    {
      symbol: "ZROUSDT",
      activeQuantity: "0.015",
      sellQuantity: "0.004",
      keepQuantity: 0.01,
      price: "1.092",
      baseAssetId: "asset:ZRO",
      quoteAssetId: "asset:USDT",
    },
  ]
  for (const scenario of scenarios) {
    const dependencies = createDependencies()
    const tracked = configureResidualSellThroughDependencies({
      dependencies,
      ...scenario,
    })
    const evaluate = createLatestTransitionEvaluator(dependencies)
    const result = await evaluate({
      symbol: scenario.symbol,
      shutdownRecoveryOnly: true,
    })

    assert.equal(result.ok, true, `${scenario.symbol} sell-through reevaluation must remain successful.`)
    assert.equal(tracked.submissions.length, 1, `${scenario.symbol} must submit exactly one residual SELL.`)
    assert.deepEqual(
      tracked.submissions[0].map(({ side, quantity }) => ({
        side,
        quantity,
      })),
      [{
        side: "SELL",
        quantity: scenario.sellQuantity,
      }],
      `${scenario.symbol} must submit only the exact sellable excess above keepQuantity.`,
    )
    assert.equal(result.data.submittedOrders[0].quantity, scenario.sellQuantity)
    assert.equal(tracked.completionCalls.count, 0, `${scenario.symbol} must not complete while sell-through is unresolved.`)
    assert.equal(tracked.pauses.length, 0, `${scenario.symbol} must not pause after a successful sell-through continuation.`)
    assert.equal(dependencies.state.completedRecoverySellSymbols.has(scenario.symbol), true)

    const reevaluated = await evaluate({
      symbol: scenario.symbol,
      shutdownRecoveryOnly: true,
    })
    assert.equal(reevaluated.ok, true, `${scenario.symbol} reevaluation with an active residual SELL must remain successful.`)
    assert.equal(tracked.submissions.length, 1, `${scenario.symbol} must not submit a duplicate residual SELL while the first is active.`)
    assert.equal(tracked.completionCalls.count, 0, `${scenario.symbol} must not complete before the residual SELL is filled and reconciled.`)
    assert.equal(tracked.pauses.length, 0, `${scenario.symbol} must not pause merely because its residual SELL is already active.`)
  }
})




function createResidualSellOutcomeScenarios() {
  return [
    {
      status: "UNKNOWN",
      submitResult: {
        ok: false,
        errors: [Object.assign(
          new Error("broker outcome unknown"),
          { code: "UNKNOWN_SUBMISSION_OUTCOME" },
        )],
      },
    },
    {
      status: "REJECTED",
      submitResult: {
        ok: false,
        errors: [Object.assign(
          new Error("broker rejected residual SELL"),
          { code: "BROKER_REJECTED" },
        )],
      },
    },
    {
      status: "BLOCKED",
      submitResult: {
        ok: true,
        data: {
          deferred: true,
          reason: "SUBMISSION_BLOCKED",
          submittedOrders: [],
        },
      },
    },
  ]
}

async function runResidualSellOutcomeScenario({ scenario } = {}) {
  const dependencies = createDependencies()
  const tracked = configureResidualSellThroughDependencies({
    dependencies,
    symbol: "DOGEUSDT",
    activeQuantity: "2.8",
    sellQuantity: "1.7",
    keepQuantity: 1,
    price: "0.05719",
    baseAssetId: "asset:DOGE",
    quoteAssetId: "asset:USDT",
    submitResult: scenario.submitResult,
  })
  const evaluate = createLatestTransitionEvaluator(dependencies)
  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })
  return {
    dependencies,
    tracked,
    result,
  }
}

function assertResidualSellOutcomeScenario({ scenario, dependencies, tracked, result } = {}) {
  assert.equal(tracked.submissions.length, 1, "Each broker outcome must preserve one residual SELL attempt.")
  assert.equal(tracked.submissions[0][0].side, "SELL")
  assert.equal(tracked.submissions[0][0].quantity, "1.7")
  assert.equal(tracked.completionCalls.count, 0, "An unresolved broker outcome must not complete recovery.")
  assert.equal(dependencies.state.completedRecoverySellSymbols.has("DOGEUSDT"), true)
  assert.equal(tracked.submissions[0].some((action) => action.side === "BUY"), false)
  if (scenario.status === "BLOCKED") {
    assert.equal(result.ok, true)
    assert.equal(result.data.deferred, true)
    assert.equal(result.data.reason, "SUBMISSION_BLOCKED")
    return
  }
  assert.equal(result.ok, false)
  assert.equal(result.errors[0], scenario.submitResult.errors[0])
}

test("fails closed before completion or residual SELL submission when recovery evidence cannot be durably flushed", async () => {
  const dependencies = createDependencies()
  const tracked = configureResidualSellThroughDependencies({
    dependencies,
    symbol: "DOGEUSDT",
    activeQuantity: "2.8",
    sellQuantity: "1.7",
    keepQuantity: 1,
    price: "0.05719",
    baseAssetId: "asset:DOGE",
    quoteAssetId: "asset:USDT",
  })
  const failure = new Error("Journal fsync failed before recovery decision evidence was durable")
  failure.code = "RECOVERY_DECISION_EVIDENCE_FLUSH_FAILED"
  const pauses = []
  dependencies.pause = async (input) => {
    pauses.push(input)
  }
  dependencies.eventPublisher = {
    publish: () => ({ ok: true }),
    flushWrites: async () => ({
      ok: false,
      errors: [failure],
    }),
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], failure)
  assert.equal(tracked.submissions.length, 0)
  assert.equal(tracked.completionCalls.count, 0)
  assert.equal(pauses.length, 1)
  assert.equal(pauses[0].reason, "RECOVERY_DECISION_EVIDENCE_PERSISTENCE_FAILED")
  assert.equal(pauses[0].error, failure)
})
test("fails closed before dust cycle completion when recovery decision evidence cannot be durably flushed", async () => {
  const dependencies = createDependencies()
  const failure = new Error("Journal flush failed before dust completion")
  failure.code = "RECOVERY_DECISION_EVIDENCE_FLUSH_FAILED"
  const pauses = []
  const publishedEvents = []
  configureDustCompletionFailureEvidence({
    dependencies,
    symbol: "DOGEUSDT",
    failure,
    pauses,
    publishedEvents,
  })
  dependencies.eventPublisher.flushWrites = async () => ({
    ok: false,
    errors: [failure],
  })
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], failure)
  assert.equal(dependencies.state.recoveryCompletionCalls, 0)
  assert.equal(pauses.length, 1)
  assert.equal(pauses[0].reason, "RECOVERY_DECISION_EVIDENCE_PERSISTENCE_FAILED")
  assert.equal(pauses[0].error, failure)
})
test("preserves unknown, rejected, and blocked residual SELL outcomes without completing recovery or placing a BUY", async () => {
  for (const scenario of createResidualSellOutcomeScenarios()) {
    const outcome = await runResidualSellOutcomeScenario({ scenario })
    assertResidualSellOutcomeScenario({
      scenario,
      ...outcome,
    })
  }
})
