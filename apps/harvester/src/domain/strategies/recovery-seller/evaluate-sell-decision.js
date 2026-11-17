import {
  assertDecimalString,
  compareDecimal,
  multiplyDecimal,
} from "@coinzilla/utils"
import { calculateRecoverySellerSellPlan } from "./calculate-sell-plan.js"
import {
  applyRecoverySellerLifecycleTransition,
  createRecoverySellerLifecycleDecision,
  createRecoverySellerStopAndReconcileDecision,
} from "./lifecycle-decision.js"
import {
  assertRecoverySellerCycleState,
  recordRecoverySellerCycleSellSubmission,
} from "./cycle-state.js"
import {
  applyRecoverySellerStopGate,
  createRecoverySellerStopDecision,
  RECOVERY_SELLER_LIFECYCLE_OUTCOMES,
} from "./stop-decision.js"

const ACTIVE_ORDER_STATUSES = new Set([
  "PENDING",
  "OPEN",
  "PARTIALLY_FILLED",
  "UNKNOWN",
])

function assertNonNegativeDecimal({ value, field }) {
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(`${field} must be non-negative`)
  }
}

function assertPositiveDecimal({ value, field }) {
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
}

function getRuleAmount({ marketMetadata, type, required = true }) {
  const matches = marketMetadata.tradingRules.constraints.filter((rule) => rule.type === type)
  if (matches.length > 1) {
    throw new Error(`Exchange trading rule is ambiguous: ${type}`)
  }
  const rule = matches[0]
  if (!rule || rule.status !== "SUPPORTED") {
    if (!required) {
      return undefined
    }
    throw new Error(`Required exchange trading rule is unavailable: ${type}`)
  }
  if (!rule.value || typeof rule.value.amount !== "string") {
    throw new Error(`Supported exchange trading rule has no amount: ${type}`)
  }
  assertPositiveDecimal({
    value: rule.value.amount,
    field: type,
  })
  return rule.value.amount
}

function validateActiveOrders(activeOrders) {
  if (!Array.isArray(activeOrders)) {
    throw new TypeError("Recovery Seller activeOrders must be an array")
  }
  for (const order of activeOrders) {
    if (!order || typeof order !== "object" || Array.isArray(order) ||
        typeof order.market?.symbol !== "string" || !order.market.symbol.trim() ||
        !["BUY", "SELL"].includes(order.side) ||
        !ACTIVE_ORDER_STATUSES.has(order.status)) {
      throw new Error("Recovery Seller received a malformed or unsupported active-order snapshot")
    }
  }
}

function findMarketOrders({ activeOrders, symbol }) {
  validateActiveOrders(activeOrders)
  return activeOrders.filter((order) => order.market.symbol === symbol)
}

function createStopResult({ stopState, explanation }) {
  const stopDecision = createRecoverySellerStopDecision({
    explanation,
  })
  const gated = applyRecoverySellerStopGate({
    stopState,
    decision: stopDecision,
  })
  return Object.freeze({
    stopState: gated.stopState,
    stopDecision: gated.stopState.decision,
    decision: gated.decision,
  })
}

function createStopAndReconcile({ stopState, orderIdentity, explanation }) {
  if (orderIdentity?.clientOrderId) {
    return createRecoverySellerStopAndReconcileDecision({
      stopState,
      orderIdentity,
      explanation,
    })
  }
  return createStopResult({
    stopState,
    explanation,
  })
}

function createStopAndReconcileFromSnapshot({ stopState, activeOrders, symbol, explanation }) {
  if (Array.isArray(activeOrders)) {
    const order = activeOrders.find((candidate) =>
      candidate?.market?.symbol === symbol &&
      typeof candidate.clientOrderId === "string" &&
      candidate.clientOrderId.trim(),
    )
    if (order) {
      return createStopAndReconcile({
        stopState,
        orderIdentity: {
          clientOrderId: order.clientOrderId,
          ...(typeof order.brokerOrderId === "string" && order.brokerOrderId.trim()
            ? { brokerOrderId: order.brokerOrderId }
            : {}),
        },
        explanation,
      })
    }
  }
  return createStopResult({
    stopState,
    explanation,
  })
}

function createWaitDecision({ stopState, previousDecision, order, reasonCode, explanation }) {
  const decision = createRecoverySellerLifecycleDecision({
    outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT,
    reasonCode,
    explanation,
    orderIdentity: {
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    },
  })
  return applyRecoverySellerLifecycleTransition({
    stopState,
    previousDecision,
    nextDecision: decision,
  })
}

function resolveExistingOrder({
  stopState,
  previousDecision,
  activeOrders,
  symbol,
  cycleState,
}) {
  const marketOrders = findMarketOrders({
    activeOrders,
    symbol,
  })

  if (["CLOSED", "UNRESOLVED"].includes(cycleState.status)) {
    if (marketOrders.length > 0) {
      const [order] = marketOrders
      return createStopAndReconcile({
        stopState,
        orderIdentity: order.clientOrderId
          ? {
            clientOrderId: order.clientOrderId,
            ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
          }
          : undefined,
        explanation: "Recovery Seller has an active order after its cycle became closed or unresolved",
      })
    }
    const decision = createRecoverySellerLifecycleDecision({
      outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
      reasonCode: cycleState.status === "CLOSED" ? "CYCLE_CLOSED" : "CYCLE_UNRESOLVED",
      explanation: cycleState.status === "CLOSED"
        ? "The prior Recovery Seller cycle is closed; a distinct next-cycle state is required before another SELL"
        : "The Recovery Seller cycle has an unresolved terminal SELL and cannot submit another SELL",
    })
    return applyRecoverySellerLifecycleTransition({
      stopState,
      previousDecision,
      nextDecision: decision,
    })
  }

  if (["SELL_SUBMITTED", "RECONCILIATION_REQUIRED"].includes(cycleState.status)) {
    const identity = cycleState.sellOrderIdentity
    const matchingOrders = marketOrders.filter((order) =>
      order.clientOrderId === identity.clientOrderId)
    if (marketOrders.length !== matchingOrders.length || matchingOrders.length > 1) {
      return createStopAndReconcile({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller cycle has an unexpected active order alongside its single submitted SELL",
      })
    }
    if (matchingOrders.length === 0) {
      return createStopAndReconcile({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller cycle records a submitted SELL but the active-order snapshot has no authoritative terminal result",
      })
    }
    const [order] = matchingOrders
    if (order.side !== "SELL" ||
        (identity.brokerOrderId !== undefined &&
         order.brokerOrderId !== undefined &&
         identity.brokerOrderId !== order.brokerOrderId)) {
      return createStopAndReconcile({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller active order identity conflicts with the cycle's single SELL identity",
      })
    }
    if (["PENDING", "UNKNOWN"].includes(order.status) ||
        typeof order.brokerOrderId !== "string" ||
        !order.brokerOrderId.trim()) {
      return createStopAndReconcile({
        stopState,
        orderIdentity: {
          clientOrderId: identity.clientOrderId,
          ...((order.brokerOrderId ?? identity.brokerOrderId)
            ? { brokerOrderId: order.brokerOrderId ?? identity.brokerOrderId }
            : {}),
        },
        explanation: "Recovery Seller cycle SELL acknowledgement or execution outcome remains unresolved",
      })
    }
    if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status)) {
      return createStopAndReconcile({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller cycle SELL has an unsupported active-order state",
      })
    }
    return createWaitDecision({
      stopState,
      previousDecision,
      order,
      reasonCode: "WAIT_FOR_EXISTING_RS_SELL",
      explanation: "The cycle's single acknowledged SELL must remain unchanged until its authoritative terminal outcome is reconciled",
    })
  }

  if (cycleState.status !== "ACCUMULATING") {
    return createStopResult({
      stopState,
      explanation: "Recovery Seller cycle has an unsupported lifecycle status",
    })
  }

  const sellOrder = marketOrders.find((order) => order.side === "SELL")
  if (sellOrder) {
    return createStopAndReconcile({
      stopState,
      orderIdentity: sellOrder.clientOrderId
        ? {
          clientOrderId: sellOrder.clientOrderId,
          ...(sellOrder.brokerOrderId ? { brokerOrderId: sellOrder.brokerOrderId } : {}),
        }
        : undefined,
      explanation: "Recovery Seller has a SELL order that was not recorded in the cycle's one-SELL state",
    })
  }

  if (marketOrders.length === 0) {
    return undefined
  }
  if (marketOrders.length > 1) {
    const [order] = marketOrders
    return createStopAndReconcile({
      stopState,
      orderIdentity: order.clientOrderId
        ? {
          clientOrderId: order.clientOrderId,
          ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
        }
        : undefined,
      explanation: "Recovery Seller has multiple active BUY orders in one cycle",
    })
  }

  const [order] = marketOrders
  if (["PENDING", "UNKNOWN"].includes(order.status) ||
      typeof order.brokerOrderId !== "string" ||
      !order.brokerOrderId.trim()) {
    return createStopAndReconcile({
      stopState,
      orderIdentity: order.clientOrderId
        ? {
          clientOrderId: order.clientOrderId,
          ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
        }
        : undefined,
      explanation: "Recovery Seller BUY submission or acknowledgement outcome is unresolved",
    })
  }
  if (typeof order.clientOrderId !== "string" || !order.clientOrderId.trim()) {
    return createStopResult({
      stopState,
      explanation: "Recovery Seller active BUY has no original clientOrderId",
    })
  }

  return createWaitDecision({
    stopState,
    previousDecision,
    order,
    reasonCode: "WAIT_FOR_EXISTING_RS_BUY",
    explanation: "An existing acknowledged Recovery Seller BUY must reach an authoritative terminal state before the cycle SELL is considered",
  })
}

function validateInput({
  marketPrice,
  pairConfig,
  marketMetadata,
  recoveryQuantity,
  recoveryCostBasis,
  legacyRemainingQuantity,
  verifiedUnreservedLegacyQuantity,
  legacyAverageCost,
  quoteFeeRate,
  baseFeeRate,
  thirdAssetFeeQuoteValue,
  sellClientOrderId,
  activeOrders,
  strategyStopped,
  marketPaused,
  reconciliationComplete,
}) {
  if (!marketPrice || typeof marketPrice.symbol !== "string" || !marketPrice.symbol.trim()) {
    throw new TypeError("Recovery Seller SELL policy requires a market symbol")
  }
  assertPositiveDecimal({
    value: marketPrice.price,
    field: "marketPrice.price",
  })
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Recovery Seller SELL policy requires pairConfig")
  }
  assertPositiveDecimal({
    value: String(pairConfig.sellQuantity),
    field: "pairConfig.sellQuantity",
  })
  assertPositiveDecimal({
    value: String(pairConfig.minProfit),
    field: "pairConfig.minProfit",
  })
  if (!marketMetadata?.market || marketMetadata.market.symbol !== marketPrice.symbol) {
    throw new TypeError("Recovery Seller SELL policy requires matching canonical market metadata")
  }
  if (typeof marketMetadata.orderType !== "string" || !marketMetadata.orderType.trim()) {
    throw new TypeError("Recovery Seller SELL policy requires a configured orderType")
  }
  if (!Array.isArray(marketMetadata.tradingRules?.constraints)) {
    throw new TypeError("Recovery Seller SELL policy requires normalized exchange trading rules")
  }
  assertPositiveDecimal({ value: recoveryQuantity, field: "recoveryQuantity" })
  assertPositiveDecimal({ value: recoveryCostBasis, field: "recoveryCostBasis" })
  assertNonNegativeDecimal({ value: legacyRemainingQuantity, field: "legacyRemainingQuantity" })
  assertNonNegativeDecimal({ value: verifiedUnreservedLegacyQuantity, field: "verifiedUnreservedLegacyQuantity" })
  assertNonNegativeDecimal({ value: legacyAverageCost, field: "legacyAverageCost" })
  assertNonNegativeDecimal({ value: quoteFeeRate, field: "quoteFeeRate" })
  assertNonNegativeDecimal({ value: baseFeeRate, field: "baseFeeRate" })
  assertNonNegativeDecimal({ value: thirdAssetFeeQuoteValue, field: "thirdAssetFeeQuoteValue" })
  if (typeof sellClientOrderId !== "string" || !sellClientOrderId.trim()) {
    throw new TypeError("Recovery Seller SELL policy requires a preallocated sellClientOrderId")
  }
  if (!Array.isArray(activeOrders)) {
    throw new TypeError("Recovery Seller SELL policy activeOrders must be an array")
  }
  if (typeof strategyStopped !== "boolean" || typeof marketPaused !== "boolean" ||
      typeof reconciliationComplete !== "boolean") {
    throw new TypeError("Recovery Seller SELL policy requires explicit strategy, market and reconciliation readiness flags")
  }
}

function createLifecycleResult({
  stopState,
  previousDecision,
  decision,
  action,
  cycleState,
  sellDisposition,
  sellPlan,
}) {
  const gated = applyRecoverySellerLifecycleTransition({
    stopState,
    previousDecision,
    nextDecision: decision,
  })
  return Object.freeze({
    stopState: gated.stopState,
    ...(gated.stopState.status === "STOPPED" ? { stopDecision: gated.stopState.decision } : {}),
    decision: gated.decision,
    cycleState,
    ...(gated.decision.outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.SUBMIT && action
      ? { action }
      : {}),
    ...(sellDisposition ? { sellDisposition } : {}),
    ...(sellPlan ? { sellPlan } : {}),
  })
}

/**
 * Evaluate the one allowed RS cycle SELL using the explicit fee reserve,
 * recovery accounting, authorized legacy remainder and verified unreserved
 * Spot custody snapshot. This is a pure policy boundary; the shared Trading
 * Engine must atomically persist the returned client identity/cycle state and
 * order intent before broker I/O.
 *
 * Fee rates and third-asset quote valuation are explicit inputs. Missing fee
 * valuation is never treated as zero. Actual commissions and fills remain
 * authoritative for final reconciliation and cycle profitability.
 *
 * @param {object} input Pure cycle, market, fee, accounting, custody and readiness snapshots.
 * @returns {object} Immutable lifecycle decision, optional SELL intent and next cycle state.
 */
export function evaluateRecoverySellerSellDecision({
  stopState,
  previousDecision,
  marketPrice,
  pairConfig,
  marketMetadata,
  cycleState,
  activeOrders = [],
  recoveryQuantity,
  recoveryCostBasis,
  legacyRemainingQuantity,
  verifiedUnreservedLegacyQuantity,
  legacyAverageCost,
  quoteFeeRate,
  baseFeeRate,
  thirdAssetFeeQuoteValue,
  strategyStopped,
  marketPaused,
  reconciliationComplete,
  sellClientOrderId,
} = {}) {
  if (!stopState) {
    throw new TypeError("Recovery Seller SELL policy requires a valid STOP state")
  }

  try {
    assertRecoverySellerCycleState({ state: cycleState })
    const existingOrderResult = resolveExistingOrder({
      stopState,
      previousDecision,
      activeOrders,
      symbol: marketPrice?.symbol,
      cycleState,
    })
    if (existingOrderResult) {
      return Object.freeze({
        ...existingOrderResult,
        cycleState,
        ...(existingOrderResult.stopState.status === "STOPPED"
          ? { stopDecision: existingOrderResult.stopState.decision }
          : {}),
      })
    }
    if (stopState.status === "STOPPED") {
      const gated = applyRecoverySellerStopGate({
        stopState,
      })
      return Object.freeze({
        stopState: gated.stopState,
        stopDecision: gated.stopState.decision,
        decision: gated.decision,
        cycleState,
      })
    }

    validateInput({
      marketPrice,
      pairConfig,
      marketMetadata,
      recoveryQuantity,
      recoveryCostBasis,
      legacyRemainingQuantity,
      verifiedUnreservedLegacyQuantity,
      legacyAverageCost,
      quoteFeeRate,
      baseFeeRate,
      thirdAssetFeeQuoteValue,
      sellClientOrderId,
      activeOrders,
      strategyStopped,
      marketPaused,
      reconciliationComplete,
    })

    const readinessBlock = strategyStopped
      ? {
        reasonCode: "STRATEGY_STOPPED",
        explanation: "Recovery Seller is stopped by its operator and may not create a new SELL",
      }
      : marketPaused
        ? {
          reasonCode: "MARKET_PAUSED",
          explanation: "The market is paused and Recovery Seller may not create a new SELL",
        }
        : !reconciliationComplete
          ? {
            reasonCode: "RECONCILIATION_INCOMPLETE",
            explanation: "Recovery Seller cannot create a new SELL while order, fill, inventory or reservation reconciliation is incomplete",
          }
          : undefined
    if (readinessBlock) {
      const decision = createRecoverySellerLifecycleDecision({
        outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
        reasonCode: readinessBlock.reasonCode,
        explanation: readinessBlock.explanation,
      })
      return createLifecycleResult({
        stopState,
        previousDecision,
        decision,
        cycleState,
      })
    }

    const rules = {
      priceTickSize: getRuleAmount({ marketMetadata, type: "PRICE_INCREMENT" }),
      quantityStepSize: getRuleAmount({ marketMetadata, type: "QUANTITY_INCREMENT" }),
      minQuantity: getRuleAmount({ marketMetadata, type: "MIN_QUANTITY" }),
      minNotional: getRuleAmount({ marketMetadata, type: "MIN_NOTIONAL" }),
      minPrice: getRuleAmount({ marketMetadata, type: "MIN_PRICE", required: false }),
      maxPrice: getRuleAmount({ marketMetadata, type: "MAX_PRICE", required: false }),
      maxQuantity: getRuleAmount({ marketMetadata, type: "MAX_QUANTITY", required: false }),
      maxNotional: getRuleAmount({ marketMetadata, type: "MAX_NOTIONAL", required: false }),
    }

    const sellPlan = calculateRecoverySellerSellPlan({
      recoveryQuantity,
      configuredLegacyQuantity: String(pairConfig.sellQuantity),
      legacyRemainingQuantity,
      verifiedUnreservedLegacyQuantity,
      recoveryCostBasis,
      legacyAverageCost,
      minProfit: String(pairConfig.minProfit),
      quoteFeeRate,
      baseFeeRate,
      thirdAssetFeeQuoteValue,
      priceTickSize: rules.priceTickSize,
      quantityStepSize: rules.quantityStepSize,
    })
    const notional = multiplyDecimal({
      left: sellPlan.price,
      right: sellPlan.quantity,
    })
    const filterReason =
      compareDecimal({ left: sellPlan.quantity, right: rules.minQuantity }) < 0
        ? "MIN_QUANTITY"
        : compareDecimal({ left: notional, right: rules.minNotional }) < 0
          ? "MIN_NOTIONAL"
          : rules.maxQuantity && compareDecimal({ left: sellPlan.quantity, right: rules.maxQuantity }) > 0
            ? "MAX_QUANTITY"
            : rules.maxNotional && compareDecimal({ left: notional, right: rules.maxNotional }) > 0
              ? "MAX_NOTIONAL"
              : rules.minPrice && compareDecimal({ left: sellPlan.price, right: rules.minPrice }) < 0
                ? "MIN_PRICE"
                : rules.maxPrice && compareDecimal({ left: sellPlan.price, right: rules.maxPrice }) > 0
                  ? "MAX_PRICE"
                  : undefined

    if (filterReason) {
      const decision = createRecoverySellerLifecycleDecision({
        outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
        reasonCode: "SELL_EXCHANGE_FILTER_REJECTED",
        explanation: `Recovery Seller's one cycle SELL is outside the current exchange filters: ${filterReason}`,
      })
      return createLifecycleResult({
        stopState,
        previousDecision,
        decision,
        cycleState,
        sellPlan,
        sellDisposition: Object.freeze({
          status: "EXCHANGE_CONSTRAINED_SELL",
          reason: filterReason,
          price: sellPlan.price,
          quantity: sellPlan.quantity,
          notional,
        }),
      })
    }

    const nextCycleState = recordRecoverySellerCycleSellSubmission({
      state: cycleState,
      orderIdentity: {
        clientOrderId: sellClientOrderId,
      },
    })
    const decision = createRecoverySellerLifecycleDecision({
      outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.SUBMIT,
      reasonCode: "CYCLE_SELL_ELIGIBLE",
      explanation: "The sole Recovery Seller cycle SELL passed accounting, fee, custody, readiness and exchange-filter checks",
    })
    return createLifecycleResult({
      stopState,
      previousDecision,
      decision,
      cycleState: nextCycleState,
      sellPlan,
      action: Object.freeze({
        side: "SELL",
        type: marketMetadata.orderType,
        price: sellPlan.price,
        quantity: sellPlan.quantity,
        notional,
        clientOrderId: sellClientOrderId,
        reason: sellPlan.legacyQuantity === "0"
          ? "RECOVERY_ONLY_CYCLE_SELL"
          : "MIXED_RECOVERY_AND_LEGACY_CYCLE_SELL",
        requiredNetQuoteProceeds: sellPlan.requiredNetQuoteProceeds,
      }),
    })
  } catch (error) {
    return createStopAndReconcileFromSnapshot({
      stopState,
      activeOrders,
      symbol: marketPrice?.symbol,
      explanation: error instanceof Error && error.message
        ? `Recovery Seller SELL policy failed closed: ${error.message}`
        : "Recovery Seller SELL policy encountered an unmodeled condition",
    })
  }
}
