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
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../../../src/domain/strategies/recovery-seller/legacy-position.js"
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
const alternateQuoteAsset = new Asset({
  id: "binance:FDUSD",
  code: "FDUSD",
})
const alternateMarket = new Market({
  venue: "binance",
  symbol: "ZROFDUSD",
  baseAsset,
  quoteAsset: alternateQuoteAsset,
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
  const { action } = result
  const { orderIdentity } = result.decision
  return {
    outcome: result.decision.outcome,
    reasonCode: result.decision.reasonCode ?? null,
    action: action ? {
      side: action.side,
      purpose: action.purpose,
      cycleId: action.cycleId,
      positionId: action.positionId,
      type: action.type,
      price: action.price,
      quantity: action.quantity,
      notional: action.notional,
      reason: action.reason,
    } : null,
    stopStatus: result.stopState.status,
    orderIdentity: orderIdentity ? {
      clientOrderId: orderIdentity.clientOrderId,
      brokerOrderId: orderIdentity.brokerOrderId ?? null,
    } : null,
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
        value: new Money({
          amount: "0.001",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.01",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.01",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
          amount: "5",
          asset: quoteAsset,
        }),
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

function createBudgetAuthorizer({ activeOrders }) {
  let stopLatchCount = 0
  const ownershipByClientOrderId = new Map(activeOrders.map((order) => [
    order.clientOrderId,
    { strategyId: order.strategyId ?? StrategyId.COIN_GRABBER },
  ]))
  const state = {
    registry: {
      getActiveOrders: () => activeOrders,
      getOwnership: ({ clientOrderId }) => ownershipByClientOrderId.get(clientOrderId),
    },
  }
  const authorize = createRecoverySellerActionAuthorizer({
    state,
    recoverySellerPairs: {
      ZROUSDT: { investment: 100 },
    },
    recoverySellerStopWorkflow: {
      latch: async () => {
        stopLatchCount += 1
        return {
          ok: true,
          data: { durable: true },
        }
      },
    },
    getPortfolio: () => ({
      positions: [],
      getPosition: () => undefined,
    }),
    getAccountSnapshot: () => ({
      balances: [],
      getFreeBalance: ({ assetId }) => ({
        amount: assetId === "USDT" ? "100" : "0",
      }),
      getPortfolioBaseQuantityBaseline: () => "0",
      getAdditionalTrackedBaseQuantityBaseline: () => "0",
      getQuoteCashFlowBaseline: () => "0",
      getCommittedQuoteBalanceBaseline: () => "0",
      getCommittedBaseBalanceBaseline: () => "0",
    }),
    getAdditionalTrackedBaseQuantity: () => [],
    getAdditionalTrackedQuoteCashFlow: () => [],
    allocateOrderCommitments,
  })
  return {
    authorize,
    getStopLatchCount: () => stopLatchCount,
  }
}

function createRSBudgetPolicyOverrides() {
  return {
    pairConfig: {
      orderQuantity: "5",
      priceStepPercent: "0.05",
      investment: "19.994",
    },
    recoveryPosition: {
      positionId: "rs-policy-position",
      quantity: "5",
      spent: "10",
    },
    lastBuyPrice: "2",
  }
}

function createCGBudgetCommitment() {
  return {
    clientOrderId: "cg-same-market-buy",
    strategyId: StrategyId.COIN_GRABBER,
    market: {
      id: "ZROUSDT",
      symbol: "ZROUSDT",
      baseAsset: { id: "ZRO" },
      quoteAsset: { id: "USDT" },
    },
    side: "BUY",
    remainingQuantity: { amount: "9.1" },
    limitPrice: { amount: "10" },
  }
}

function createRSBudgetAuthorizationRequest() {
  return {
    action: {
      side: "BUY",
      quantity: "1",
      price: "10",
      positionId: "rs-position-1",
    },
    snapshot: {
      planInput: {
        recoveryQuantity: "0",
        verifiedUnreservedLegacyQuantity: "0",
        recoveryCostBasis: "0",
      },
      cumulativeNetSellProceeds: "0",
    },
    input: {
      symbol: "ZROUSDT",
      marketMetadata: {
        market: {
          id: "ZROUSDT",
          baseAsset: { id: "ZRO" },
          quoteAsset: { id: "USDT" },
        },
      },
    },
  }
}

async function runBuyBudgetIsolationScenario({ input }) {
  const rsBudget = evaluateBuyPolicyCase({
    overrides: createRSBudgetPolicyOverrides(),
  })
  const runtime = createBudgetAuthorizer({
    activeOrders: [createCGBudgetCommitment()],
  })
  const allocation = await runtime.authorize(createRSBudgetAuthorizationRequest())
  return {
    otherStrategyInvestment: input.otherStrategyInvestment,
    rsPairBudgetOutcome: rsBudget.outcome,
    rsPairBudgetReason: rsBudget.reasonCode,
    sharedAccountAllocation: {
      ok: allocation.ok,
      allowed: allocation.data?.allowed ?? false,
      skipped: allocation.data?.skipped ?? false,
      reason: allocation.data?.reason ?? null,
    },
    stopLatchCount: runtime.getStopLatchCount(),
  }
}

async function createUnknownBuySubmitterContext() {
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
    canSubmit: () => ({ allowed: true }),
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
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onDurableSubmissionOutcome: async (fact) => {
      durableFacts.push(fact)
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onUnresolvedSubmission: async ({ order, outcome }) => {
      unresolved.push({
        order,
        outcome,
      })
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
  const [activeOrder] = runtime.workflow.getActiveOrders()
  return {
    brokerCallCount: runtime.getBrokerCallCount(),
    resultOk: result.ok,
    unresolvedCount: runtime.unresolved.length,
    durableFactCount: runtime.durableFacts.length,
    activeOrderStatus: activeOrder?.status ?? null,
    stopStatus: runtime.stopResult.data.getStopState().status,
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

function createExistingCGPositionPortfolio() {
  const existingCGBuyFill = new Fill({
    tradeId: "existing-cg-position-fill",
    brokerOrderId: "existing-cg-broker-order",
    clientOrderId: "existing-cg-client-order",
    market,
    side: "BUY",
    price: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "3",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "6",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return new Portfolio().applyFill({
    fill: existingCGBuyFill,
    positionId: "existing-cg-position",
    strategyId: StrategyId.COIN_GRABBER,
  }).portfolio
}

function createScenarioInitialPortfolio({ input, order }) {
  let portfolio = input.initialCGPosition === true
    ? createExistingCGPositionPortfolio()
    : new Portfolio()
  if (input.seedFillInput) {
    const seedFill = createScenarioFill({
      fillInput: input.seedFillInput,
      order,
    })
    portfolio = portfolio.applyFill({
      fill: seedFill,
      positionId: input.seedPositionId ?? "existing-foreign-position",
      strategyId: input.seedStrategyId ?? StrategyId.RECOVERY_SELLER,
    }).portfolio
  }
  return portfolio
}

function createScenarioLegacyPositions({ input }) {
  if (input.includeLegacyBasis !== true) {
    return []
  }
  return [{
    market,
    position: createLegacyPosition({
      invested: input.legacyInvested ?? "50",
      quantity: input.legacyQuantity ?? "10",
    }),
    accounting: createLegacyPositionAccounting(),
  }]
}

function createScenarioOrder({ input }) {
  return new CanonicalOrder({
    clientOrderId: "rs-buy-scenario-order",
    brokerOrderId: "broker-rs-buy-scenario",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: input.limitPrice ?? "20",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: input.originalQuantity ?? "5.01",
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
}

function createScenarioOwnerships({ input, positionId, cycleId }) {
  if (input.owned === false) {
    return []
  }
  return [createOrderOwnership({
    ownership: {
      strategyId: input.strategyId ?? StrategyId.RECOVERY_SELLER,
      positionId,
      purpose: "RECOVERY_BUY",
      cycleId,
    },
    clientOrderId: "rs-buy-scenario-order",
    brokerOrderId: "broker-rs-buy-scenario",
  })]
}

function createScenarioWorkflow({ input }) {
  const positionId = input.positionId ?? "rs-buy-scenario-position"
  const cycleId = input.cycleId ?? "rs-buy-scenario-cycle"
  const order = createScenarioOrder({ input })
  const initialPortfolio = createScenarioInitialPortfolio({
    input,
    order,
  })
  const workflow = createRecoverySellerAccountingWorkflow({
    initialPortfolio,
    initialOrderRegistry: new OrderRegistry({
      orders: [order],
      ownerships: createScenarioOwnerships({
        input,
        positionId,
        cycleId,
      }),
    }),
    initialLegacyPositions: createScenarioLegacyPositions({ input }),
  })
  return {
    workflow,
    order,
    positionId,
    cycleId,
    initialPortfolio,
  }
}

function createScenarioFill({ fillInput, order }) {
  const fillMarket = fillInput.marketSymbol === "ZROFDUSD" ? alternateMarket : order.market
  return new Fill({
    tradeId: fillInput.tradeId,
    brokerOrderId: fillInput.brokerOrderId ?? order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market: fillMarket,
    side: fillInput.side ?? "BUY",
    price: new Money({
      amount: fillInput.price ?? "2",
      asset: fillMarket.quoteAsset,
    }),
    quantity: new Quantity({
      amount: fillInput.quantity,
      asset: fillMarket.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: fillInput.quoteQuantity,
      asset: fillMarket.quoteAsset,
    }),
    commissions: createCommissions({ fillInput }),
    commissionStatus: fillInput.commissionStatus ?? "COMPLETE",
  })
}

async function applyConflictingFillVariants({ workflow, firstFill, order, positionId }) {
  const variants = [
    {
      id: "changed-quantity",
      fillInput: {
        tradeId: firstFill.tradeId,
        price: "10",
        quantity: "2",
        quoteQuantity: "20",
      },
    },
    {
      id: "changed-price",
      fillInput: {
        tradeId: firstFill.tradeId,
        price: "5.01",
        quantity: "1",
        quoteQuantity: "5.01",
      },
    },
    {
      id: "changed-commission",
      fillInput: {
        tradeId: firstFill.tradeId,
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
        baseCommission: "0.001",
      },
    },
  ]
  const cases = []
  for (const variant of variants) {
    const fill = createScenarioFill({
      fillInput: variant.fillInput,
      order,
    })
    const result = await workflow.applyBuyFill({ fill })
    const portfolio = workflow.getPortfolio()
    const position = portfolio.getPosition({ positionId })
    cases.push({
      id: variant.id,
      ok: result.ok,
      applied: result.data?.applied === true,
      appliedFillIds: portfolio.appliedFillIds.length,
      position: position
        ? {
            quantity: position.baseQuantity.amount,
            spent: position.spent.amount,
          }
        : null,
    })
  }
  return { cases }
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
  return applyConflictingFillVariants({
    workflow,
    firstFill: fills[0],
    order,
    positionId: "rs-buy-scenario-position",
  })
}

async function runInitialBuyScenario({ input }) {
  const policy = evaluateBuyPolicyCase({
    overrides: input.policyOverrides,
  })
  const accounting = await runBuyScenario({ input })
  return {
    policy,
    accounting,
  }
}

async function runBuyFeeRecordScenario({ input }) {
  const zeroCommission = await runBuyScenario({
    input: input.zeroCommission,
  })
  const multipleFeeRecords = await runBuyScenario({
    input: input.multipleFeeRecords,
  })
  return {
    zeroCommission,
    multipleFeeRecords,
  }
}

function createScenarioFills({ input, order }) {
  return input.fills.map((fillInput) => createScenarioFill({
    fillInput,
    order,
  }))
}

function createBuyScenarioResult({
  workflow,
  positionId,
  cycleId,
  input,
  replay,
  conflict,
  results,
}) {
  const portfolio = workflow.getPortfolio()
  const position = portfolio.getPosition({ positionId })
  const legacyPosition = input.includeLegacyBasis === true
    ? workflow.getLegacyPosition({ marketId: market.id })
    : undefined
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
    ...(input.includePositionOwnerships === true ? {
      positions: portfolio.positions.map((item) => ({
        positionId: item.positionId,
        strategyId: item.strategyId,
        quantity: item.baseQuantity.amount,
        spent: item.spent.amount,
      })),
    } : {}),
    ...(legacyPosition ? {
      legacyPosition: {
        invested: legacyPosition.invested,
        originalQuantity: legacyPosition.originalQuantity,
        averageCost: legacyPosition.averageCost,
        remainingQuantity: legacyPosition.remainingQuantity,
      },
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

async function runBuyScenario({ input }) {
  const { workflow, order, positionId, cycleId } = createScenarioWorkflow({ input })
  const fills = createScenarioFills({
    input,
    order,
  })
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
  return createBuyScenarioResult({
    workflow,
    positionId,
    cycleId,
    input,
    replay,
    conflict,
    results,
  })
}

async function runBuyOwnershipRejectionScenario({ input }) {
  const cases = []
  for (const scenarioCase of input.cases) {
    const { workflow, order, initialPortfolio } = createScenarioWorkflow({
      input: scenarioCase,
    })
    const fill = createScenarioFill({
      fillInput: scenarioCase.fillInput,
      order,
    })
    const result = await workflow.applyBuyFill({ fill })
    const portfolio = workflow.getPortfolio()
    cases.push({
      id: scenarioCase.id,
      accepted: result.ok === true,
      appliedFillIdsBefore: initialPortfolio.appliedFillIds.length,
      appliedFillIdsAfter: portfolio.appliedFillIds.length,
      positionIdsBefore: initialPortfolio.positions.map((position) => position.positionId),
      positionIdsAfter: portfolio.positions.map((position) => position.positionId),
    })
  }
  return { cases }
}

function isInvalidCanonicalBuyFillRejected({ quantityAmount }) {
  try {
    new Fill({
      tradeId: "invalid-buy-fill",
      brokerOrderId: "broker-invalid-buy-fill",
      clientOrderId: "rs-buy-scenario-order",
      market,
      side: "BUY",
      price: new Money({
        amount: "10",
        asset: quoteAsset,
      }),
      quantity: new Quantity({
        amount: quantityAmount,
        asset: baseAsset,
      }),
      quoteQuantity: new Money({
        amount: "10",
        asset: quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
    return false
  } catch {
    return true
  }
}

function isNegativeBuyCommissionRejected() {
  try {
    new Commission({
      amount: new Money({
        amount: "-0.001",
        asset: baseAsset,
      }),
    })
    return false
  } catch {
    return true
  }
}

function createInvalidBuyFillConstructionResults() {
  return {
    zeroQuantityRejected: isInvalidCanonicalBuyFillRejected({
      quantityAmount: "0",
    }),
    negativeQuantityRejected: isInvalidCanonicalBuyFillRejected({
      quantityAmount: "-1",
    }),
    negativeCommissionRejected: isNegativeBuyCommissionRejected(),
  }
}

async function applyExcessiveBaseCommissionFill() {
  const { workflow, order } = createScenarioWorkflow({
    input: {
      originalQuantity: "1",
    },
  })
  const fill = createScenarioFill({
    fillInput: {
      tradeId: "excessive-base-commission",
      price: "10",
      quantity: "1",
      quoteQuantity: "10",
      baseCommission: "1.001",
    },
    order,
  })
  const result = await workflow.applyBuyFill({ fill })
  return {
    rejected: result.ok !== true,
    appliedFillIds: workflow.getPortfolio().appliedFillIds.length,
    positionCount: workflow.getPortfolio().positions.length,
  }
}

async function runInvalidBuyFillScenario() {
  const construction = createInvalidBuyFillConstructionResults()
  const excessiveCommission = await applyExcessiveBaseCommissionFill()
  return {
    ...construction,
    excessiveBaseCommissionRejected: excessiveCommission.rejected,
    appliedFillIds: excessiveCommission.appliedFillIds,
    positionCount: excessiveCommission.positionCount,
  }
}

const applicationHandlers = {
  "apply-recovery-buy-scenario": runBuyScenario,
  "apply-recovery-buy-fee-record-scenarios": runBuyFeeRecordScenario,
  "evaluate-initial-buy-and-accounting-scenario": runInitialBuyScenario,
  "reject-invalid-buy-fill-ownership": runBuyOwnershipRejectionScenario,
  "validate-rejected-buy-fill-values": runInvalidBuyFillScenario,
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
