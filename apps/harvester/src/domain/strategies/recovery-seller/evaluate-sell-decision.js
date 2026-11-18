import {
  assertDecimalString,
  compareDecimal,
  maxDecimal,
  multiplyDecimal,
  percentageToRate,
  roundDecimalToIncrement,
} from "@coinzilla/utils"
import { calculateRecoverySellerSellPlan } from "./calculate-sell-plan.js"
import { assertRecoverySellerCycleState } from "./cycle-state.js"
import { createRecoverySellerLifecycleDecision } from "./lifecycle-decision.js"
import {
  assertRecoverySellerStopState,
  createRecoverySellerStopDecision,
  latchRecoverySellerStop,
} from "./stop-decision.js"

const REQUIRED_FILTERS = Object.freeze([
  "PRICE_INCREMENT",
  "QUANTITY_INCREMENT",
  "MIN_QUANTITY",
  "MIN_NOTIONAL",
])

function readFilterAmount({ constraints, type, required = false }) {
  const rule = constraints.get(type)
  if (!rule || rule.status !== "SUPPORTED") {
    if (required) {
      throw new Error(`Required Recovery Seller exchange filter is unavailable: ${type}`)
    }
    return undefined
  }
  const amount = rule.value?.amount
  assertDecimalString({
    value: amount,
    field: type,
  })
  if (compareDecimal({
    left: amount,
    right: "0",
  }) <= 0) {
    throw new RangeError(`Recovery Seller exchange filter must be positive: ${type}`)
  }
  return amount
}

function resolveExchangeFilters({ marketMetadata }) {
  const constraints = new Map(marketMetadata.tradingRules.constraints.map((rule) => [
    rule.type,
    rule,
  ]))
  const filters = {}
  for (const type of REQUIRED_FILTERS) {
    filters[type] = readFilterAmount({
      constraints,
      type,
      required: true,
    })
  }
  for (const type of ["MIN_PRICE", "MAX_PRICE", "MAX_QUANTITY", "MAX_NOTIONAL"]) {
    filters[type] = readFilterAmount({
      constraints,
      type,
    })
  }
  return filters
}

function resolveSellFeePolicy({ pairConfig }) {
  const makerPercent = String(pairConfig.makerPercent)
  const takerPercent = String(pairConfig.takerPercent)
  for (const [field, value] of Object.entries({ makerPercent, takerPercent })) {
    assertDecimalString({
      value,
      field,
    })
    if (compareDecimal({
      left: value,
      right: "0",
    }) < 0 || compareDecimal({
      left: value,
      right: "100",
    }) >= 0) {
      throw new RangeError(`${field} must be from 0 inclusive to 100 exclusive`)
    }
  }
  const postOnly = pairConfig.makerPercent === 0
  const reservedPercent = postOnly
    ? makerPercent
    : maxDecimal({
      left: makerPercent,
      right: takerPercent,
    })
  return Object.freeze({
    orderType: postOnly ? "LIMIT_MAKER" : "LIMIT",
    reservedRole: postOnly || compareDecimal({
      left: makerPercent,
      right: takerPercent,
    }) >= 0
      ? "MAKER"
      : "TAKER",
    feeRate: percentageToRate({
      percent: reservedPercent,
    }),
  })
}

function findFilterViolation({ plan, filters }) {
  const notional = multiplyDecimal({
    left: plan.price,
    right: plan.quantity,
  })
  const values = [
    ["MIN_PRICE", plan.price, "below"],
    ["MAX_PRICE", plan.price, "above"],
    ["MIN_QUANTITY", plan.quantity, "below"],
    ["MAX_QUANTITY", plan.quantity, "above"],
    ["MIN_NOTIONAL", notional, "below"],
    ["MAX_NOTIONAL", notional, "above"],
  ]
  for (const [type, actual, direction] of values) {
    const limit = filters[type]
    if (limit === undefined) {
      continue
    }
    const comparison = compareDecimal({
      left: actual,
      right: limit,
    })
    if ((direction === "below" && comparison < 0) ||
        (direction === "above" && comparison > 0)) {
      return type
    }
  }
  const priceIsAligned = compareDecimal({
    left: roundDecimalToIncrement({
      value: plan.price,
      increment: filters.PRICE_INCREMENT,
      direction: "down",
    }),
    right: plan.price,
  }) === 0
  const quantityIsAligned = compareDecimal({
    left: roundDecimalToIncrement({
      value: plan.quantity,
      increment: filters.QUANTITY_INCREMENT,
      direction: "down",
    }),
    right: plan.quantity,
  }) === 0
  if (!priceIsAligned) {
    return "PRICE_INCREMENT"
  }
  if (!quantityIsAligned) {
    return "QUANTITY_INCREMENT"
  }
  return undefined
}

function getFailureExplanation({ error, operation }) {
  return error instanceof Error && error.message
    ? "Recovery Seller " + operation + " failed: " + error.message
    : "Recovery Seller " + operation + " failed with an unsupported condition"
}

function createStoppedResult({ stopState, explanation }) {
  const stopDecision = createRecoverySellerStopDecision({
    explanation,
  })
  const nextStopState = latchRecoverySellerStop({
    state: stopState,
    decision: stopDecision,
  })
  return Object.freeze({
    stopState: nextStopState,
    decision: nextStopState.decision,
  })
}

function validateSellPolicyContext({ pairConfig, marketMetadata, cycleState }) {
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Recovery Seller SELL policy requires pairConfig")
  }
  if (!marketMetadata?.market ||
      !Array.isArray(marketMetadata.supportedOrderTypes) ||
      !Array.isArray(marketMetadata.tradingRules?.constraints) ||
      marketMetadata.tradingRules.market?.id !== marketMetadata.market.id) {
    throw new TypeError("Recovery Seller SELL policy requires matching market metadata and TradingRules")
  }
  assertRecoverySellerCycleState({
    state: cycleState,
  })
}

function createSellPlan({ planInput, filters, feePolicy }) {
  const plan = calculateRecoverySellerSellPlan({
    ...planInput,
    quoteFeeRate: feePolicy.feeRate,
    baseFeeRate: feePolicy.feeRate,
    priceTickSize: filters.PRICE_INCREMENT,
    quantityStepSize: filters.QUANTITY_INCREMENT,
  })
  return Object.freeze({
    plan,
    filterViolation: findFilterViolation({
      plan,
      filters,
    }),
  })
}

/**
 * Evaluate one pre-submission RS mixed SELL using the owner-approved
 * Conservative order-type/fee policy and fail-closed exchange-filter behavior.
 * This pure policy never submits, retries, adjusts or splits an exchange order.
 *
 * @param {object} input
 * @param {object} input.pairConfig Existing per-pair makerPercent/takerPercent.
 * @param {object} input.marketMetadata Canonical Market, TradingRules and supported order types.
 * @param {object} input.cycleState Current RS cycle state.
 * @param {object} input.stopState Global sticky RS STOP state.
 * @param {object} input.planInput Explicit mixed-SELL accounting and fee-valuation inputs.
 * @returns {object} Immutable STOP-gated decision and, only when eligible, one SELL intent.
 */
export function evaluateRecoverySellerSellDecision({
  pairConfig,
  marketMetadata,
  cycleState,
  stopState,
  planInput,
} = {}) {
  assertRecoverySellerStopState({
    state: stopState,
  })
  validateSellPolicyContext({
    pairConfig,
    marketMetadata,
    cycleState,
  })
  if (stopState.status === "STOPPED") {
    return Object.freeze({
      stopState,
      decision: stopState.decision,
    })
  }
  if (cycleState.status !== "ACCUMULATING") {
    return createStoppedResult({
      stopState,
      explanation: "Recovery Seller cannot submit a second SELL or trade from a non-accumulating cycle",
    })
  }
  const feePolicy = resolveSellFeePolicy({
    pairConfig,
  })
  if (!marketMetadata.supportedOrderTypes.includes(feePolicy.orderType)) {
    return createStoppedResult({
      stopState,
      explanation: `Exchange does not support required Recovery Seller ${feePolicy.orderType} SELL orders`,
    })
  }
  let filters
  try {
    filters = resolveExchangeFilters({
      marketMetadata,
    })
  } catch (error) {
    return createStoppedResult({
      stopState,
      explanation: getFailureExplanation({
        error,
        operation: "exchange-filter validation",
      }),
    })
  }
  let plan
  let filterViolation
  try {
    ({ plan, filterViolation } = createSellPlan({
      planInput,
      filters,
      feePolicy,
    }))
  } catch (error) {
    return createStoppedResult({
      stopState,
      explanation: getFailureExplanation({
        error,
        operation: "SELL planning",
      }),
    })
  }
  if (filterViolation) {
    return createStoppedResult({
      stopState,
      explanation: `Recovery Seller SELL violates exchange ${filterViolation}; no quantity or price adjustment is permitted`,
    })
  }
  const decision = createRecoverySellerLifecycleDecision({
    outcome: "SUBMIT",
    reasonCode: "RECOVERY_SELL_PROFITABILITY_AND_FILTERS_PASSED",
    explanation: "The single mixed SELL passes all profitability and supported exchange-filter requirements",
  })
  return Object.freeze({
    stopState,
    decision,
    orderIntent: Object.freeze({
      side: "SELL",
      type: feePolicy.orderType,
      price: plan.price,
      quantity: plan.quantity,
      quoteFeeRate: feePolicy.feeRate,
      baseFeeRate: feePolicy.feeRate,
      reservedRole: feePolicy.reservedRole,
      plan,
    }),
  })
}
