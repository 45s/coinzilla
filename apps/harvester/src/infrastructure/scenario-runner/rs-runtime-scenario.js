import { isDeepStrictEqual } from "node:util"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { validateScenarioInput as validateInput } from "../../application/scenario-runner/validate-scenario-input.js"
import { AccountSnapshot } from "../../domain/account/account-snapshot.js"
import { allocateOrderCommitments } from "../../domain/orders/allocate-order-commitments.js"
import { createOrderOwnership } from "../../domain/orders/order-ownership.js"
import { OrderRegistry } from "../../domain/orders/order-registry.js"
import { createMixedSellFillAllocation } from "../../domain/strategies/recovery-seller/mixed-sell-fill-allocation.js"
import {
  createMixedSellFillReconciliation,
  stageMixedSellFillAllocation,
} from "../../domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { TRADING_ENVIRONMENTS } from "../../domain/trading-environment.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../../domain/strategies/recovery-seller/legacy-position.js"
import { createRecoverySellerRuntimeDispatch } from "../../bootstrap/create-recovery-seller-runtime-dispatch.js"
import { resolveHarvesterOptions } from "../../bootstrap/config/resolve-harvester-options.js"
import { createRecoverySellerAccountingWorkflow } from "../../use-cases/create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerActionAuthorizer } from "../../use-cases/create-recovery-seller-action-authorizer.js"
import { createRecoverySellerOrderSubmitter } from "../../use-cases/create-recovery-seller-order-submitter.js"
import { createRecoverySellerStopWorkflow } from "../../use-cases/create-recovery-seller-stop-workflow.js"
import { makeOrderEventWorkflow } from "../../use-cases/order-event-workflow.js"
import { recordOrderSubmissionIntent } from "../../use-cases/record-order-submission-intent.js"
import { recordOrderSubmissionOutcome } from "../../use-cases/record-order-submission-outcome.js"
const RUNTIME_FIXTURE = Object.freeze({
  name: "Validated Recovery Seller runtime scenario fixture",
  inputSchema: Object.freeze({
    type: "object",
    required: [
      "marketPrice", "symbol", "baseAssetCode", "quoteAssetCode", "venue",
      "initialBuyPrice", "quoteBalanceFree", "priceIncrement", "quantityIncrement",
      "minQuantity", "minNotional", "investment", "orderQuantity", "sellQuantity",
      "keepQuantity", "minProfit", "priceStepPercent", "makerPercent", "takerPercent",
      "thirdAssetFeeQuoteValue", "pricePrecision", "quantityPrecision",
      "legacyInvested", "legacyQuantity", "enableVolatilityProtection", "externalOrdersPolicy",
    ],
    additionalProperties: false,
properties: Object.freeze({
      marketPrice: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      symbol: Object.freeze({
        type: "string",
        pattern: "^[A-Z0-9]{3,20}$",
      }),
      baseAssetCode: Object.freeze({
        type: "string",
        pattern: "^[A-Z0-9]{2,10}$",
      }),
      quoteAssetCode: Object.freeze({
        type: "string",
        pattern: "^[A-Z0-9]{2,10}$",
      }),
      venue: Object.freeze({
        type: "string",
        pattern: "^[a-z0-9_-]{2,32}$",
      }),
      initialBuyPrice: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      quoteBalanceFree: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      priceIncrement: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      quantityIncrement: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      minQuantity: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      minNotional: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        exclusiveMinimum: "0",
      }),
      investment: Object.freeze({
        type: "number",
      }),
      orderQuantity: Object.freeze({
        type: "number",
      }),
      sellQuantity: Object.freeze({
        type: "number",
      }),
      keepQuantity: Object.freeze({
        type: "number",
      }),
      minProfit: Object.freeze({
        type: "number",
      }),
      priceStepPercent: Object.freeze({
        type: "number",
      }),
      makerPercent: Object.freeze({
        type: "number",
      }),
      takerPercent: Object.freeze({
        type: "number",
      }),
      thirdAssetFeeQuoteValue: Object.freeze({
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
      }),
      pricePrecision: Object.freeze({
        type: "number",
      }),
      quantityPrecision: Object.freeze({
        type: "number",
      }),
      legacyInvested: Object.freeze({
        type: "number",
      }),
      legacyQuantity: Object.freeze({
        type: "number",
      }),
      enableVolatilityProtection: Object.freeze({
        type: "boolean",
      }),
      externalOrdersPolicy: Object.freeze({
        type: "string",
        pattern: "^(?:BLOCK|IGNORE)$",
      }),
    }),
  }),
  input: Object.freeze({
    marketPrice: "12.3",
    symbol: "ZROUSDT",
    baseAssetCode: "ZRO",
    quoteAssetCode: "USDT",
    venue: "binance",
    initialBuyPrice: "2",
    quoteBalanceFree: "1000",
    priceIncrement: "0.001",
    quantityIncrement: "0.01",
    minQuantity: "0.01",
    minNotional: "5",
    investment: 100,
    orderQuantity: 5,
    sellQuantity: 50,
    keepQuantity: 1,
    minProfit: 0.2,
    priceStepPercent: 0.05,
    makerPercent: 0,
    takerPercent: 0,
    thirdAssetFeeQuoteValue: "0",
    pricePrecision: 3,
    quantityPrecision: 2,
    legacyInvested: 100,
    legacyQuantity: 50,
    enableVolatilityProtection: false,
    externalOrdersPolicy: "BLOCK",
  }),
})

function assertRuntimeScenarioConfig({ input }) {
  if (input.symbol !== `${input.baseAssetCode}${input.quoteAssetCode}`) {
    throw new TypeError("Scenario symbol must match its base and quote asset codes")
  }
  const numericFields = [
    ["investment", false], ["orderQuantity", false], ["sellQuantity", false],
    ["keepQuantity", true], ["minProfit", true], ["priceStepPercent", false],
    ["makerPercent", true], ["takerPercent", true], ["pricePrecision", true],
    ["quantityPrecision", true], ["legacyInvested", false], ["legacyQuantity", false],
  ]
  for (const [field, allowZero] of numericFields) {
    const value = input[field]
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
      throw new RangeError(`Scenario configuration field ${field} must be ${allowZero ? "non-negative" : "greater than zero"}`)
    }
  }
  if (!Number.isInteger(input.pricePrecision) || !Number.isInteger(input.quantityPrecision) ||
      input.pricePrecision > 12 || input.quantityPrecision > 12) {
    throw new RangeError("Scenario market precision must be an integer between 0 and 12")
  }
}

function createRuntimeScenarioAppConfig({ input }) {
  const pair = {
    enabled: true,
    tradingEnvironment: TRADING_ENVIRONMENTS.BOTH,
    enableVolatilityProtection: input.enableVolatilityProtection,
    externalOrdersPolicy: input.externalOrdersPolicy,
    investment: input.investment,
    orderQuantity: input.orderQuantity,
    sellQuantity: input.sellQuantity,
    keepQuantity: input.keepQuantity,
    minProfit: input.minProfit,
    priceStepPercent: input.priceStepPercent,
    makerPercent: input.makerPercent,
    takerPercent: input.takerPercent,
    thirdAssetFeeQuoteValue: input.thirdAssetFeeQuoteValue,
    pricePrecision: input.pricePrecision,
    quantityPrecision: input.quantityPrecision,
    legacyPosition: {
      invested: input.legacyInvested,
      quantity: input.legacyQuantity,
    },
  }
  return {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: {
          conservative: { enabled: true },
          aggressive: { enabled: false },
        },
        pairs: {},
      },
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          [input.symbol]: pair,
        },
      },
    },
  }
}

async function resolveRuntimeScenarioConfiguration({ input }) {
  assertRuntimeScenarioConfig({ input })
  const resolved = await resolveHarvesterOptions({
    appConfig: createRuntimeScenarioAppConfig({ input }),
    env: {
      NODE_ENV: "test",
      TRADING_MODE: "testnet",
    },
    executionRoutes: [{
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: input.symbol,
    }],
    eventPublisher: {
      publish: () => ({ ok: true }),
    },
    logger: {},
  })
  const { recoverySellerPairs } = resolved
  const pairConfig = recoverySellerPairs[input.symbol]
  if (!pairConfig) {
    throw new Error(`Validated Recovery Seller configuration is unavailable for ${input.symbol}`)
  }
  return {
    recoverySellerPairs,
    pairConfig,
  }
}

function validateScenarioInput({ schema, defaults, input }) {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) {
    throw new TypeError("Scenario input overrides must be a JSON object")
  }
  const effectiveInput = {
    ...defaults,
    ...(input ?? {}),
  }
  const validation = validateInput({
    schema,
    input: effectiveInput,
  })
  if (!validation.valid) {
    throw new TypeError(validation.errors.join("; "))
  }
  return Object.freeze(effectiveInput)
}

const RUNTIME_SCENARIO_READINESS_REASONS = Object.freeze([
  "Scenario infrastructure uses a run-local simulated broker and in-memory operational store; it does not prove durable production account or STOP state.",
  "SELL intent/reservation/outcome failures, ambiguous broker placement, terminal-reconciliation persistence failure, STOP persistence failures and BUY-only STOP admission are covered; remaining infrastructure acceptance includes runner-specific retry/idempotency.",
])

export const RECOVERY_SELLER_RUNTIME_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "RS-RUNTIME-SELL-SUBMISSION-001",
    name: "Production Recovery Seller runtime submits one authorized recovery SELL",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001",
    name: "Production Recovery Seller fails closed when SELL intent persistence fails before broker placement",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001",
    name: "Production Recovery Seller fails closed when broker acknowledgement outcome persistence fails",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001",
    name: "Production Recovery Seller keeps account admission blocked when SELL outcome and STOP persistence both fail",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-BROKER-EXCEPTION-001",
    name: "Production Recovery Seller preserves an unresolved SELL after broker placement throws",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-RESERVATION-FAILURE-001",
    name: "Production Recovery Seller fails closed when sole-SELL reservation callback fails",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-REJECTION-001",
    name: "Production Recovery Seller runtime handles a rejected SELL submission",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-PARTIAL-CANCEL-001",
    name: "Production Recovery Seller runtime reconciles a profitable partial CANCELED SELL",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001",
    name: "Production Recovery Seller runtime reconciles an under-target fully FILLED SELL and latches STOP",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001",
    name: "Production Recovery Seller fails closed when terminal reconciliation persistence fails after a FILLED SELL",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001",
    name: "Production Recovery Seller fails closed when account STOP persistence fails after a FILLED SELL",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
  Object.freeze({
    id: "RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001",
    name: "Production Recovery Seller STOP blocks new BUY spending while allowing an eligible first SELL",
    layer: "APPLICATION",
    status: "PARTIAL",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: RUNTIME_SCENARIO_READINESS_REASONS,
    inputSchema: RUNTIME_FIXTURE.inputSchema,
    input: RUNTIME_FIXTURE.input,
  }),
])

function createAssertion({ name, actual, expected }) {
  return Object.freeze({
    name,
    passed: isDeepStrictEqual(actual, expected),
    actual,
    expected,
  })
}


function createRuntimeScenarioStore({
  failStopPersistence = false,
  failSubmissionIntentPersistence = false,
  failSubmissionOutcomePersistence = false,
  failTerminalReconciliationPersistence = false,
} = {}) {
  const records = []
  return {
    append: async (fact) => {
      if (failTerminalReconciliationPersistence &&
          fact.factType === "RECOVERY_SELLER_MIXED_SELL_RECONCILED") {
        return toResult({
          error: new Error("Simulated terminal SELL reconciliation persistence failure"),
        })
      }
      if (failSubmissionOutcomePersistence && fact.factType === "ORDER_SUBMISSION_OUTCOME") {
        return {
          ok: false,
          errors: [new Error("Simulated SELL submission-outcome persistence failure")],
        }
      }
      if (failSubmissionIntentPersistence && fact.factType === "ORDER_SUBMISSION_INTENT") {
        return {
          ok: false,
          errors: [new Error("Simulated SELL submission-intent persistence failure")],
        }
      }
      if (failStopPersistence && fact.factType === "SAFETY_BLOCKER_RAISED") {
        return toResult({
          error: new Error("Simulated account STOP persistence failure"),
        })
      }
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

function createRuntimeScenarioMarket({ venue, symbol, baseAssetCode, quoteAssetCode }) {
  const baseAsset = new Asset({
    id: `${venue}:${baseAssetCode}`,
    code: baseAssetCode,
  })
  const quoteAsset = new Asset({
    id: `${venue}:${quoteAssetCode}`,
    code: quoteAssetCode,
  })
  const market = new Market({
    venue,
    symbol,
    baseAsset,
    quoteAsset,
  })
  return {
    baseAsset,
    quoteAsset,
    market,
  }
}

function createRuntimeScenarioMarketMetadata({ market, baseAsset, quoteAsset, input }) {
  return {
    market,
    orderType: "LIMIT_MAKER",
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    source: "validated-scenario-market-metadata",
    tradingRules: new TradingRules({
      market,
      constraints: [
        {
          type: "PRICE_INCREMENT",
          status: "SUPPORTED",
          value: new Money({
            amount: input.priceIncrement,
            asset: quoteAsset,
          }),
        },
        {
          type: "QUANTITY_INCREMENT",
          status: "SUPPORTED",
          value: new Quantity({
            amount: input.quantityIncrement,
            asset: baseAsset,
          }),
        },
        {
          type: "MIN_QUANTITY",
          status: "SUPPORTED",
          value: new Quantity({
            amount: input.minQuantity,
            asset: baseAsset,
          }),
        },
        {
          type: "MIN_NOTIONAL",
          status: "SUPPORTED",
          value: new Money({
            amount: input.minNotional,
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
  quoteBalanceFree,
}) {
  const totalBaseQuantity = addDecimal({
    left: buyQuantity,
    right: legacyQuantity,
  })
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
          amount: quoteBalanceFree,
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
        right: buyQuoteQuantity,
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

function createRuntimeScenarioReconciliationRecorder({ operationalStateStore }) {
  return async ({
    terminalOrder,
    ownership: cycleOwnership,
    canonicalFills,
    eligible,
    accountingApplied,
  }) => operationalStateStore.append({
    factId: `rs-mixed-sell-reconciled-${terminalOrder.clientOrderId}`,
    factType: "RECOVERY_SELLER_MIXED_SELL_RECONCILED",
    data: {
      marketId: terminalOrder.market.id,
      cycleId: cycleOwnership.cycleId,
      positionId: cycleOwnership.positionId,
      clientOrderId: terminalOrder.clientOrderId,
      brokerOrderId: terminalOrder.brokerOrderId,
      terminalOrderStatus: terminalOrder.status,
      fillIds: canonicalFills.map((fillItem) => fillItem.id),
      profitabilityEligible: eligible,
      accountingApplied,
    },
  })
}

function createRuntimeScenarioWorkflowOptions({
  market,
  buyOrder,
  ownership,
  legacyInvested,
  legacyQuantity,
  operationalStateStore,
}) {
  return {
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
    onOperationalStateRecoverySellerMixedSellReconciled:
      createRuntimeScenarioReconciliationRecorder({ operationalStateStore }),
  }
}

async function createRuntimeScenarioWorkflow({
  market,
  baseAsset,
  quoteAsset,
  pairConfig,
  initialBuyPrice,
  operationalStateStore,
}) {
  const buyQuantity = String(pairConfig.orderQuantity)
  const buyPrice = initialBuyPrice
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
  const workflow = createRecoverySellerAccountingWorkflow(
    createRuntimeScenarioWorkflowOptions({
      market,
      buyOrder,
      ownership,
      legacyInvested,
      legacyQuantity,
      operationalStateStore,
    }),
  )
  const fill = createRuntimeScenarioBuyFill({
    market,
    baseAsset,
    quoteAsset,
    buyOrder,
    buyQuantity,
    buyPrice,
    buyQuoteQuantity,
  })
  const applied = await workflow.applyBuyFill({ fill })
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

function createRuntimeScenarioBroker({ market, baseAsset, quoteAsset, runId, rejectSellSubmission = false, throwSellSubmission = false }) {
  let submissionCallCount = 0
  return {
    getSubmissionCallCount: () => submissionCallCount,
    broker: {
      providerInstanceId: "scenario-runner-simulation",
      providerType: "simulation",
      accountId: `scenario-${runId}`,
      placeOrder: async ({ order }) => {
        submissionCallCount += 1
        if (rejectSellSubmission && order.side === "SELL") {
          return {
            ok: false,
            errors: [new Error("Simulated exchange rejection of Recovery Seller SELL")],
          }
        }
        if (throwSellSubmission && order.side === "SELL") {
          throw new Error("Simulated broker transport failure after SELL placement attempt")
        }
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
  scenarioId,
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
      if (scenarioId === "RS-RUNTIME-SELL-RESERVATION-FAILURE-001") {
        return toResult({
          error: new Error("Simulated sole-SELL reservation callback failure"),
        })
      }
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

function createRuntimeScenarioAuthorizer({
  workflow,
  stopWorkflow,
  accountSnapshot,
  recoverySellerPairs,
}) {
  const state = {
    get registry() {
      return workflow.getOrderRegistry()
    },
  }
  return createRecoverySellerActionAuthorizer({
    state,
    recoverySellerPairs,
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

async function createRuntimeScenarioState({
  market,
  baseAsset,
  quoteAsset,
  pairConfig,
  effectiveInput,
  scenarioId,
}) {
  const operationalStateStore = createRuntimeScenarioStore({
    failStopPersistence: scenarioId === "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001" ||
      scenarioId === "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001",
    failSubmissionIntentPersistence: scenarioId === "RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001",
    failSubmissionOutcomePersistence: scenarioId === "RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001" ||
      scenarioId === "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001",
    failTerminalReconciliationPersistence:
      scenarioId === "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001",
  })
  const marketMetadata = createRuntimeScenarioMarketMetadata({
    market,
    baseAsset,
    quoteAsset,
    input: effectiveInput,
  })
  const seed = await createRuntimeScenarioWorkflow({
    market,
    baseAsset,
    quoteAsset,
    pairConfig,
    initialBuyPrice: effectiveInput.initialBuyPrice,
    operationalStateStore,
  })
  const accountSnapshot = createRuntimeScenarioAccountSnapshot({
    baseAsset,
    quoteAsset,
    buyQuantity: seed.buyQuantity,
    legacyQuantity: seed.legacyQuantity,
    buyQuoteQuantity: seed.buyQuoteQuantity,
    quoteBalanceFree: effectiveInput.quoteBalanceFree,
  })
  return {
    operationalStateStore,
    marketMetadata,
    seed,
    accountSnapshot,
  }
}

async function createRuntimeScenarioExecutionPorts({
  runId,
  scenarioId,
  market,
  baseAsset,
  quoteAsset,
  recoverySellerPairs,
  seed,
  accountSnapshot,
  operationalStateStore,
  marketMetadata,
}) {
  const stopWorkflow = await createRuntimeScenarioStopWorkflow({
    operationalStateStore,
  })
  const { broker, getSubmissionCallCount } = createRuntimeScenarioBroker({
    market,
    baseAsset,
    quoteAsset,
    runId,
    rejectSellSubmission: scenarioId === "RS-RUNTIME-SELL-REJECTION-001",
    throwSellSubmission: scenarioId === "RS-RUNTIME-SELL-BROKER-EXCEPTION-001",
  })
  const submitter = createRuntimeScenarioSubmitter({
    broker,
    workflow: seed.workflow,
    stopWorkflow,
    operationalStateStore,
    scenarioId,
  })
  const authorize = createRuntimeScenarioAuthorizer({
    workflow: seed.workflow,
    stopWorkflow,
    accountSnapshot,
    recoverySellerPairs,
  })
  const dispatch = createRecoverySellerRuntimeDispatch({
    recoverySellerWorkflow: seed.workflow,
    recoverySellerStopWorkflow: stopWorkflow,
    recoverySellerPairs,
    getRecoverySellerMarketMetadata: async () => marketMetadata,
    getAccountSnapshot: async () => accountSnapshot,
  })
  return {
    stopWorkflow,
    submitter,
    authorize,
    dispatch,
    getSubmissionCallCount,
  }
}

async function createRuntimeScenarioContext({ runId, scenarioId, effectiveInput }) {
  const { recoverySellerPairs, pairConfig } = await resolveRuntimeScenarioConfiguration({
    input: effectiveInput,
  })
  const { baseAsset, quoteAsset, market } = createRuntimeScenarioMarket({
    venue: effectiveInput.venue,
    symbol: effectiveInput.symbol,
    baseAssetCode: effectiveInput.baseAssetCode,
    quoteAssetCode: effectiveInput.quoteAssetCode,
  })
  const state = await createRuntimeScenarioState({
    market,
    baseAsset,
    quoteAsset,
    pairConfig,
    effectiveInput,
    scenarioId,
  })
  const ports = await createRuntimeScenarioExecutionPorts({
    runId,
    scenarioId,
    market,
    baseAsset,
    quoteAsset,
    recoverySellerPairs,
    ...state,
  })
  return {
    market,
    baseAsset,
    quoteAsset,
    pairConfig,
    recoverySellerPairs,
    ...state,
    ...ports,
  }
}

async function executeRuntimeScenarioDispatch({
  runtime,
  effectiveInput,
  expectRejection = false,
  expectBlocked = false,
}) {
  let submittedAction
  const dispatchResult = await runtime.dispatch({
    symbol: runtime.market.symbol,
    state: {
      prices: new Map([[runtime.market.symbol, {
        symbol: runtime.market.symbol,
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
  if (dispatchResult?.ok !== true && !expectRejection && !expectBlocked) {
    throw dispatchResult?.errors?.[0] ?? new Error("Production Recovery Seller runtime evaluation failed")
  }
  return {
    data: dispatchResult?.data ?? {},
    submittedAction,
    submissionRejected: dispatchResult?.ok !== true,
  }
}

function createRuntimeScenarioPartialSellOrder({ runtime, openOrder, partialQuantity }) {
  return new CanonicalOrder({
    clientOrderId: openOrder.clientOrderId,
    brokerOrderId: openOrder.brokerOrderId,
    providerInstanceId: openOrder.providerInstanceId,
    providerType: openOrder.providerType,
    accountId: openOrder.accountId,
    market: openOrder.market,
    side: openOrder.side,
    type: openOrder.type,
    limitPrice: openOrder.limitPrice,
    originalQuantity: openOrder.originalQuantity,
    executedQuantity: new Quantity({
      amount: partialQuantity,
      asset: runtime.baseAsset,
    }),
    status: "CANCELED",
    createdAt: openOrder.createdAt,
    acknowledgedAt: openOrder.acknowledgedAt,
    updatedAt: openOrder.updatedAt + 1,
    completedAt: openOrder.updatedAt + 2,
  })
}

function createRuntimeScenarioFilledSellOrder({ runtime, openOrder }) {
  return new CanonicalOrder({
    clientOrderId: openOrder.clientOrderId,
    brokerOrderId: openOrder.brokerOrderId,
    providerInstanceId: openOrder.providerInstanceId,
    providerType: openOrder.providerType,
    accountId: openOrder.accountId,
    market: openOrder.market,
    side: openOrder.side,
    type: openOrder.type,
    limitPrice: openOrder.limitPrice,
    originalQuantity: openOrder.originalQuantity,
    executedQuantity: new Quantity({
      amount: openOrder.originalQuantity.amount,
      asset: runtime.baseAsset,
    }),
    status: "FILLED",
    createdAt: openOrder.createdAt,
    acknowledgedAt: openOrder.acknowledgedAt,
    updatedAt: openOrder.updatedAt + 1,
    completedAt: openOrder.updatedAt + 2,
  })
}

function createRuntimeScenarioPartialSellFill({ runtime, terminalOrder, partialQuantity, sellPrice }) {
  const quoteQuantity = multiplyDecimal({
    left: partialQuantity,
    right: sellPrice,
  })
  return new Fill({
    tradeId: "rs-scenario-partial-sell-fill-1",
    brokerOrderId: terminalOrder.brokerOrderId,
    clientOrderId: terminalOrder.clientOrderId,
    market: runtime.market,
    side: "SELL",
    price: new Money({
      amount: sellPrice,
      asset: runtime.quoteAsset,
    }),
    quantity: new Quantity({
      amount: partialQuantity,
      asset: runtime.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: runtime.quoteAsset,
    }),
    executedAt: terminalOrder.completedAt,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createRuntimeScenarioFilledSellFill({ runtime, terminalOrder }) {
  const executedQuantity = terminalOrder.executedQuantity.amount
  const sellPrice = terminalOrder.limitPrice.amount
  const quoteQuantity = multiplyDecimal({
    left: executedQuantity,
    right: sellPrice,
  })
  const totalCostBasis = addDecimal({
    left: runtime.seed.buyQuoteQuantity,
    right: String(runtime.pairConfig.legacyPosition.invested),
  })
  const remainingQuoteProceeds = compareDecimal({
    left: totalCostBasis,
    right: "0.02",
  }) > 0
    ? "0.01"
    : multiplyDecimal({
        left: totalCostBasis,
        right: "0.5",
      })
  const quoteCommissionAmount = compareDecimal({
    left: quoteQuantity,
    right: remainingQuoteProceeds,
  }) > 0
    ? subtractDecimal({
        left: quoteQuantity,
        right: remainingQuoteProceeds,
      })
    : "0"
  return new Fill({
    tradeId: "rs-scenario-filled-sell-fill-1",
    brokerOrderId: terminalOrder.brokerOrderId,
    clientOrderId: terminalOrder.clientOrderId,
    market: runtime.market,
    side: "SELL",
    price: new Money({
      amount: sellPrice,
      asset: runtime.quoteAsset,
    }),
    quantity: new Quantity({
      amount: executedQuantity,
      asset: runtime.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: runtime.quoteAsset,
    }),
    executedAt: terminalOrder.completedAt,
    commissions: [
      new Commission({
        amount: new Money({
          amount: quoteCommissionAmount,
          asset: runtime.quoteAsset,
        }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function createRuntimeScenarioTerminalSellResult({
  runtime,
  terminalOrder,
  result,
  eventResult,
  stagedSellFills,
  pauses,
}) {
  const cycleState = runtime.seed.workflow.getCycleStateForMarket({
    marketId: runtime.market.id,
  })
  return {
    clientOrderId: terminalOrder.clientOrderId,
    orderStatus: terminalOrder.status,
    executedQuantity: terminalOrder.executedQuantity.amount,
    profitabilityEligible: result?.data?.profitability?.eligible === true,
    terminalReconciliationFailed: result?.ok === false,
    terminalReconciliationError: result?.errors?.[0]?.message ?? null,
    terminalReconciled: result?.ok === true && cycleState?.terminalReconciled === true,
    eventWorkflowFailedClosed: eventResult?.ok === false,
    marketPaused: pauses.some((pause) => pause.symbol === runtime.market.symbol),
    pauseReasons: pauses.map((pause) => pause.reason),
    stopFactAppended: runtime.operationalStateStore.getRecords().some((fact) =>
      fact.factType === "SAFETY_BLOCKER_RAISED" && fact.data?.scope === "ACCOUNT"),
    stopPersistenceFailed: pauses.some((pause) =>
      pause.error?.message?.includes("global STOP could not be confirmed")),
    buyAdmissionBlocked: runtime.stopWorkflow.isBuyAdmissionBlocked(),
    sellAdmissionBlocked: runtime.stopWorkflow.isSellAdmissionBlocked(),
    postFailureBuyAdmissionBlocked: false,
    postFailureSellAdmissionBlocked: false,
    postFailureSubmittedOrderCount: 0,
    postFailureActionSubmitted: false,
    eventFillStaged: stagedSellFills.length === 1,
    stagedSellFillCount: stagedSellFills.length,
    cycleState,
  }
}

function createRuntimeScenarioEventState({ orderRegistry }) {
  return {
    registry: orderRegistry,
    unrequestedTerminalOrderClientIds: new Set(),
    reconciledTerminalOrderClientIds: new Set(),
    completedOrderTransitions: new Set(),
    shutdownRecoveryReplanSymbols: new Set(),
    completedRecoverySellSymbols: new Set(),
    completedRecoverySellOrdersBySymbol: new Map(),
    replacementIntents: new Set(),
    deferredEvaluations: new Set(),
    trailingBuy: new Map(),
    buyReferenceOverrides: new Map(),
    lastBuyPrices: new Map(),
    buyExecutionTotals: new Map(),
    sellExecutionTotals: new Map(),
    processedFillsByOrder: new Map(),
  }
}

function createRuntimeScenarioMixedSellReconciler({
  runtime,
  state,
  setTerminalAccountingResult,
  fullCycle = false,
}) {
  return async ({ order: reconciledOrder, canonicalFills }) => {
    const currentOpenOrder = state.registry.getOrder({
      clientOrderId: reconciledOrder.clientOrderId,
    })
    let reconciliation = createMixedSellFillReconciliation({
      order: currentOpenOrder,
      orderRegistry: state.registry,
    })
    const allocations = canonicalFills.map((canonicalFill) =>
      createMixedSellFillAllocation({
        fill: canonicalFill,
        orderRegistry: state.registry,
        recoveryQuantity: fullCycle ? runtime.seed.buyQuantity : "2.49",
        legacyQuantity: fullCycle ? runtime.seed.legacyQuantity : "0.01",
      }))
    for (const allocation of allocations) {
      ({ reconciliation } = stageMixedSellFillAllocation({
        reconciliation,
        allocation,
      }))
    }
    const result = await runtime.seed.workflow.reconcileTerminalMixedSell({
      reconciliation,
      terminalOrder: reconciledOrder,
      canonicalFills,
      canonicalFillAllocations: allocations,
      minProfit: "0.2",
    })
    setTerminalAccountingResult(result)
    return result
  }
}

function createRuntimeScenarioEventBroker({ fill }) {
  return {
    getFills: async () => toResult({
      data: [fill],
    }),
  }
}

function createRuntimeScenarioEventPublisher() {
  return {
    publish: () => toResult({
      data: {
        accepted: true,
      },
    }),
  }
}

function createRuntimeScenarioEventAccountingPorts({ stagedSellFills }) {
  return {
    updateTradingAccounting: async () => toResult({
      data: {
        applied: true,
        duplicate: false,
      },
    }),
    updateRecoverySellerAccounting: async () => toResult({
      data: {
        applied: true,
        duplicate: false,
      },
    }),
    recordBuyExecutionFill: () => {},
    recordSellExecutionFill: ({ fill: stagedFill }) => stagedSellFills.push(stagedFill),
  }
}

function createRuntimeScenarioEventControlPorts({ pauses }) {
  return {
    pause: async (input) => pauses.push(input),
    resolveRecoveryManagedCancellation: () => false,
    cancelAndReconcileRecoverySells: async () => toResult({
      data: {},
    }),
    evaluateLatestTransition: async () => toResult({
      data: {},
    }),
    getReconciledBuyExecutionPrice: () => "2",
    assertReconciledSellExecution: () => {},
    completeRecoveryCycle: async () => toResult({
      data: {
        eligible: true,
        freeQuantity: "0",
        realizedNetProfit: "0",
      },
    }),
    publishRecoveryCycleNotCompleted: () => {},
    isStopping: () => false,
    onUnownedExternalOrderObserved: () => {},
  }
}

function createRuntimeScenarioEventSafetyPorts({ runtime, reconcileRecoverySellerMixedSell }) {
  return {
    reconcileRecoverySellerMixedSell,
    latchRecoverySellerStop: async ({ order, reason, error }) => runtime.stopWorkflow.latch({
      explanation: `Scenario Runner terminal reconciliation failed: ${reason}: ${error?.message ?? "unknown"}`,
      orderIdentity: {
        clientOrderId: order.clientOrderId,
        ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
      },
    }),
  }
}

function createRuntimeScenarioOrderEventWorkflow({
  runtime,
  eventState,
  fill,
  stagedSellFills,
  pauses,
  reconcileRecoverySellerMixedSell,
}) {
  return makeOrderEventWorkflow({
    state: eventState,
    broker: createRuntimeScenarioEventBroker({ fill }),
    pairs: {
      [runtime.market.symbol]: runtime.pairConfig,
    },
    eventPublisher: createRuntimeScenarioEventPublisher(),
    ...createRuntimeScenarioEventAccountingPorts({
      stagedSellFills,
    }),
    ...createRuntimeScenarioEventControlPorts({
      pauses,
    }),
    ...createRuntimeScenarioEventSafetyPorts({
      runtime,
      reconcileRecoverySellerMixedSell,
    }),
  })
}
function isExpectedTerminalReconciliationPersistenceFailure({
  eventResult,
  terminalAccountingResult,
  stopPersisted,
  expectedStopPersisted,
  expectedTerminalReconciliationFailure,
}) {
  return expectedTerminalReconciliationFailure &&
    eventResult?.ok === false &&
    terminalAccountingResult?.ok === false &&
    stopPersisted === expectedStopPersisted
}

function isExpectedTerminalSellStop({ eventResult, terminalAccountingResult, stopPersisted, expectedStopPersisted }) {
  return eventResult?.ok === false &&
    terminalAccountingResult?.ok === true &&
    stopPersisted === expectedStopPersisted
}

function assertRuntimeScenarioTerminalSellReconciled({
  eventResult,
  terminalAccountingResult,
  runtime,
  expectedStopPersisted = true,
  expectedTerminalReconciliationFailure = false,
}) {
  const stopPersisted = runtime.operationalStateStore.getRecords().some((fact) =>
    fact.factType === "SAFETY_BLOCKER_RAISED" && fact.data?.scope === "ACCOUNT")
  if (isExpectedTerminalReconciliationPersistenceFailure({
    eventResult,
    terminalAccountingResult,
    stopPersisted,
    expectedStopPersisted,
    expectedTerminalReconciliationFailure,
  })) {
    return
  }
  if (isExpectedTerminalSellStop({
    eventResult,
    terminalAccountingResult,
    stopPersisted,
    expectedStopPersisted,
  })) {
    return
  }
  throw eventResult?.errors?.[0] ??
    terminalAccountingResult?.errors?.[0] ??
    new Error("Production Recovery Seller terminal SELL did not fail closed with the expected account STOP persistence outcome")
}

function resolveSubmittedRuntimeSellOrder({ runtime, execution }) {
  const [submittedOrder] = execution.data.submittedOrders ?? []
  if (!submittedOrder) {
    throw new Error("Terminal SELL scenario requires the production runtime to acknowledge its SELL order")
  }
  const orderRegistry = runtime.seed.workflow.getOrderRegistry()
  const openOrder = orderRegistry.getOrder({
    clientOrderId: submittedOrder.clientOrderId,
  })
  if (!openOrder) {
    throw new Error("Terminal SELL scenario cannot find its acknowledged canonical SELL order")
  }
  return {
    orderRegistry,
    openOrder,
  }
}

async function processRuntimeScenarioTerminalSellEvent({ eventWorkflow, terminalOrder, fill }) {
  return eventWorkflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: terminalOrder,
      fill,
    },
  })
}

async function reconcileRuntimeScenarioTerminalSell({
  runtime,
  orderRegistry,
  terminalOrder,
  fill,
  fullCycle = false,
  expectedStopPersisted = true,
  expectedTerminalReconciliationFailure = false,
}) {
  const stagedSellFills = []
  const pauses = []
  let terminalAccountingResult
  const eventState = createRuntimeScenarioEventState({
    orderRegistry,
  })
  const reconcileRecoverySellerMixedSell = createRuntimeScenarioMixedSellReconciler({
    runtime,
    state: eventState,
    fullCycle,
    setTerminalAccountingResult: (result) => {
      terminalAccountingResult = result
    },
  })
  const eventWorkflow = createRuntimeScenarioOrderEventWorkflow({
    runtime,
    eventState,
    fill,
    stagedSellFills,
    pauses,
    reconcileRecoverySellerMixedSell,
  })
  const eventResult = await processRuntimeScenarioTerminalSellEvent({
    eventWorkflow,
    terminalOrder,
    fill,
  })
  assertRuntimeScenarioTerminalSellReconciled({
    eventResult,
    terminalAccountingResult,
    runtime,
    expectedStopPersisted,
    expectedTerminalReconciliationFailure,
  })
  return createRuntimeScenarioTerminalSellResult({
    runtime,
    terminalOrder,
    result: terminalAccountingResult,
    eventResult,
    stagedSellFills,
    pauses,
  })
}

async function reconcileRuntimeScenarioPartialSell({ runtime, execution }) {
  const { orderRegistry, openOrder } = resolveSubmittedRuntimeSellOrder({
    runtime,
    execution,
  })
  const partialQuantity = "2.5"
  const terminalOrder = createRuntimeScenarioPartialSellOrder({
    runtime,
    openOrder,
    partialQuantity,
  })
  const fill = createRuntimeScenarioPartialSellFill({
    runtime,
    terminalOrder,
    partialQuantity,
    sellPrice: openOrder.limitPrice.amount,
  })
  return reconcileRuntimeScenarioTerminalSell({
    runtime,
    orderRegistry,
    terminalOrder,
    fill,
  })
}

async function reconcileRuntimeScenarioFilledSell({
  runtime,
  execution,
  stopPersistenceFailure = false,
  terminalReconciliationPersistenceFailure = false,
}) {
  const { orderRegistry, openOrder } = resolveSubmittedRuntimeSellOrder({
    runtime,
    execution,
  })
  const terminalOrder = createRuntimeScenarioFilledSellOrder({
    runtime,
    openOrder,
  })
  const fill = createRuntimeScenarioFilledSellFill({
    runtime,
    terminalOrder,
  })
  return reconcileRuntimeScenarioTerminalSell({
    runtime,
    orderRegistry,
    terminalOrder,
    fill,
    fullCycle: true,
    expectedStopPersisted: !stopPersistenceFailure,
    expectedTerminalReconciliationFailure: terminalReconciliationPersistenceFailure,
  })
}
function createRuntimeScenarioOutput({
  runtime,
  data,
  submittedAction,
  submissionRejected = false,
  terminalSell = null,
  stopAdmissionChecks = null,
}) {
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
    submissionRejected,
    stopFactAppended: runtime.operationalStateStore.getRecords().some((fact) =>
      fact.factType === "SAFETY_BLOCKER_RAISED"),
    buyAdmissionBlocked: runtime.stopWorkflow.isBuyAdmissionBlocked(),
    sellAdmissionBlocked: runtime.stopWorkflow.isSellAdmissionBlocked(),
    brokerSubmissionCallCount: runtime.getSubmissionCallCount(),
    terminalSell,
    stopAdmissionChecks,
    submittedOrders,
    reservedSellCycle,
    simulationFacts: runtime.operationalStateStore.getRecords().map((fact) => ({
      factId: fact.factId,
      factType: fact.factType,
      data: fact.data,
    })),
  }
}

function createRuntimeScenarioSellExpectedBase({ seed, pairConfig }) {
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

function createRuntimeScenarioTerminalSellExpected({
  seed,
  pairConfig,
  terminalOrderStatus,
  profitabilityEligible,
  stopFactAppended = true,
  stopPersistenceFailure = false,
}) {
  const expected = {
    ...createRuntimeScenarioSellExpectedBase({
      seed,
      pairConfig,
    }),
    terminalOrderStatus,
    terminalCycleStatus: "UNRESOLVED",
    terminalReconciled: true,
    profitabilityEligible,
    reservationReleased: true,
    stopFactAppended,
    eventWorkflowFailedClosed: true,
    marketPaused: true,
    buyAdmissionBlocked: true,
    sellAdmissionBlocked: stopPersistenceFailure,
  }
  if (stopPersistenceFailure) {
    Object.assign(expected, {
      stopPersistenceFailed: true,
      postFailureBuyAdmissionBlocked: true,
      postFailureSellAdmissionBlocked: true,
      postFailureSubmittedOrderCount: 0,
      postFailureActionSubmitted: false,
    })
  }
  return expected
}

function createRuntimeScenarioSubmissionPersistenceFailureExpectation({
  failureField,
  stopFactAppended,
  reservationRetained,
  brokerSubmissionCallCount,
  buyAdmissionBlocked,
  sellAdmissionBlocked,
} = {}) {
  return {
    [failureField]: true,
    submissionRejected: true,
    submittedOrderCount: 0,
    stopFactAppended,
    reservationRetained,
    brokerSubmissionCallCount,
    buyAdmissionBlocked,
    sellAdmissionBlocked,
  }
}

function createRuntimeScenarioSubmissionPersistenceFailureExpected({ scenarioId }) {
  const expectations = {
    "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001": () =>
      createRuntimeScenarioSubmissionPersistenceFailureExpectation({
        failureField: "submissionOutcomePersistenceFailed",
        stopFactAppended: false,
        reservationRetained: true,
        brokerSubmissionCallCount: 1,
        buyAdmissionBlocked: true,
        sellAdmissionBlocked: true,
      }),
    "RS-RUNTIME-SELL-RESERVATION-FAILURE-001": () =>
      createRuntimeScenarioSubmissionPersistenceFailureExpectation({
        failureField: "submissionReservationFailure",
        stopFactAppended: true,
        reservationRetained: false,
        brokerSubmissionCallCount: 0,
        buyAdmissionBlocked: true,
        sellAdmissionBlocked: false,
      }),
    "RS-RUNTIME-SELL-BROKER-EXCEPTION-001": () =>
      createRuntimeScenarioSubmissionPersistenceFailureExpectation({
        failureField: "submissionOutcomeUnknown",
        stopFactAppended: true,
        reservationRetained: true,
        brokerSubmissionCallCount: 1,
        buyAdmissionBlocked: true,
        sellAdmissionBlocked: false,
      }),
    "RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001": () =>
      createRuntimeScenarioSubmissionPersistenceFailureExpectation({
        failureField: "submissionOutcomePersistenceFailed",
        stopFactAppended: true,
        reservationRetained: true,
        brokerSubmissionCallCount: 1,
        buyAdmissionBlocked: true,
        sellAdmissionBlocked: false,
      }),
    "RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001": () =>
      createRuntimeScenarioSubmissionPersistenceFailureExpectation({
        failureField: "submissionIntentPersistenceFailed",
        stopFactAppended: true,
        reservationRetained: false,
        brokerSubmissionCallCount: 0,
        buyAdmissionBlocked: true,
        sellAdmissionBlocked: false,
      }),
  }
  return expectations[scenarioId]?.() ?? null
}
function createRuntimeScenarioStopAdmissionExpected({ seed, pairConfig }) {
  return {
    decisionOutcome: "SUBMIT",
    actionSide: "SELL",
    actionQuantity: addDecimal({
      left: seed.buyQuantity,
      right: String(pairConfig.sellQuantity),
    }),
    submittedOrderCount: 1,
    reservationMatchesSubmittedOrder: true,
    stopAdmissionChecks: {
      sellActionSide: "SELL",
      stopStateStatus: "STOPPED",
      buyAdmissionBlocked: true,
      sellAdmissionBlocked: false,
    },
  }
}

function createTerminalReconciliationPersistenceFailureExpected({ seed, pairConfig }) {
  return {
    ...createRuntimeScenarioSellExpectedBase({
      seed,
      pairConfig,
    }),
    terminalOrderStatus: "FILLED",
    terminalReconciliationFailed: true,
    terminalReconciled: false,
    eventWorkflowFailedClosed: true,
    stopFactAppended: true,
    marketPaused: true,
    buyAdmissionBlocked: true,
    sellAdmissionBlocked: false,
    reservationRetained: true,
    stagedSellFillCount: 1,
  }
}

function createRuntimeScenarioExpected({ seed, pairConfig, scenarioId }) {
  const submissionPersistenceExpected = createRuntimeScenarioSubmissionPersistenceFailureExpected({
    scenarioId,
  })
  if (submissionPersistenceExpected) {
    return submissionPersistenceExpected
  }
  if (scenarioId === "RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001") {
    return createRuntimeScenarioStopAdmissionExpected({
      seed,
      pairConfig,
    })
  }
  if (scenarioId === "RS-RUNTIME-SELL-REJECTION-001") {
    return {
      submissionRejected: true,
      submittedOrderCount: 0,
      stopFactAppended: true,
      reservationRetained: true,
    }
  }
  if (scenarioId === "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001") {
    return createTerminalReconciliationPersistenceFailureExpected({
      seed,
      pairConfig,
    })
  }
  if (scenarioId === "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001") {
    return createRuntimeScenarioTerminalSellExpected({
      seed,
      pairConfig,
      terminalOrderStatus: "FILLED",
      profitabilityEligible: false,
      stopFactAppended: false,
      stopPersistenceFailure: true,
    })
  }
  if (scenarioId === "RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001") {
    return createRuntimeScenarioTerminalSellExpected({
      seed,
      pairConfig,
      terminalOrderStatus: "FILLED",
      profitabilityEligible: false,
    })
  }
  if (scenarioId === "RS-RUNTIME-SELL-PARTIAL-CANCEL-001") {
    return createRuntimeScenarioTerminalSellExpected({
      seed,
      pairConfig,
      terminalOrderStatus: "CANCELED",
      profitabilityEligible: true,
    })
  }
  return createRuntimeScenarioSellExpectedBase({
    seed,
    pairConfig,
  })
}

function createRejectedSellAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "production SELL submitter observes the simulated broker rejection",
      actual: output.submissionRejected,
      expected: true,
    }),
    createAssertion({
      name: "rejected SELL does not fabricate an acknowledged order",
      actual: output.submittedOrders.length,
      expected: expected.submittedOrderCount,
    }),
    createAssertion({
      name: "production STOP workflow appends an account-scope blocker to the run-local store",
      actual: output.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "the rejected SELL reservation remains retained pending reconciliation",
      actual: output.reservedSellCycle !== null,
      expected: expected.reservationRetained,
    }),
  ]
}

function createSubmittedSellAssertions({ output, expected }) {
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
      expected: expected.reservationMatchesSubmittedOrder,
    }),
  ]
}

function createPartialSellSafetyAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "production order-event workflow fails closed after terminal SELL",
      actual: output.terminalSell?.eventWorkflowFailedClosed,
      expected: expected.eventWorkflowFailedClosed,
    }),
    createAssertion({
      name: "run-local STOP fact persistence matches the scenario outcome",
      actual: output.terminalSell?.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "production order-event workflow pauses the affected market after terminal SELL STOP",
      actual: output.terminalSell?.marketPaused,
      expected: expected.marketPaused,
    }),
    createAssertion({
      name: "RS BUY admission remains blocked after terminal SELL STOP",
      actual: output.terminalSell?.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "RS SELL admission remains closed only while STOP persistence is unverified",
      actual: output.terminalSell?.sellAdmissionBlocked,
      expected: expected.sellAdmissionBlocked,
    }),
    createAssertion({
      name: "the BUY admission gate remains blocked after terminal SELL STOP",
      actual: output.terminalSell?.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "terminal SELL releases the terminal order reservation after fill reconciliation",
      actual: output.reservedSellCycle === null,
      expected: expected.reservationReleased,
    }),
  ]
}

function createStopPersistenceFailureAssertions({ output, expected }) {
  if (expected.stopPersistenceFailed !== true) {
    return []
  }
  return [
    createAssertion({
      name: "the terminal workflow reports that durable account STOP could not be confirmed",
      actual: output.terminalSell?.stopPersistenceFailed,
      expected: true,
    }),
    createAssertion({
      name: "the production runtime keeps RS BUY admission blocked after STOP persistence fails",
      actual: output.terminalSell?.postFailureBuyAdmissionBlocked,
      expected: expected.postFailureBuyAdmissionBlocked,
    }),
    createAssertion({
      name: "the production runtime keeps RS SELL admission blocked after STOP persistence fails",
      actual: output.terminalSell?.postFailureSellAdmissionBlocked,
      expected: expected.postFailureSellAdmissionBlocked,
    }),
    createAssertion({
      name: "the production runtime submits no follow-up order after STOP persistence fails",
      actual: output.terminalSell?.postFailureSubmittedOrderCount,
      expected: 0,
    }),
    createAssertion({
      name: "the production runtime creates no follow-up order action",
      actual: output.terminalSell?.postFailureActionSubmitted,
      expected: false,
    }),
  ]
}

function createRuntimeScenarioSellSubmissionAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "production runtime selects the authorized SELL action",
      actual: output.decision?.outcome,
      expected: expected.decisionOutcome,
    }),
    createAssertion({
      name: "SELL action uses the approved side and quantity",
      actual: {
        side: output.action?.side,
        quantity: output.action?.quantity,
      },
      expected: {
        side: expected.actionSide,
        quantity: expected.actionQuantity,
      },
    }),
    createAssertion({
      name: "simulation broker acknowledges exactly one order",
      actual: output.submittedOrders.length,
      expected: expected.submittedOrderCount,
    }),
  ]
}

function createTerminalReconciliationPersistenceEvidenceAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "canonical SELL fill is staged once for reconciliation",
      actual: output.terminalSell?.stagedSellFillCount,
      expected: expected.stagedSellFillCount,
    }),
    createAssertion({
      name: "sole-SELL reservation remains held until reconciliation commits",
      actual: output.reservedSellCycle?.clientOrderId === output.terminalSell?.clientOrderId,
      expected: expected.reservationRetained,
    }),
    createAssertion({
      name: "terminal reconciliation exposes a durable persistence error",
      actual: typeof output.terminalSell?.terminalReconciliationError === "string" &&
        output.terminalSell.terminalReconciliationError.length > 0,
      expected: true,
    }),
  ]
}

function createTerminalReconciliationPersistenceFailureAssertions({ output, expected }) {
  return [
    ...createRuntimeScenarioSellSubmissionAssertions({
      output,
      expected,
    }),
    createAssertion({
      name: "terminal broker result remains FILLED after reconciliation persistence fails",
      actual: output.terminalSell?.orderStatus,
      expected: expected.terminalOrderStatus,
    }),
    createAssertion({
      name: "terminal reconciliation persistence failure is surfaced",
      actual: output.terminalSell?.terminalReconciliationFailed,
      expected: expected.terminalReconciliationFailed,
    }),
    createAssertion({
      name: "failed durable reconciliation is not reported as committed",
      actual: output.terminalSell?.terminalReconciled,
      expected: expected.terminalReconciled,
    }),
    createAssertion({
      name: "production order-event workflow fails closed after reconciliation persistence failure",
      actual: output.terminalSell?.eventWorkflowFailedClosed,
      expected: expected.eventWorkflowFailedClosed,
    }),
    createAssertion({
      name: "terminal reconciliation persistence failure latches an account STOP",
      actual: output.terminalSell?.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "terminal reconciliation persistence failure pauses the affected market",
      actual: output.terminalSell?.marketPaused,
      expected: expected.marketPaused,
    }),
    createAssertion({
      name: "RS BUY admission remains blocked after terminal reconciliation persistence fails",
      actual: output.terminalSell?.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "durable RS STOP leaves the first recovery SELL gate available",
      actual: output.terminalSell?.sellAdmissionBlocked,
      expected: expected.sellAdmissionBlocked,
    }),
    createAssertion({
      name: "BUY admission remains blocked after terminal reconciliation persistence fails",
      actual: output.terminalSell?.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    ...createTerminalReconciliationPersistenceEvidenceAssertions({
      output,
      expected,
    }),
  ]
}

function createPartialSellAssertions({ output, expected }) {
  if (expected.terminalReconciliationFailed === true) {
    return createTerminalReconciliationPersistenceFailureAssertions({
      output,
      expected,
    })
  }
  return createStandardPartialSellAssertions({
    output,
    expected,
  })
}

function createStandardPartialSellAssertions({ output, expected }) {
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
      name: "terminal SELL preserves the broker terminal status",
      actual: output.terminalSell?.orderStatus,
      expected: expected.terminalOrderStatus,
    }),
    createAssertion({
      name: "terminal SELL leaves the cycle unresolved",
      actual: output.terminalSell?.cycleState?.status,
      expected: expected.terminalCycleStatus,
    }),
    createAssertion({
      name: "terminal SELL is completely reconciled",
      actual: output.terminalSell?.cycleState?.terminalReconciled,
      expected: expected.terminalReconciled,
    }),
    createAssertion({
      name: "production order-event workflow stages the canonical SELL fill",
      actual: output.terminalSell?.stagedSellFillCount,
      expected: 1,
    }),
    createAssertion({
      name: "terminal SELL preserves its profitability result without closing an unresolved cycle",
      actual: output.terminalSell?.cycleState?.profitabilityEligible,
      expected: expected.profitabilityEligible,
    }),
    ...createPartialSellSafetyAssertions({
      output,
      expected,
    }),
    ...createStopPersistenceFailureAssertions({
      output,
      expected,
    }),
  ]
}

function createStopAdmissionAssertions({ output, expected }) {
  if (!expected.stopAdmissionChecks) {
    return []
  }
  return [
    createAssertion({
      name: "latched STOP permits an otherwise eligible first recovery SELL",
      actual: output.stopAdmissionChecks?.sellActionSide,
      expected: expected.stopAdmissionChecks.sellActionSide,
    }),
    createAssertion({
      name: "the STOP remains latched after the eligible SELL is submitted",
      actual: output.stopAdmissionChecks?.stopStateStatus,
      expected: expected.stopAdmissionChecks.stopStateStatus,
    }),
    createAssertion({
      name: "durable RS STOP leaves SELL admission available",
      actual: output.stopAdmissionChecks?.sellAdmissionBlocked,
      expected: expected.stopAdmissionChecks.sellAdmissionBlocked,
    }),
    createAssertion({
      name: "the BUY policy remains gated while eligible SELLs are allowed",
      actual: output.stopAdmissionChecks?.buyAdmissionBlocked,
      expected: expected.stopAdmissionChecks.buyAdmissionBlocked,
    }),
  ]
}

function createSubmissionIntentPersistenceFailureAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "production SELL submitter reports failed durable intent before broker placement",
      actual: output.submissionRejected,
      expected: expected.submissionRejected,
    }),
    createAssertion({
      name: "simulated broker is never called when submission intent persistence fails",
      actual: output.brokerSubmissionCallCount,
      expected: expected.brokerSubmissionCallCount,
    }),
    createAssertion({
      name: "no broker acknowledgement is fabricated after intent persistence failure",
      actual: output.submittedOrders.length,
      expected: expected.submittedOrderCount,
    }),
    createAssertion({
      name: "unresolved SELL submission latches the run-local account STOP",
      actual: output.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "SELL cycle reservation is not created before durable intent succeeds",
      actual: output.reservedSellCycle !== null,
      expected: expected.reservationRetained,
    }),
    createAssertion({
      name: "RS BUY admission remains blocked after intent persistence failure",
      actual: output.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "durable RS STOP leaves the first recovery SELL gate available after intent failure",
      actual: output.sellAdmissionBlocked,
      expected: expected.sellAdmissionBlocked,
    }),
  ]
}

function createSubmissionOutcomePersistenceFailureAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "production submitter fails closed when acknowledged outcome persistence fails",
      actual: output.submissionRejected,
      expected: expected.submissionRejected,
    }),
    createAssertion({
      name: "simulated broker is called exactly once before outcome persistence fails",
      actual: output.brokerSubmissionCallCount,
      expected: expected.brokerSubmissionCallCount,
    }),
    createAssertion({
      name: "durable submission intent exists before broker placement",
      actual: output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
      expected: true,
    }),
    createAssertion({
      name: "failed submission outcome is not published as a durable fact",
      actual: output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_OUTCOME"),
      expected: false,
    }),
    createAssertion({
      name: "account STOP persistence matches the injected submission-outcome failure scenario",
      actual: output.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "sole-SELL reservation remains retained while broker outcome is unresolved",
      actual: output.reservedSellCycle !== null,
      expected: expected.reservationRetained,
    }),
    createAssertion({
      name: "RS BUY admission remains blocked after outcome persistence failure",
      actual: output.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "durable RS STOP leaves the first recovery SELL gate available after outcome failure",
      actual: output.sellAdmissionBlocked,
      expected: expected.sellAdmissionBlocked,
    }),
  ]
}

function createBrokerPlacementExceptionAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "broker placement exception is classified as an unresolved submission",
      actual: output.submissionRejected,
      expected: expected.submissionRejected,
    }),
    createAssertion({
      name: "simulated broker was called once before transport failure",
      actual: output.brokerSubmissionCallCount,
      expected: expected.brokerSubmissionCallCount,
    }),
    createAssertion({
      name: "durable intent exists before the broker transport exception",
      actual: output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
      expected: true,
    }),
    createAssertion({
      name: "unknown broker outcome is durably classified as UNKNOWN",
      actual: output.simulationFacts.some((fact) =>
        fact.factType === "ORDER_SUBMISSION_OUTCOME" && fact.data?.outcome === "UNKNOWN"),
      expected: true,
    }),
    createAssertion({
      name: "account STOP is durably latched after unknown broker outcome",
      actual: output.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "sole-SELL reservation remains retained pending broker reconciliation",
      actual: output.reservedSellCycle !== null,
      expected: expected.reservationRetained,
    }),
    createAssertion({
      name: "RS BUY admission remains blocked after broker transport failure",
      actual: output.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "durable RS STOP leaves the first recovery SELL gate available after broker transport failure",
      actual: output.sellAdmissionBlocked,
      expected: expected.sellAdmissionBlocked,
    }),
  ]
}

function createSubmissionReservationFailureAssertions({ output, expected }) {
  return [
    createAssertion({
      name: "sole-SELL reservation callback failure is surfaced without successful submission",
      actual: output.submissionRejected,
      expected: expected.submissionRejected,
    }),
    createAssertion({
      name: "durable SELL intent is recorded before reservation callback",
      actual: output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
      expected: true,
    }),
    createAssertion({
      name: "broker is never invoked when sole-SELL reservation fails",
      actual: output.brokerSubmissionCallCount,
      expected: expected.brokerSubmissionCallCount,
    }),
    createAssertion({
      name: "failed reservation callback does not create a SELL cycle reservation",
      actual: output.reservedSellCycle !== null,
      expected: expected.reservationRetained,
    }),
    createAssertion({
      name: "reservation failure latches account STOP",
      actual: output.stopFactAppended,
      expected: expected.stopFactAppended,
    }),
    createAssertion({
      name: "RS BUY admission remains blocked after reservation failure",
      actual: output.buyAdmissionBlocked,
      expected: expected.buyAdmissionBlocked,
    }),
    createAssertion({
      name: "durable RS STOP leaves the first recovery SELL gate available after reservation failure",
      actual: output.sellAdmissionBlocked,
      expected: expected.sellAdmissionBlocked,
    }),
  ]
}

function createRuntimeScenarioAssertions({ output, expected }) {
  let assertions
  if (expected.submissionReservationFailure === true) {
    assertions = createSubmissionReservationFailureAssertions({
      output,
      expected,
    })
  } else if (expected.submissionOutcomeUnknown === true) {
    assertions = createBrokerPlacementExceptionAssertions({
      output,
      expected,
    })
  } else if (expected.submissionOutcomePersistenceFailed === true) {
    assertions = createSubmissionOutcomePersistenceFailureAssertions({
      output,
      expected,
    })
  } else if (expected.submissionIntentPersistenceFailed === true) {
    assertions = createSubmissionIntentPersistenceFailureAssertions({
      output,
      expected,
    })
  } else if (expected.submissionRejected === true) {
    assertions = createRejectedSellAssertions({
      output,
      expected,
    })
  } else if (expected.terminalOrderStatus) {
    assertions = createPartialSellAssertions({
      output,
      expected,
    })
  } else {
    assertions = createSubmittedSellAssertions({
      output,
      expected,
    })
  }
  return [
    ...assertions,
    ...createStopAdmissionAssertions({
      output,
      expected,
    }),
  ]
}

function createRuntimeScenarioEvaluationTrace({ runtime, effectiveInput, output }) {
  return {
    id: "runtime-1",
    kind: "production-runtime",
    label: "Evaluate production Recovery Seller runtime transition",
    inputs: {
      symbol: runtime.market.symbol,
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

function createRuntimeScenarioFillTraceStep({ runtime }) {
  return {
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
}

function createRuntimeScenarioStopTraceStep({ output }) {
  return {
    id: "stop-1",
    kind: "safety-stop",
    label: "Production STOP workflow latches an account blocker after unresolved SELL submission",
    outputs: {
      stopFactAppended: output.stopFactAppended,
      reservedSellCycle: output.reservedSellCycle,
    },
    source: "createRecoverySellerStopWorkflow.latch",
  }
}

function createRuntimeScenarioTerminalTraceStep({ output }) {
  return {
    id: "terminal-1",
    kind: "order-lifecycle",
    label: "Reconcile a terminal SELL through production order-event and accounting workflows",
    inputs: {
      orderStatus: output.terminalSell.orderStatus,
      executedQuantity: output.terminalSell.executedQuantity,
    },
    outputs: {
      cycleStatus: output.terminalSell.cycleState?.status,
      terminalReconciled: output.terminalSell.cycleState?.terminalReconciled,
      profitabilityEligible: output.terminalSell.profitabilityEligible,
      eventFillStaged: output.terminalSell.eventFillStaged,
      eventWorkflowFailedClosed: output.terminalSell.eventWorkflowFailedClosed,
      stopPersistenceFailed: output.terminalSell.stopPersistenceFailed,
      buyAdmissionBlocked: output.terminalSell.buyAdmissionBlocked,
      sellAdmissionBlocked: output.terminalSell.sellAdmissionBlocked,
      marketPaused: output.terminalSell.marketPaused,
      pauseReasons: output.terminalSell.pauseReasons,
    },
    source: "makeOrderEventWorkflow.processUserDataEventTransition → createRecoverySellerAccountingWorkflow.reconcileTerminalMixedSell",
  }
}

function createRuntimeScenarioTrace({ runtime, effectiveInput, output, assertions }) {
  const steps = [
    {
      id: "input-1",
      kind: "input",
      label: `Simulated ${runtime.market.symbol} market price`,
      inputs: effectiveInput,
      source: "deterministic-simulation-fixture",
    },
    createRuntimeScenarioFillTraceStep({ runtime }),
    createRuntimeScenarioEvaluationTrace({
      runtime,
      effectiveInput,
      output,
    }),
    {
      id: "broker-1",
      kind: "simulated-broker",
      label: "Attempt the production SELL intent through the run-local simulated broker",
      inputs: output.action,
      outputs: {
        submittedOrders: output.submittedOrders,
        brokerSubmissionCallCount: output.brokerSubmissionCallCount,
      },
      source: "createRecoverySellerOrderSubmitter",
    },
  ]
  if (output.submissionRejected) {
    steps.push(createRuntimeScenarioStopTraceStep({ output }))
  }
  if (output.terminalSell) {
    steps.push(createRuntimeScenarioTerminalTraceStep({ output }))
  }
  if (output.stopAdmissionChecks) {
    steps.push({
      id: "stop-admission-1",
      kind: "safety-stop",
      label: "Verify STOP remains active while an eligible first recovery SELL is submitted",
      outputs: output.stopAdmissionChecks,
      source: "createRecoverySellerRuntimeEvaluator",
    })
  }
  steps.push({
    id: "assertions-1",
    kind: "assertion",
    label: "Compare production execution with scenario expectations",
    outputs: assertions,
  })
  return steps
}

function resolveRuntimeScenarioInput({ scenarioId, input, signal }) {
  if (signal?.aborted) {
    throw new Error("Scenario worker was cancelled")
  }
  const scenario = RECOVERY_SELLER_RUNTIME_SCENARIOS.find((item) => item.id === scenarioId)
  if (!scenario) {
    throw new TypeError(`Unsupported production Recovery Seller runtime scenario: ${scenarioId}`)
  }
  const effectiveInput = validateScenarioInput({
    schema: scenario.inputSchema,
    defaults: scenario.input,
    input,
  })
  if (compareDecimal({
    left: effectiveInput.marketPrice,
    right: "0",
  }) <= 0) {
    throw new RangeError("Scenario marketPrice must be greater than zero")
  }
  return {
    scenario,
    effectiveInput,
  }
}

function isRuntimeScenarioExpectedSubmissionFailure({ scenarioId }) {
  return [
    "RS-RUNTIME-SELL-REJECTION-001",
    "RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-BROKER-EXCEPTION-001",
    "RS-RUNTIME-SELL-RESERVATION-FAILURE-001",
  ].includes(scenarioId)
}

async function executeRuntimeScenarioAdmission({ runtime, scenarioId, effectiveInput }) {
  if (scenarioId !== "RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001") {
    const execution = await executeRuntimeScenarioDispatch({
      runtime,
      effectiveInput,
      expectRejection: isRuntimeScenarioExpectedSubmissionFailure({
        scenarioId,
      }),
    })
    return {
      execution,
      stopAdmissionChecks: null,
    }
  }
  const stopResult = await runtime.stopWorkflow.latch({
    explanation: "Scenario verifies that STOP blocks new BUY spending but permits an eligible first recovery SELL.",
  })
  if (stopResult?.ok !== true || stopResult.data?.durable !== true) {
    throw stopResult?.errors?.[0] ?? new Error("Scenario STOP could not be persisted in the run-local store")
  }
  const execution = await executeRuntimeScenarioDispatch({
    runtime,
    effectiveInput,
  })
  const stopAdmissionChecks = {
    sellActionSide: execution.submittedAction?.side ?? null,
    stopStateStatus: (await runtime.stopWorkflow.getState()).status,
    buyAdmissionBlocked: runtime.stopWorkflow.isBuyAdmissionBlocked(),
    sellAdmissionBlocked: runtime.stopWorkflow.isSellAdmissionBlocked(),
  }
  return {
    execution,
    stopAdmissionChecks,
  }
}

async function executeRuntimeScenarioTerminalSell({ runtime, scenarioId, effectiveInput, execution }) {
  if (scenarioId === "RS-RUNTIME-SELL-PARTIAL-CANCEL-001") {
    return reconcileRuntimeScenarioPartialSell({
      runtime,
      execution,
    })
  }
  if (scenarioId === "RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001") {
    return reconcileRuntimeScenarioFilledSell({
      runtime,
      execution,
    })
  }
  if (scenarioId === "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001") {
    return reconcileRuntimeScenarioFilledSell({
      runtime,
      execution,
      terminalReconciliationPersistenceFailure: true,
    })
  }
  if (scenarioId !== "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001") {
    return null
  }
  const terminalSell = await reconcileRuntimeScenarioFilledSell({
    runtime,
    execution,
    stopPersistenceFailure: true,
  })
  const followUp = await executeRuntimeScenarioDispatch({
    runtime,
    effectiveInput: {
      ...effectiveInput,
      marketPrice: "9",
    },
    expectBlocked: true,
  })
  return {
    ...terminalSell,
    postFailureBuyAdmissionBlocked: runtime.stopWorkflow.isBuyAdmissionBlocked(),
    postFailureSellAdmissionBlocked: runtime.stopWorkflow.isSellAdmissionBlocked(),
    postFailureSubmittedOrderCount: followUp.data.submittedOrders?.length ?? 0,
    postFailureActionSubmitted: Boolean(followUp.submittedAction),
  }
}

async function executeRuntimeScenario({ runId, scenarioId, effectiveInput, signal }) {
  const runtime = await createRuntimeScenarioContext({
    runId,
    scenarioId,
    effectiveInput,
  })
  const { execution, stopAdmissionChecks } = await executeRuntimeScenarioAdmission({
    runtime,
    scenarioId,
    effectiveInput,
  })
  if (signal?.aborted) {
    throw new Error("Scenario worker was cancelled")
  }
  const terminalSell = await executeRuntimeScenarioTerminalSell({
    runtime,
    scenarioId,
    effectiveInput,
    execution,
  })
  return {
    runtime,
    execution,
    terminalSell,
    stopAdmissionChecks,
  }
}

function createRuntimeScenarioResult({
  runId,
  scenario,
  effectiveInput,
  execution,
  runtime,
  terminalSell,
  stopAdmissionChecks,
}) {
  const output = createRuntimeScenarioOutput({
    runtime,
    data: execution.data,
    submittedAction: execution.submittedAction,
    submissionRejected: execution.submissionRejected,
    terminalSell,
    stopAdmissionChecks,
  })
  const expected = createRuntimeScenarioExpected({
    seed: runtime.seed,
    pairConfig: runtime.pairConfig,
    scenarioId: scenario.id,
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
    scenarioId: scenario.id,
    scenarioName: scenario.name,
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

export async function executeRecoverySellerRuntimeScenario({
  runId,
  scenarioId = "RS-RUNTIME-SELL-SUBMISSION-001",
  input,
  signal,
}) {
  const { scenario, effectiveInput } = resolveRuntimeScenarioInput({
    scenarioId,
    input,
    signal,
  })
  const { runtime, execution, terminalSell, stopAdmissionChecks } = await executeRuntimeScenario({
    runId,
    scenarioId,
    effectiveInput,
    signal,
  })
  return createRuntimeScenarioResult({
    runId,
    scenario,
    effectiveInput,
    execution,
    runtime,
    terminalSell,
    stopAdmissionChecks,
  })
}
