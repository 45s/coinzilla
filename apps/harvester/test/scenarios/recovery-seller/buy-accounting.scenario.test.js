import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { evaluateRecoverySellerBuyDecision } from "../../../src/domain/strategies/recovery-seller/evaluate-buy-decision.js"
import { createRecoverySellerCycleState } from "../../../src/domain/strategies/recovery-seller/cycle-state.js"
import { createRecoverySellerStopState } from "../../../src/domain/strategies/recovery-seller/stop-decision.js"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { createOrderOwnership } from "../../../src/domain/orders/order-ownership.js"
import { OrderRegistry } from "../../../src/domain/orders/order-registry.js"
import { createRecoverySellerAccountingWorkflow } from "../../../src/use-cases/create-recovery-seller-accounting-workflow.js"
import { allocateOrderCommitments } from "../../../src/domain/orders/allocate-order-commitments.js"
import { createRecoverySellerActionAuthorizer } from "../../../src/use-cases/create-recovery-seller-action-authorizer.js"
import { createRecoverySellerOrderSubmitter } from "../../../src/use-cases/create-recovery-seller-order-submitter.js"
import { createRecoverySellerStopWorkflow } from "../../../src/use-cases/create-recovery-seller-stop-workflow.js"
import { runRecoverySellerApplicationScenario } from "./runners/run-application-scenario.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"
import { recoverySellerBuyAccountingScenarios } from "./scenarios/buy-accounting.js"

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
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})

const buyPolicyMarketMetadata = {
  market: {
    id: "binance:ZROUSDT",
    symbol: "ZROUSDT",
  },
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      ["PRICE_INCREMENT", "0.001"],
      ["QUANTITY_INCREMENT", "0.01"],
      ["MIN_QUANTITY", "0.01"],
      ["MIN_NOTIONAL", "5"],
      ["MAX_QUANTITY", "100"],
      ["MAX_NOTIONAL", "1000"],
      ["MIN_PRICE", "0.001"],
      ["MAX_PRICE", "100"],
    ].map(([type, amount]) => ({
      type,
      status: "SUPPORTED",
      value: { amount },
    })),
  },
}


function evaluateBuyPolicyCase({ overrides }) {
  const result = evaluateRecoverySellerBuyDecision({
    stopState: createRecoverySellerStopState(),
    marketPrice: {
      symbol: "ZROUSDT",
      price: "2",
    },
    pairConfig: {
      orderQuantity: "5",
      priceStepPercent: "0.05",
      investment: "100",
    },
    marketMetadata: buyPolicyMarketMetadata,
    activeOrders: [],
    cycleState: createRecoverySellerCycleState({
      cycleId: "rs-policy-cycle",
      positionId: "rs-policy-position",
    }),
    strategyStopped: false,
    marketPaused: false,
    reconciliationComplete: true,
    cumulativeNetSellProceeds: "0",
    pendingBuyCommitment: "0",
    ...overrides,
  })
  return {
    outcome: result.decision.outcome,
    reasonCode: result.decision.reasonCode ?? null,
    action: result.action ?? null,
    stopStatus: result.stopState.status,
    orderIdentity: result.decision.orderIdentity ?? null,
  }
}

function evaluateBuyPolicyScenario({ input }) {
  return {
    cases: input.cases.map((scenarioCase) => ({
      id: scenarioCase.id,
      ...evaluateBuyPolicyCase({
        overrides: scenarioCase.overrides,
      }),
    })),
  }
}

const submitterMarketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  tradingRules: new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({ amount: "0.001", asset: quoteAsset }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({ amount: "0.01", asset: baseAsset }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({ amount: "0.01", asset: baseAsset }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({ amount: "5", asset: quoteAsset }),
      },
    ],
  }),
}

function createSubmitterSharedState() {
  return {
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    orderRegistry: OrderRegistry.empty(),
    legacyPositions: new Map(),
    recoverySellerBuyExecutionByCycle: new Map(),
    updateQueue: Promise.resolve(),
  }
}

function createOperationalStateStore() {
  const records = []
  return {
    records,
    append: async (fact) => {
      records.push(fact)
      return {
        ok: true,
        data: {
          durable: true,
          record: fact,
        },
      }
    },
    readAll: async () => ({
      ok: true,
      data: {
        records: [...records],
      },
    }),
  }
}

async async function createUnknownBuySubmitterContext() {
  const sharedState = createSubmitterSharedState()
  const workflow = createRecoverySellerAccountingWorkflow({ sharedState })
  const operationalStateStore = createOperationalStateStore()
  const stopResult = await createRecoverySellerStopWorkflow({
    operationalStateStore,
  })
  const durableFacts = []
  const unresolved = []
  let brokerCallCount = 0
  const submit = createRecoverySellerOrderSubmitter({
    broker: {
      providerInstanceId: "binance-testnet-primary",
      providerType: "binance",
      accountId: "harvester-testnet",
      placeOrder: async () => {
        brokerCallCount += 1
        throw new Error("broker acknowledgement timed out")
      },
    },
    recoverySellerAccountingWorkflow: workflow,
    onDurableSubmissionIntent: async (fact) => {
      durableFacts.push(fact)
      return { ok: true, data: { durable: true } }
    },
    onDurableSubmissionOutcome: async (fact) => {
      durableFacts.push(fact)
      return { ok: true, data: { durable: true } }
    },
    onUnresolvedSubmission: async ({ order, outcome }) => {
      unresolved.push({ order, outcome })
      return stopResult.data.latch({
        explanation: `RS BUY submission is unresolved: ${outcome}`,
        orderIdentity: {
          clientOrderId: order.clientOrderId,
        },
      })
    },
  })
  return {
    workflow,
    stopResult,
    submit,
    durableFacts,
    unresolved,
    getBrokerCallCount: () => brokerCallCount,
  }
}

function createUnknownBuyActiveOrders({ workflow }) {
  return workflow.getActiveOrders().map((order) => ({
    ...order,
    ownership: workflow.getOrderRegistry().getOwnership({
      clientOrderId: order.clientOrderId,
    }),
  }))
}

function evaluateUnknownBuyFollowup({ workflow, stopResult }) {
  return evaluateRecoverySellerBuyDecision({
    stopState: stopResult.data.getStopState(),
    marketPrice: { symbol: "ZROUSDT", price: "2" },
    pairConfig: {
      orderQuantity: "5",
      priceStepPercent: "0.05",
      investment: "100",
    },
    marketMetadata: buyPolicyMarketMetadata,
    activeOrders: createUnknownBuyActiveOrders({ workflow }),
    cycleState: createRecoverySellerCycleState({
      cycleId: "rs-cycle-1",
      positionId: "rs-position-1",
    }),
    strategyStopped: false,
    marketPaused: false,
    reconciliationComplete: true,
    cumulativeNetSellProceeds: "0",
    pendingBuyCommitment: "0",
  })
}

async function runUnknownBuySubmissionScenario() {
  const runtime = await createUnknownBuySubmitterContext()
  const result = await runtime.submit({
    lifecycleDecision: {
      outcome: "SUBMIT",
      reasonCode: "BUY_TRANCHE_ELIGIBLE",
    },
    action: {
      side: "BUY",
      purpose: "RECOVERY_BUY",
      cycleId: "rs-cycle-1",
      positionId: "rs-position-1",
      type: "LIMIT_MAKER",
      price: "1.999",
      quantity: "5",
    },
    marketMetadata: submitterMarketMetadata,
  })
  const followup = evaluateUnknownBuyFollowup({
    workflow: runtime.workflow,
    stopResult: runtime.stopResult,
  })
  const [activeOrder] = runtime.workflow.getActiveOrders()
  return {
    brokerCallCount: runtime.getBrokerCallCount(),
    resultOk: result.ok,
    unresolvedCount: runtime.unresolved.length,
    durableFactCount: runtime.durableFacts.length,
    activeOrderStatus: activeOrder?.status ?? null,
    stopStatus: runtime.stopResult.data.getStopState().status,
    followupOutcome: followup.decision.outcome,
    followupAction: followup.action ?? null,
  }
}

function createCommissions({ fillInput }) {
  const commissions = []
  const baseAmounts = fillInput.baseCommissions ?? [fillInput.baseCommission].filter(Boolean)
  const quoteAmounts = fillInput.quoteCommissions ?? [fillInput.quoteCommission].filter(Boolean)
  for (const amount of baseAmounts) {
    commissions.push(new Commission({
      amount: new Money({
        amount,
        asset: baseAsset,
      }),
    }))
  }
  for (const amount of quoteAmounts) {
    commissions.push(new Commission({
      amount: new Money({
        amount,
        asset: quoteAsset,
      }),
    }))
  }
  if (fillInput.thirdAssetCommission) {
    const feeAsset = new Asset({
      id: "binance:BNB",
      code: "BNB",
    })
    commissions.push(new Commission({
      amount: new Money({
        amount: fillInput.thirdAssetCommission,
        asset: feeAsset,
      }),
      ...(fillInput.thirdAssetQuoteValue === undefined ? {} : {
        quoteValue: new Money({
          amount: fillInput.thirdAssetQuoteValue,
          asset: quoteAsset,
        }),
      }),
    }))
  }
  return commissions
}

function createScenarioWorkflow({ input }) {
  const clientOrderId = "rs-buy-scenario-order"
  const brokerOrderId = "broker-rs-buy-scenario"
  const positionId = "rs-buy-scenario-position"
  const cycleId = "rs-buy-scenario-cycle"
  const order = new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: input.limitPrice ?? "4",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "5.01",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset,
    }),
    status: "OPEN",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 101,
  })
  const ownerships = input.owned === false
    ? []
    : [createOrderOwnership({
        ownership: {
          strategyId: StrategyId.RECOVERY_SELLER,
          positionId,
          purpose: "RECOVERY_BUY",
          cycleId,
        },
        clientOrderId,
        brokerOrderId,
      })]
  const workflow = createRecoverySellerAccountingWorkflow({
    initialPortfolio: new Portfolio(),
    initialOrderRegistry: new OrderRegistry({
      orders: [order],
      ownerships,
    }),
  })
  return {
    workflow,
    order,
    positionId,
    cycleId,
  }
}

function createScenarioFill({ fillInput, order }) {
  return new Fill({
    tradeId: fillInput.tradeId,
    brokerOrderId: fillInput.brokerOrderId ?? order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market: order.market,
    side: "BUY",
    price: new Money({
      amount: fillInput.price ?? "2",
      asset: order.market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: fillInput.quantity,
      asset: order.market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: fillInput.quoteQuantity,
      asset: order.market.quoteAsset,
    }),
    commissions: createCommissions({ fillInput }),
    commissionStatus: "COMPLETE",
  })
}

async function applyConflictingFill({ workflow, firstFill, order }) {
  const conflictFill = createScenarioFill({
    fillInput: {
      tradeId: firstFill.tradeId,
      quantity: firstFill.quantity.amount,
      quoteQuantity: "5.01",
    },
    order,
  })
  const result = await workflow.applyBuyFill({ fill: conflictFill })
  return {
    ok: result.ok,
    applied: result.data?.applied === true,
  }
}

async function applyScenarioFills({ workflow, fills }) {
  const results = []
  for (const fill of fills) {
    const result = await workflow.applyBuyFill({ fill })
    results.push({
      ok: result.ok,
      applied: result.data?.applied === true,
    })
  }
  return results
}

async function replayScenarioFill({ workflow, fills, input }) {
  if (input.replayFirstFill !== true || !fills[0]) {
    return undefined
  }
  return workflow.applyBuyFill({ fill: fills[0] })
}

async function applyScenarioConflict({ workflow, fills, order, input }) {
  if (input.conflictFirstFill !== true) {
    return undefined
  }
  return applyConflictingFill({
    workflow,
    firstFill: fills[0],
    order,
  })
}

async function runBuyScenario({ input }) {
  const { workflow, order, positionId, cycleId } = createScenarioWorkflow({ input })
  const fills = input.fills.map((fillInput) => createScenarioFill({
    fillInput,
    order,
  }))
  const results = await applyScenarioFills({
    workflow,
    fills,
  })
  const replay = await replayScenarioFill({
    workflow,
    fills,
    input,
  })
  const conflict = await applyScenarioConflict({
    workflow,
    fills,
    order,
    input,
  })
  const portfolio = workflow.getPortfolio()
  const position = portfolio.getPosition({ positionId })
  return {
    appliedFillIds: portfolio.appliedFillIds.length,
    position: position
      ? {
          quantity: position.baseQuantity.amount,
          spent: position.spent.amount,
        }
      : null,
    executionQuantity: workflow.getBuyExecutionQuantity({ cycleId }) ?? null,
    executionVwap: workflow.getBuyExecutionVwap({ cycleId }) ?? null,
    ...(input.assertStrategyOwnership === true ? {
      positionStrategyId: position?.strategyId ?? null,
    } : {}),
    ...(replay ? {
      replay: {
        ok: replay.ok,
        applied: replay.data?.applied === true,
        duplicate: replay.data?.duplicate === true,
      },
    } : {}),
    ...(conflict ? { conflict } : {}),
    ...(results.some((result) => !result.ok) ? { results } : {}),
  }
}

const applicationHandlers = {
  "apply-recovery-buy-scenario": runBuyScenario,
  "submit-recovery-buy-with-unknown-outcome": runUnknownBuySubmissionScenario,
  "evaluate-recovery-buy-budget-isolation": runBuyBudgetIsolationScenario,
}
const domainHandlers = {
  "evaluate-recovery-buy-policy-scenario": evaluateBuyPolicyScenario,
}

for (const scenario of recoverySellerBuyAccountingScenarios.filter((item) => item.status !== "BLOCKED")) {
  test(scenario.test.title, async () => {
    const result = scenario.layer === "DOMAIN"
      ? await runRecoverySellerDomainScenario({
          scenario,
          handlers: domainHandlers,
        })
      : await runRecoverySellerApplicationScenario({
          scenario,
          handlers: applicationHandlers,
        })
    assert.deepEqual(result.results[0], scenario.then,
      `${scenario.id} must match its independent BUY accounting oracle.`)
  })
}
