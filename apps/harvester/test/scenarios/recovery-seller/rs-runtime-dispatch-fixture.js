import { validateScenarioInput } from "../../../src/infrastructure/scenario-runner/rs-scenario-adapter.js"

import { isDeepStrictEqual } from "node:util"
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
import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from "@coinzilla/utils"
import { AccountSnapshot } from "../../../src/domain/account/account-snapshot.js"
import { allocateOrderCommitments } from "../../../src/domain/orders/allocate-order-commitments.js"
import { createOrderOwnership } from "../../../src/domain/orders/order-ownership.js"
import { OrderRegistry } from "../../../src/domain/orders/order-registry.js"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../../../src/domain/strategies/recovery-seller/legacy-position.js"
import { createRecoverySellerRuntimeDispatch } from "../../../src/bootstrap/create-recovery-seller-runtime-dispatch.js"
import { createRecoverySellerAccountingWorkflow } from "../../../src/use-cases/create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerActionAuthorizer } from "../../../src/use-cases/create-recovery-seller-action-authorizer.js"
import { createRecoverySellerOrderSubmitter } from "../../../src/use-cases/create-recovery-seller-order-submitter.js"
import { createRecoverySellerStopWorkflow } from "../../../src/use-cases/create-recovery-seller-stop-workflow.js"
import { recordOrderSubmissionIntent } from "../../../src/use-cases/record-order-submission-intent.js"
import { recordOrderSubmissionOutcome } from "../../../src/use-cases/record-order-submission-outcome.js"
const RUNTIME_PAIR_CONFIG = Object.freeze({
  enabled: true,
  investment: 100,
  orderQuantity: 5,
  sellQuantity: 50,
  minProfit: 0.01,
  priceStepPercent: 0.05,
  makerPercent: 0,
  takerPercent: 0,
  thirdAssetFeeQuoteValue: "0",
  legacyPosition: Object.freeze({
    invested: 100,
    quantity: 50,
  }),
})
const RUNTIME_PAIR_CONFIGS = Object.freeze({
  ZROUSDT: RUNTIME_PAIR_CONFIG,
})

const RUNTIME_FIXTURE = Object.freeze({
  name: "Production Recovery Seller SELL dispatch fixture",
  inputSchema: Object.freeze({
    type: "object",
    required: ["marketPrice"],
    additionalProperties: false,
    properties: Object.freeze({
      marketPrice: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
        description: "Positive simulated ZRO/USDT market price in USDT.",
      }),
    }),
  }),
  input: Object.freeze({
    marketPrice: "12.3",
  }),
})


function createAssertion({ name, actual, expected }) {
  return Object.freeze({
    name,
    passed: isDeepStrictEqual(actual, expected),
    actual,
    expected,
  })
}


function createRuntimeScenarioStore() {
  const records = []
  return {
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
    getRecords: () => [...records],
  }
}

function createRuntimeScenarioMarket() {
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
  return {
    baseAsset,
    quoteAsset,
    market,
  }
}

function createRuntimeScenarioMarketMetadata({ market, baseAsset, quoteAsset }) {
  return {
    market,
    orderType: "LIMIT_MAKER",
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    source: "deterministic-simulation-fixture",
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
}

function createRuntimeScenarioAccountSnapshot({
  baseAsset,
  quoteAsset,
  buyQuantity,
  legacyQuantity,
  buyQuoteQuantity,
}) {
  const totalBaseQuantity = addDecimal({
    left: buyQuantity,
    right: legacyQuantity,
  })
  const totalQuoteCashFlow = buyQuoteQuantity
  return new AccountSnapshot({
    balances: [
      new Balance({
        free: new Quantity({
          amount: totalBaseQuantity,
          asset: baseAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: baseAsset,
        }),
      }),
      new Balance({
        free: new Quantity({
          amount: "1000",
          asset: quoteAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: quoteAsset,
        }),
      }),
    ],
    sourceTime: 1,
    quoteCashFlowBaseline: [{
      assetId: quoteAsset.id,
      amount: subtractDecimal({
        left: "0",
        right: totalQuoteCashFlow,
      }),
    }],
    portfolioBaseQuantityBaseline: [{
      assetId: baseAsset.id,
      amount: buyQuantity,
    }],
    additionalTrackedBaseQuantityBaseline: [{
      assetId: baseAsset.id,
      amount: legacyQuantity,
    }],
  })
}

function createRuntimeScenarioBuyOrder({
  market,
  baseAsset,
  quoteAsset,
  buyQuantity,
  buyPrice,
}) {
  const buyOrder = new CanonicalOrder({
    clientOrderId: "rs-scenario-buy-1",
    brokerOrderId: "rs-scenario-broker-buy-1",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: buyPrice,
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: buyQuantity,
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: buyQuantity,
      asset: baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const ownership = createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-scenario-position-1",
      purpose: "RECOVERY_BUY",
      cycleId: "rs-scenario-cycle-1",
    },
    clientOrderId: buyOrder.clientOrderId,
    brokerOrderId: buyOrder.brokerOrderId,
  })
  return {
    buyOrder,
    ownership,
  }
}

function createRuntimeScenarioBuyFill({
  market,
  baseAsset,
  quoteAsset,
  buyOrder,
  buyQuantity,
  buyPrice,
  buyQuoteQuantity,
}) {
  return new Fill({
    tradeId: "rs-scenario-buy-fill-1",
    brokerOrderId: buyOrder.brokerOrderId,
    clientOrderId: buyOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: buyPrice,
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: buyQuantity,
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: buyQuoteQuantity,
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

async function createRuntimeScenarioWorkflow({
  market,
  baseAsset,
  quoteAsset,
  pairConfig,
}) {
  const buyQuantity = String(pairConfig.orderQuantity)
  const buyPrice = "2"
  const buyQuoteQuantity = multiplyDecimal({
    left: buyPrice,
    right: buyQuantity,
  })
  const legacyInvested = String(pairConfig.legacyPosition.invested)
  const legacyQuantity = String(pairConfig.legacyPosition.quantity)
  const { buyOrder, ownership } = createRuntimeScenarioBuyOrder({
    market,
    baseAsset,
    quoteAsset,
    buyQuantity,
    buyPrice,
  })
  const workflow = createRecoverySellerAccountingWorkflow({
    initialPortfolio: new Portfolio(),
    initialOrderRegistry: new OrderRegistry({
      orders: [buyOrder],
      ownerships: [ownership],
    }),
    initialLegacyPositions: [{
      market,
      position: createLegacyPosition({
        invested: legacyInvested,
        quantity: legacyQuantity,
      }),
      accounting: createLegacyPositionAccounting(),
    }],
    createCycleId: () => "rs-scenario-cycle-2",
  })
  const fill = createRuntimeScenarioBuyFill({
    market,
    baseAsset,
    quoteAsset,
    buyOrder,
    buyQuantity,
    buyPrice,
    buyQuoteQuantity,
  })
  const applied = await workflow.applyBuyFill({
    fill,
  })
  if (applied?.ok !== true) {
    throw applied?.errors?.[0] ?? new Error("Simulation seed BUY Fill could not be applied to the production RS accounting workflow")
  }
  return {
    workflow,
    fill,
    buyQuantity,
    buyQuoteQuantity,
    legacyQuantity,
  }
}

async function createRuntimeScenarioStopWorkflow({ operationalStateStore }) {
  const result = await createRecoverySellerStopWorkflow({
    operationalStateStore,
  })
  if (result?.ok !== true) {
    throw result?.errors?.[0] ?? new Error("Simulation STOP workflow could not initialize")
  }
  return result.data
}

function createRuntimeScenarioBroker({ market, baseAsset, quoteAsset, runId }) {
  return {
    broker: {
      providerInstanceId: "scenario-runner-simulation",
      providerType: "simulation",
      accountId: `scenario-${runId}`,
      placeOrder: async ({ order }) => {
        const acknowledgedOrder = new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: `sim-${order.clientOrderId}`,
          providerInstanceId: "scenario-runner-simulation",
          providerType: "simulation",
          accountId: `scenario-${runId}`,
          market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({
            amount: order.price,
            asset: quoteAsset,
          }),
          originalQuantity: new Quantity({
            amount: order.quantity,
            asset: baseAsset,
          }),
          executedQuantity: new Quantity({
            amount: "0",
            asset: baseAsset,
          }),
          status: "OPEN",
          createdAt: 1,
          acknowledgedAt: 2,
          updatedAt: 2,
        })
        return {
          ok: true,
          data: acknowledgedOrder,
        }
      },
    },
  }
}

function createRuntimeScenarioSubmitter({
  broker,
  workflow,
  stopWorkflow,
  operationalStateStore,
}) {
  return createRecoverySellerOrderSubmitter({
    broker,
    recoverySellerAccountingWorkflow: workflow,
    onDurableSubmissionIntent: (input) => recordOrderSubmissionIntent({
      operationalStateStore,
      ...input,
    }),
    onDurableSubmissionOutcome: (input) => recordOrderSubmissionOutcome({
      operationalStateStore,
      ...input,
    }),
    onUnresolvedSubmission: ({ order, outcome }) => stopWorkflow.latch({
      explanation: `Simulation order submission is unresolved: ${outcome}`,
      orderIdentity: {
        clientOrderId: order.clientOrderId,
        ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
      },
    }),
    onOrderValidationFailure: async () => {},
    canSubmit: () => true,
    onSellReserved: async ({ order, ownership, durableIntent }) => {
      const reserved = await workflow.reserveSellCycle({
        order,
        ownership,
        durableIntent,
      })
      if (reserved?.ok !== true) {
        return reserved
      }
      return {
        ok: true,
        data: {
          durable: true,
          reservation: reserved.data,
        },
      }
    },
  })
}

function createRuntimeScenarioAuthorizer({ workflow, stopWorkflow, accountSnapshot }) {
  const state = {
    get registry() {
      return workflow.getOrderRegistry()
    },
  }
  return createRecoverySellerActionAuthorizer({
    state,
    recoverySellerPairs: RUNTIME_PAIR_CONFIGS,
    recoverySellerStopWorkflow: stopWorkflow,
    getPortfolio: () => workflow.getPortfolio(),
    getAccountSnapshot: () => accountSnapshot,
    getAdditionalTrackedBaseQuantity: (input) =>
      workflow.getAdditionalTrackedBaseQuantity(input),
    getAdditionalTrackedQuoteCashFlow: () =>
      workflow.getAdditionalTrackedQuoteCashFlow(),
    allocateOrderCommitments,
  })
}

function toScenarioOrder({ order }) {
  return {
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    side: order.side,
    type: order.type,
    price: order.limitPrice.amount,
    quantity: order.originalQuantity.amount,
    status: order.status,
  }
}

async function createRuntimeScenarioContext({ runId }) {
  const { baseAsset, quoteAsset, market } = createRuntimeScenarioMarket()
  const marketMetadata = createRuntimeScenarioMarketMetadata({
    market,
    baseAsset,
    quoteAsset,
  })
  const seed = await createRuntimeScenarioWorkflow({
    market,
    baseAsset,
    quoteAsset,
    pairConfig: RUNTIME_PAIR_CONFIG,
  })
  const accountSnapshot = createRuntimeScenarioAccountSnapshot({
    baseAsset,
    quoteAsset,
    buyQuantity: seed.buyQuantity,
    legacyQuantity: seed.legacyQuantity,
    buyQuoteQuantity: seed.buyQuoteQuantity,
  })
  const operationalStateStore = createRuntimeScenarioStore()
  const stopWorkflow = await createRuntimeScenarioStopWorkflow({
    operationalStateStore,
  })
  const { broker } = createRuntimeScenarioBroker({
    market,
    baseAsset,
    quoteAsset,
    runId,
  })
  const submitter = createRuntimeScenarioSubmitter({
    broker,
    workflow: seed.workflow,
    stopWorkflow,
    operationalStateStore,
  })
  const authorize = createRuntimeScenarioAuthorizer({
    workflow: seed.workflow,
    stopWorkflow,
    accountSnapshot,
  })
  const dispatch = createRecoverySellerRuntimeDispatch({
    recoverySellerWorkflow: seed.workflow,
    recoverySellerStopWorkflow: stopWorkflow,
    recoverySellerPairs: RUNTIME_PAIR_CONFIGS,
    getRecoverySellerMarketMetadata: async () => marketMetadata,
    getAccountSnapshot: async () => accountSnapshot,
  })
  return {
    marketMetadata,
    pairConfig: RUNTIME_PAIR_CONFIG,
    seed,
    accountSnapshot,
    operationalStateStore,
    stopWorkflow,
    submitter,
    authorize,
    dispatch,
  }
}

async function executeRuntimeScenarioDispatch({ runtime, effectiveInput }) {
  let submittedAction
  const dispatchResult = await runtime.dispatch({
    symbol: "ZROUSDT",
    state: {
      prices: new Map([["ZROUSDT", {
        symbol: "ZROUSDT",
        price: effectiveInput.marketPrice,
      }]]),
      paused: new Set(),
      durablePausedMarkets: new Set(),
      operatorPausedMarkets: new Set(),
    },
    isMarketPriceFresh: () => true,
    isStopping: () => false,
    hasBlockingOpenOrdersForSymbol: () => false,
    authorizeRecoverySellerAction: runtime.authorize,
    submitRecoverySellerOrder: async (submission) => {
      const { action } = submission
      submittedAction = action
      return runtime.submitter(submission)
    },
  })
  if (dispatchResult?.ok !== true) {
    throw dispatchResult?.errors?.[0] ?? new Error("Production Recovery Seller runtime evaluation failed")
  }
  return {
    data: dispatchResult.data,
    submittedAction,
  }
}

function createRuntimeScenarioOutput({ runtime, data, submittedAction }) {
  const action = submittedAction ? {
    side: submittedAction.side,
    purpose: submittedAction.purpose,
    quantity: submittedAction.quantity,
    price: submittedAction.price,
    cycleId: submittedAction.cycleId,
    positionId: submittedAction.positionId,
  } : null
  const submittedOrders = (data.submittedOrders ?? []).map((order) => toScenarioOrder({
    order,
  }))
  const reservation = action
    ? runtime.seed.workflow.getReservedSellCycle({
        cycleId: action.cycleId,
      })
    : undefined
  const reservedSellCycle = reservation ? {
    clientOrderId: reservation.clientOrderId,
    cycleId: reservation.cycleId,
  } : null
  return {
    decision: data.decision ?? null,
    action,
    submitted: data.submitted === true,
    submittedOrders,
    reservedSellCycle,
    simulationFacts: runtime.operationalStateStore.getRecords().map((fact) => ({
      factId: fact.factId,
      factType: fact.factType,
      data: fact.data,
    })),
  }
}

function createRuntimeScenarioExpected({ seed, pairConfig }) {
  return {
    decisionOutcome: "SUBMIT",
    actionSide: "SELL",
    actionQuantity: addDecimal({
      left: seed.buyQuantity,
      right: String(pairConfig.sellQuantity),
    }),
    submittedOrderCount: 1,
    reservationMatchesSubmittedOrder: true,
  }
}

function createRuntimeScenarioAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "production RS transition selects a SELL action",
      actual: output.decision?.outcome,
      expected: expected.decisionOutcome,
    }),
    createAssertion({
      name: "SELL action includes the configured recovery quantity and authorized legacy slice",
      actual: output.action?.side,
      expected: expected.actionSide,
    }),
    createAssertion({
      name: "SELL quantity preserves the canonical recovery and legacy quantities",
      actual: output.action?.quantity,
      expected: expected.actionQuantity,
    }),
    createAssertion({
      name: "simulation broker acknowledges exactly one order",
      actual: output.submittedOrders.length,
      expected: expected.submittedOrderCount,
    }),
    createAssertion({
      name: "sole SELL cycle reservation belongs to the acknowledged order",
      actual: output.reservedSellCycle?.clientOrderId === output.submittedOrders[0]?.clientOrderId,
      expected: true,
    }),
  ]
}

function createRuntimeScenarioEvaluationTrace({ runtime, effectiveInput, output }) {
  return {
    id: "runtime-1",
    kind: "production-runtime",
    label: "Evaluate production Recovery Seller runtime transition",
    inputs: {
      symbol: "ZROUSDT",
      marketPrice: effectiveInput.marketPrice,
      config: runtime.pairConfig,
      marketMetadata: {
        source: runtime.marketMetadata.source,
        orderType: runtime.marketMetadata.orderType,
        tradingRules: runtime.marketMetadata.tradingRules.constraints.map((rule) => ({
          type: rule.type,
          status: rule.status,
          amount: rule.value.amount,
        })),
      },
    },
    outputs: output.decision,
    source: "createRecoverySellerRuntimeDispatch",
  }
}

function createRuntimeScenarioTrace({ runtime, effectiveInput, output, assertions }) {
  const inputStep = {
    id: "input-1",
    kind: "input",
    label: "Simulated ZROUSDT market price",
    inputs: effectiveInput,
    source: "deterministic-simulation-fixture",
  }
  const fillStep = {
    id: "fill-1",
    kind: "accounting",
    label: "Seed canonical recovery BUY Fill into production accounting workflow",
    inputs: {
      tradeId: runtime.seed.fill.tradeId,
      quantity: runtime.seed.fill.quantity.amount,
      price: runtime.seed.fill.price.amount,
      quoteQuantity: runtime.seed.fill.quoteQuantity.amount,
    },
    outputs: {
      recoveryBuyApplied: true,
      recoveryPositionId: "rs-scenario-position-1",
    },
    source: "createRecoverySellerAccountingWorkflow.applyBuyFill",
  }
  const brokerStep = {
    id: "broker-1",
    kind: "simulated-broker",
    label: "Submit the production SELL intent to the run-local simulated broker",
    inputs: output.action,
    outputs: output.submittedOrders,
    source: "createRecoverySellerOrderSubmitter",
  }
  const assertionStep = {
    id: "assertions-1",
    kind: "assertion",
    label: "Compare production execution with scenario expectations",
    outputs: assertions,
  }
  return [
    inputStep,
    fillStep,
    createRuntimeScenarioEvaluationTrace({
      runtime,
      effectiveInput,
      output,
    }),
    brokerStep,
    assertionStep,
  ]
}

export async function executeRecoverySellerRuntimeFixture({ runId, input }) {
  const effectiveInput = validateScenarioInput({
    schema: RUNTIME_FIXTURE.inputSchema,
    defaults: RUNTIME_FIXTURE.input,
    input,
  })
  if (compareDecimal({
    left: effectiveInput.marketPrice,
    right: "0",
  }) <= 0) {
    throw new RangeError("Scenario marketPrice must be greater than zero")
  }
  const runtime = await createRuntimeScenarioContext({
    runId,
  })
  const execution = await executeRuntimeScenarioDispatch({
    runtime,
    effectiveInput,
  })
  const output = createRuntimeScenarioOutput({
    runtime,
    data: execution.data,
    submittedAction: execution.submittedAction,
  })
  const expected = createRuntimeScenarioExpected({
    seed: runtime.seed,
    pairConfig: runtime.pairConfig,
  })
  const assertions = createRuntimeScenarioAssertions({
    output,
    expected,
  })
  const trace = createRuntimeScenarioTrace({
    runtime,
    effectiveInput,
    output,
    assertions,
  })
  return Object.freeze({
    runId,
    strategyId: "RS",
    fixtureId: "rs-runtime-sell-submission",
    fixtureName: RUNTIME_FIXTURE.name,
    input: effectiveInput,
    output: Object.freeze(output),
    expected: Object.freeze(expected),
    assertions: Object.freeze(assertions),
    passed: assertions.every((assertion) => assertion.passed),
    trace: Object.freeze(trace.map((step) => Object.freeze(step))),
    diagnostics: Object.freeze([]),
    source: "production-runtime-evaluator",
  })
}
