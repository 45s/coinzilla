import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { OrderRegistry } from "../../src/domain/orders/order-registry.js"
import { createOrderOwnership } from "../../src/domain/orders/order-ownership.js"
import { StrategyId } from "../../src/domain/strategies/strategy-ids.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../../src/domain/strategies/recovery-seller/legacy-position.js"
import {
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
} from "../../src/domain/strategies/recovery-seller/stop-decision.js"
import { createRecoverySellerCycleState } from "../../src/domain/strategies/recovery-seller/cycle-state.js"
import { evaluateRecoverySellerSellDecision } from "../../src/domain/strategies/recovery-seller/evaluate-sell-decision.js"
import { createRecoverySellerAccountingWorkflow } from "../../src/use-cases/create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerTransitionEvaluator } from "../../src/use-cases/create-recovery-seller-transition-evaluator.js"

const symbol = "ZROUSDT"
const cycleId = "rs-zro-planner-cycle-001"
const positionId = "rs-zro-planner-position-001"
const buyClientOrderId = "rs-zro-planner-buy-001"
const buyBrokerOrderId = "binance-rs-zro-buy-001"

const baseAsset = new Asset({
  id: "binance:ZRO",
  code: "ZRO",
})
const quoteAsset = new Asset({
  id: "binance:USDT",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol,
  baseAsset,
  quoteAsset,
})

const pairConfig = Object.freeze({
  sellQuantity: "0.01",
  thirdAssetFeeQuoteValue: "0",
  minProfit: 0.01,
  makerPercent: 0,
  takerPercent: 0.075,
})

function createTradingRules({ quantityStepSize = "0.01", minimumNotional = "5" } = {}) {
  return new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.01",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: quantityStepSize,
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.001",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
          amount: minimumNotional,
          asset: quoteAsset,
        }),
      },
    ],
  })
}

function createMarketMetadata({ quantityStepSize, minimumNotional } = {}) {
  return Object.freeze({
    market,
    supportedOrderTypes: Object.freeze(["LIMIT_MAKER", "LIMIT"]),
    tradingRules: createTradingRules({
      quantityStepSize,
      minimumNotional,
    }),
  })
}

function createRecoveryBuyOrder() {
  return new CanonicalOrder({
    clientOrderId: buyClientOrderId,
    brokerOrderId: buyBrokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 3,
  })
}

function createRecoveryBuyFill() {
  return new Fill({
    tradeId: "rs-zro-planner-buy-fill-001",
    brokerOrderId: buyBrokerOrderId,
    clientOrderId: buyClientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createExternalSellReservation() {
  return new CanonicalOrder({
    clientOrderId: "external-zro-sell-reservation-001",
    brokerOrderId: "binance-external-zro-sell-001",
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "25",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "0.005",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset,
    }),
    status: "OPEN",
    createdAt: 4,
    acknowledgedAt: 5,
    updatedAt: 5,
  })
}

function createPlannerWorkflow({ includeExternalSellReservation = false, legacyInvested = "0.20" } = {}) {
  const buyOrder = createRecoveryBuyOrder()
  const ownership = createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId,
      purpose: "RECOVERY_BUY",
      cycleId,
    },
    clientOrderId: buyClientOrderId,
    brokerOrderId: buyBrokerOrderId,
  })
  const orders = [buyOrder]
  if (includeExternalSellReservation) {
    orders.push(createExternalSellReservation())
  }
  const workflow = createRecoverySellerAccountingWorkflow({
    initialPortfolio: new Portfolio(),
    initialOrderRegistry: new OrderRegistry({
      orders,
      ownerships: [ownership],
    }),
    initialLegacyPositions: [{
      market,
      position: Object.freeze({
        ...createLegacyPosition({
          invested: legacyInvested,
          quantity: "0.01",
        }),
        remainingQuantity: "0.01",
      }),
      accounting: createLegacyPositionAccounting(),
    }],
    onOperationalStateExecutionFill: async () => ({
      ok: true,
      data: {
        durable: true,
      },
    }),
  })
  return {
    workflow,
    buyOrder,
  }
}

function createAccountSnapshot({ spotTotalQuantity }) {
  return Object.freeze({
    balances: Object.freeze([
      new Balance({
        free: new Quantity({
          amount: spotTotalQuantity,
          asset: baseAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: baseAsset,
        }),
      }),
    ]),
  })
}

async function createPlannerScenario({
  spotTotalQuantity = "1.01",
  quantityStepSize = "0.01",
  minimumNotional = "5",
  includeExternalSellReservation = false,
  legacyInvested = "0.20",
} = {}) {
  const { workflow, buyOrder } = createPlannerWorkflow({
    includeExternalSellReservation,
    legacyInvested,
  })
  const buyResult = await workflow.applyBuyFill({
    order: buyOrder,
    fill: createRecoveryBuyFill(),
  })
  assert.equal(buyResult.ok, true,
    "The scenario must seed the Recovery Position through one confirmed canonical BUY Fill before evaluating SELL planning.")
  const marketMetadata = createMarketMetadata({
    quantityStepSize,
    minimumNotional,
  })
  const stopState = createRecoverySellerStopState()
  const snapshot = workflow.getTransitionSnapshot({
    marketMetadata,
    pairConfig,
    accountSnapshot: createAccountSnapshot({ spotTotalQuantity }),
    stopState,
    strategyStopped: false,
    buyAdmissionBlocked: false,
    sellAdmissionBlocked: false,
    marketPaused: false,
    reconciliationComplete: true,
  })
  return Object.freeze({
    workflow,
    snapshot,
    cycleState: createRecoverySellerCycleState({
      cycleId: snapshot.cycleState.cycleId,
      positionId: snapshot.cycleState.positionId,
    }),
    marketMetadata,
    stopState,
  })
}

function assertSpecificationZroSellPlan({ snapshot, cycleState, marketMetadata, stopState }) {
  assert.equal(snapshot.recoveryPosition.quantity, "1",
    "The Recovery Position quantity must come from the confirmed canonical BUY Fill, not a caller-selected SELL split.")
  assert.equal(snapshot.recoveryPosition.spent, "10",
    "The recovery cost basis must come from the actual quote quantity of the canonical BUY Fill.")
  assert.equal(snapshot.planInput.legacyRemainingQuantity, "0.01",
    "The legacy remainder must come from the operator-authorized legacy Position.")
  assert.equal(snapshot.planInput.verifiedUnreservedLegacyQuantity, "0.01",
    "Only the additional ZRO quantity verified by the Spot snapshot beyond Portfolio custody may support the legacy slice.")
  assert.equal(snapshot.planInput.legacyAverageCost, "20",
    "Legacy average cost must remain the fixed historical basis of 0.20 USDT divided by 0.01 ZRO.")
  const result = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata,
    cycleState,
    stopState,
    planInput: snapshot.planInput,
  })
  assert.equal(result.decision.outcome, "SUBMIT",
    `A fully verified mixed SELL must produce one eligible intent. Actual policy result: ${result.decision.reasonCode} — ${result.decision.explanation}`)
  assert.equal(result.orderIntent.quantity, "1.01",
    "The planner must derive 1.01 ZRO as 1.00 recovery plus the additive 0.01 authorized legacy slice.")
  assert.equal(result.orderIntent.plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "Recovery proceeds must independently satisfy its 10.00 USDT basis plus 0.01 USDT minimum profit.")
  assert.equal(result.orderIntent.plan.legacyRequiredNetQuoteProceeds, "20.2",
    "Legacy proceeds must independently recover its 0.20 USDT historical basis.")
  assert.equal(result.orderIntent.plan.combinedRequiredNetQuoteProceeds, "10.21",
    "Combined proceeds must independently recover both bases plus the 0.01 USDT minimum profit.")
  assert.equal(result.orderIntent.plan.requiredNetQuoteProceeds, "20.2",
    "The planner must choose the maximum independent target, not the weaker combined-only 10.21 USDT target.")
  assert.equal(result.orderIntent.plan.price, "20",
    "The unrounded 20.00 USDT/ZRO oracle must be represented at the supplied 0.01 TradingRules price increment.")
}

function createTransitionEvaluator({ snapshot, onSubmit }) {
  const evaluatorSnapshot = Object.freeze({
    ...snapshot,
    cycleState: createRecoverySellerCycleState({
      cycleId: snapshot.cycleState.cycleId,
      positionId: snapshot.cycleState.positionId,
    }),
  })
  return createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => evaluatorSnapshot,
    submitOrder: async (input) => {
      onSubmit(input)
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
    evaluateBuyDecision: () => ({
      decision: {
        outcome: "WAIT",
        reasonCode: "SCENARIO_BUY_WAIT",
        explanation: "The SELL planner scenario does not evaluate a BUY action.",
      },
    }),
  })
}


async function evaluateTransitionAtPrice({ scenario, price }) {
  let submitted
  const evaluate = createTransitionEvaluator({
    snapshot: scenario.snapshot,
    onSubmit: (input) => {
      submitted = input
    },
  })
  const result = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price,
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })
  return {
    result,
    submitted,
  }
}

async function assertPriceBoundary({ scenario, belowPrice, targetPrice, abovePrice }) {
  const below = await evaluateTransitionAtPrice({
    scenario,
    price: belowPrice,
  })
  assert.equal(below.result.decision.outcome, "WAIT",
    `Market price ${belowPrice} below planned target ${targetPrice} must not submit a SELL.`)
  assert.equal(below.submitted, undefined,
    "A below-target market price must produce zero broker submission attempts.")

  const atTarget = await evaluateTransitionAtPrice({
    scenario,
    price: targetPrice,
  })
  assert.equal(atTarget.result.ok, true,
    "The application transition must submit when market price exactly reaches the planned profitability target.")
  assert.equal(atTarget.submitted.action.side, "SELL",
    "The exact-threshold transition must submit the planned SELL action.")
  assert.equal(atTarget.submitted.action.plan.price, targetPrice,
    "The submitted action must retain the exact independently calculated profitability target.")

  const aboveTarget = await evaluateTransitionAtPrice({
    scenario,
    price: abovePrice,
  })
  assert.equal(aboveTarget.result.ok, true,
    "The application transition must submit when market price is one tick above the planned profitability target.")
  assert.equal(aboveTarget.submitted.action.price, abovePrice,
    "The submitted action must use the tick-aligned market price at the above-target boundary.")
}

test("the SELL planner derives the specification ZRO quantity from canonical workflow inventory and verified Spot custody using the canonical lifecycle-state contract", async () => {
  const scenario = await createPlannerScenario()
  assertSpecificationZroSellPlan(scenario)

  let submissions = 0
  const evaluate = createTransitionEvaluator({
    snapshot: scenario.snapshot,
    onSubmit: () => {
      submissions += 1
    },
  })
  const belowTarget = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "19.99",
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })

  assert.equal(belowTarget.decision.outcome, "WAIT",
    "A market price below the independently derived SELL target must not submit the SELL and may continue through the separate BUY policy.")
  assert.equal(submissions, 0,
    "The application transition must make zero broker submissions while the market remains below the planned profitable SELL price.")
})


test("the pre-submit transition enforces the recovery-dominant profitability boundary", async () => {
  const scenario = await createPlannerScenario({
    legacyInvested: "0.0001",
  })
  const {
    orderIntent: { plan },
  } = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata: scenario.marketMetadata,
    cycleState: scenario.cycleState,
    stopState: scenario.stopState,
    planInput: scenario.snapshot.planInput,
  })

  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "The recovery allocation must set the strictest required proceeds when legacy basis is low.")
  assert.equal(plan.requiredNetQuoteProceeds, "10.1101",
    "The recovery allocation must control the planned minimum proceeds.")
  await assertPriceBoundary({
    scenario,
    belowPrice: "10.00",
    targetPrice: "10.01",
    abovePrice: "10.02",
  })
})

test("the pre-submit transition enforces the legacy-dominant profitability boundary", async () => {
  const scenario = await createPlannerScenario({
    legacyInvested: "0.20",
  })
  const {
    orderIntent: { plan },
  } = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata: scenario.marketMetadata,
    cycleState: scenario.cycleState,
    stopState: scenario.stopState,
    planInput: scenario.snapshot.planInput,
  })

  assert.equal(plan.legacyRequiredNetQuoteProceeds, "20.2",
    "The fixed historical legacy basis must set the strictest required proceeds when its average cost is high.")
  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "The legacy allocation must control the planned minimum proceeds.")
  await assertPriceBoundary({
    scenario,
    belowPrice: "19.99",
    targetPrice: "20",
    abovePrice: "20.01",
  })
})

test("the pre-submit transition accepts exact equality when recovery, legacy and combined targets coincide", async () => {
  const scenario = await createPlannerScenario({
    legacyInvested: "0.1001",
  })
  const {
    orderIntent: { plan },
  } = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata: scenario.marketMetadata,
    cycleState: scenario.cycleState,
    stopState: scenario.stopState,
    planInput: scenario.snapshot.planInput,
  })

  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "Recovery profitability threshold must match the common equality target.")
  assert.equal(plan.legacyRequiredNetQuoteProceeds, "10.1101",
    "Legacy non-loss threshold must match the common equality target.")
  assert.equal(plan.combinedRequiredNetQuoteProceeds, "10.1101",
    "Combined profitability threshold must match the common equality target.")
  assert.equal(plan.requiredNetQuoteProceeds, "10.1101",
    "Exact equality across all three gates must remain eligible.")
  await assertPriceBoundary({
    scenario,
    belowPrice: "10.00",
    targetPrice: "10.01",
    abovePrice: "10.02",
  })
})

test("a smaller verified Spot remainder is the only legacy quantity added to the recovery SELL", async () => {
  const scenario = await createPlannerScenario({
    spotTotalQuantity: "1.005",
    quantityStepSize: "0.001",
  })
  const result = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata: scenario.marketMetadata,
    cycleState: scenario.cycleState,
    stopState: scenario.stopState,
    planInput: scenario.snapshot.planInput,
  })

  assert.equal(scenario.snapshot.planInput.verifiedUnreservedLegacyQuantity, "0.005",
    "Verified legacy Spot availability must exclude the one ZRO already represented by the Recovery Portfolio.")
  assert.equal(result.decision.outcome, "SUBMIT",
    `A smaller verified legacy remainder may be planned when authorized and exchange-step representable. Actual policy result: ${result.decision.reasonCode} — ${result.decision.explanation}`)
  assert.equal(result.orderIntent.plan.legacyQuantity, "0.005",
    "The additive legacy slice must be capped at the smaller verified unreserved Spot quantity.")
  assert.equal(result.orderIntent.quantity, "1.005",
    "The planned SELL must contain one ZRO recovery plus only 0.005 ZRO verified legacy inventory.")
})

test("missing verified Spot custody blocks the SELL intent and produces no broker submission", async () => {
  const scenario = await createPlannerScenario({
    spotTotalQuantity: "1",
  })
  const result = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata: scenario.marketMetadata,
    cycleState: scenario.cycleState,
    stopState: scenario.stopState,
    planInput: scenario.snapshot.planInput,
  })

  assert.equal(scenario.snapshot.planInput.verifiedUnreservedLegacyQuantity, "0",
    "A Spot snapshot containing only the one ZRO already tracked by Recovery must prove zero additional legacy custody.")
  assert.equal(result.decision.outcome, "BLOCK",
    "Remaining authorized legacy inventory without verified unreserved Spot quantity must fail closed.")
  assert.equal(result.orderIntent, undefined,
    "A failed legacy-custody gate must not return a SELL order intent.")

  let submissions = 0
  const evaluate = createTransitionEvaluator({
    snapshot: scenario.snapshot,
    onSubmit: () => {
      submissions += 1
    },
  })
  const blocked = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "25",
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })

  assert.equal(blocked.decision.outcome, "BLOCK",
    "The application transition must preserve the planner's fail-closed custody decision.")
  assert.equal(submissions, 0,
    "The application transition must not call the broker submitter when verified legacy custody is unavailable.")
})

test("an existing account SELL reservation blocks a second Recovery SELL evaluation", async () => {
  const scenario = await createPlannerScenario({
    includeExternalSellReservation: true,
  })

  assert.equal(scenario.snapshot.activeOrders.length, 1,
    "The canonical account OrderRegistry must expose the existing external SELL reservation to the Recovery transition.")
  assert.equal(scenario.snapshot.activeOrders[0].side, "SELL",
    "The blocking account reservation must be an actual open SELL order rather than a fabricated quantity input.")

  let submissions = 0
  const evaluate = createTransitionEvaluator({
    snapshot: scenario.snapshot,
    onSubmit: () => {
      submissions += 1
    },
  })
  const result = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "25",
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })

  assert.equal(result.decision.outcome, "WAIT",
    "An existing account SELL order must take precedence over new RS SELL planning until the shared order state is reconciled.")
  assert.equal(submissions, 0,
    "The Recovery transition must not submit a second SELL while an account SELL reservation remains active.")
})

test("actual TradingRules minimum-notional violations block the derived SELL without adjustment or submission", async () => {
  const scenario = await createPlannerScenario({
    minimumNotional: "20.21",
  })
  const result = evaluateRecoverySellerSellDecision({
    pairConfig,
    marketMetadata: scenario.marketMetadata,
    cycleState: scenario.cycleState,
    stopState: scenario.stopState,
    planInput: scenario.snapshot.planInput,
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "The actual TradingRules minimum notional of 20.21 USDT must reject the derived 20.20 USDT order notional.")
  assert.equal(result.stopState.status, "STOPPED",
    "A SELL that violates a supported exchange filter must latch the returned global STOP state.")
  assert.equal(result.orderIntent, undefined,
    "A filter-invalid SELL must never expose an executable order intent.")

  let submissions = 0
  const evaluate = createTransitionEvaluator({
    snapshot: scenario.snapshot,
    onSubmit: () => {
      submissions += 1
    },
  })
  const blocked = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "25",
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })

  assert.equal(blocked.decision.outcome, "BLOCK",
    "The application transition must preserve the exchange-filter STOP decision.")
  assert.equal(submissions, 0,
    "No broker submission may occur when the actual TradingRules reject the planned order.")
})

test("the real accounting workflow snapshot reaches the default SELL evaluator and submits the eligible mixed SELL", async () => {
  const scenario = await createPlannerScenario()
  let submitted
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => scenario.snapshot,
    submitOrder: async (input) => {
      submitted = input
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
    evaluateBuyDecision: () => ({
      decision: {
        outcome: "WAIT",
        reasonCode: "SCENARIO_BUY_WAIT",
        explanation: "The workflow-to-SELL regression must not fall through to a new BUY.",
      },
    }),
  })

  const result = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "20",
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })

  assert.equal(result.decision?.outcome, undefined,
    `The real workflow cycle state must pass the default SELL evaluator instead of fail-closing: ${result.decision?.reasonCode ?? result.errors?.[0]?.message ?? "no decision"}.`)
  assert.equal(result.ok, true,
    "The composed transition must return the successful submitter result for an eligible recovery SELL.")
  assert.equal(submitted.action.side, "SELL",
    "The real workflow snapshot must reach the default SELL evaluator and submit SELL, not BUY.")
  assert.equal(submitted.action.quantity, "1.01",
    "The submitted mixed SELL must use the canonical 1.00 recovery plus 0.01 verified legacy allocation.")
  assert.equal(submitted.action.cycleId, scenario.snapshot.cycleState.cycleId,
    "The workflow cycle identity must be preserved through the evaluator and submitted SELL.")
  assert.equal(submitted.action.positionId, scenario.snapshot.cycleState.positionId,
    "The workflow Position identity must be preserved through the evaluator and submitted SELL.")
})

test("the real accounting workflow snapshot still fails closed when verified legacy Spot custody is missing", async () => {
  const scenario = await createPlannerScenario({
    spotTotalQuantity: "1",
  })
  let submissions = 0
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => scenario.snapshot,
    submitOrder: async () => {
      submissions += 1
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
    evaluateBuyDecision: () => ({
      decision: {
        outcome: "WAIT",
        reasonCode: "SCENARIO_BUY_WAIT",
        explanation: "The missing-custody scenario must not fall through to a new BUY.",
      },
    }),
  })

  const result = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "25",
    },
    marketMetadata: scenario.marketMetadata,
    pairConfig,
  })

  assert.equal(result.decision?.outcome, "BLOCK",
    "The composed workflow must preserve the fail-closed legacy-custody decision.")
  assert.match(result.decision.explanation, /no verified unreserved Spot quantity is available/,
    "The default SELL evaluator must reach the legacy-custody guard, not stop earlier on a malformed cycle-state projection.")
  assert.equal(submissions, 0,
    "Missing verified legacy Spot custody must result in zero broker submission attempts.")
})

function createWorkflowGateScenarios({ baseScenario, existingOrderScenario }) {
  return [
    {
      name: "existing account order",
      snapshot: existingOrderScenario.snapshot,
    },
    {
      name: "market pause",
      snapshot: Object.freeze({
        ...baseScenario.snapshot,
        marketPaused: true,
      }),
    },
    {
      name: "incomplete reconciliation",
      snapshot: Object.freeze({
        ...baseScenario.snapshot,
        reconciliationComplete: false,
      }),
    },
  ]
}

function createWorkflowStopSnapshot({ baseScenario }) {
  const stoppedState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: createRecoverySellerStopDecision({
      explanation: "STOP blocks additional BUY spending only.",
    }),
  })
  return Object.freeze({
    ...baseScenario.snapshot,
    stopState: stoppedState,
    strategyStopped: false,
    buyAdmissionBlocked: true,
    sellAdmissionBlocked: false,
  })
}

async function assertWorkflowGateBlocksSell({ name, snapshot, marketMetadata }) {
  let submissions = 0
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => snapshot,
    submitOrder: async () => {
      submissions += 1
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
    evaluateBuyDecision: () => ({
      decision: {
        outcome: "WAIT",
        reasonCode: "SCENARIO_BUY_WAIT",
        explanation: "The gate scenario must not submit a new BUY.",
      },
    }),
  })
  const result = await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "25",
    },
    marketMetadata,
    pairConfig,
  })

  assert.equal(submissions, 0,
    `The real workflow snapshot must not submit a SELL while ${name} is active.`)
  assert.equal(result.decision.outcome, "WAIT",
    `The ${name} gate must take precedence over a profitable SELL plan.`)
}

async function assertWorkflowStopAllowsSell({ snapshot, marketMetadata }) {
  let submissions = 0
  let submittedSide
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => snapshot,
    submitOrder: async ({ action }) => {
      submissions += 1
      submittedSide = action.side
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
    evaluateBuyDecision: () => ({
      decision: {
        outcome: "BLOCK",
        reasonCode: "SCENARIO_STOP_BUY_GATE",
        explanation: "STOP blocks additional BUY spending only.",
      },
    }),
  })
  await evaluate({
    symbol,
    marketPrice: {
      symbol,
      price: "25",
    },
    marketMetadata,
    pairConfig,
  })

  assert.equal(submissions, 1,
    "An otherwise-eligible first recovery SELL must still be submitted while STOP is latched.")
  assert.equal(snapshot.buyAdmissionBlocked, true,
    "The STOP must keep BUY admission blocked while allowing the eligible SELL.")
  assert.equal(submittedSide, "SELL",
    "The account STOP gate must still submit only the eligible recovery SELL.")
  assert.equal(snapshot.stopState.status, "STOPPED",
    "The successful SELL submission must not clear or downgrade the latched account STOP.")
}

test("real workflow snapshots preserve non-STOP SELL gates and allow eligible SELL under STOP", async () => {
  const baseScenario = await createPlannerScenario()
  const existingOrderScenario = await createPlannerScenario({
    includeExternalSellReservation: true,
  })
  const gatedSnapshots = createWorkflowGateScenarios({
    baseScenario,
    existingOrderScenario,
  })

  for (const scenario of gatedSnapshots) {
    await assertWorkflowGateBlocksSell({
      ...scenario,
      marketMetadata: baseScenario.marketMetadata,
    })
  }

  const stoppedSnapshot = createWorkflowStopSnapshot({ baseScenario })
  await assertWorkflowStopAllowsSell({
    snapshot: stoppedSnapshot,
    marketMetadata: baseScenario.marketMetadata,
  })
})
