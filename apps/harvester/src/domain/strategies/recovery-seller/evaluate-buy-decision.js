import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  maxDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "@coinzilla/utils"
import { calculateInitialBuyPrice } from "../conservative/initial-buy-price.js"
import { assertRecoverySellerCycleState } from "./cycle-state.js"
import {
  applyRecoverySellerLifecycleTransition,
  createRecoverySellerLifecycleDecision,
  createRecoverySellerStopAndReconcileDecision,
} from "./lifecycle-decision.js"
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

function validateInput({
  marketPrice,
  pairConfig,
  marketMetadata,
  recoveryPosition,
  cycleState,
  cumulativeNetSellProceeds,
  pendingBuyCommitment,
  activeOrders,
  strategyStopped,
  marketPaused,
  reconciliationComplete,
}) {
  if (!marketPrice || typeof marketPrice.symbol !== "string" || !marketPrice.symbol.trim()) {
    throw new TypeError("Recovery Seller BUY policy requires a market symbol")
  }
  assertPositiveDecimal({
    value: marketPrice.price,
    field: "marketPrice.price",
  })
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Recovery Seller BUY policy requires pairConfig")
  }
  assertPositiveDecimal({
    value: String(pairConfig.orderQuantity),
    field: "pairConfig.orderQuantity",
  })
  assertPositiveDecimal({
    value: String(pairConfig.priceStepPercent),
    field: "pairConfig.priceStepPercent",
  })
  if (compareDecimal({
    left: String(pairConfig.priceStepPercent),
    right: "100",
  }) >= 0) {
    throw new RangeError("pairConfig.priceStepPercent must be less than 100")
  }
  if (pairConfig.investment !== undefined) {
    assertPositiveDecimal({
      value: String(pairConfig.investment),
      field: "pairConfig.investment",
    })
  }
  if (!marketMetadata?.market || marketMetadata.market.symbol !== marketPrice.symbol) {
    throw new TypeError("Recovery Seller BUY policy requires matching canonical market metadata")
  }
  if (typeof marketMetadata.orderType !== "string" || !marketMetadata.orderType.trim()) {
    throw new TypeError("Recovery Seller BUY policy requires a configured orderType")
  }
  if (!Array.isArray(marketMetadata.tradingRules?.constraints)) {
    throw new TypeError("Recovery Seller BUY policy requires normalized exchange trading rules")
  }
  if (!Array.isArray(activeOrders)) {
    throw new TypeError("Recovery Seller BUY policy activeOrders must be an array")
  }
  if (typeof strategyStopped !== "boolean" || typeof marketPaused !== "boolean" ||
      typeof reconciliationComplete !== "boolean") {
    throw new TypeError("Recovery Seller BUY policy requires explicit strategy, market and reconciliation readiness flags")
  }

  const recoverySpent = recoveryPosition === undefined || recoveryPosition === null
    ? "0"
    : recoveryPosition.spent
  assertNonNegativeDecimal({
    value: recoverySpent,
    field: "recoveryPosition.spent",
  })
  assertNonNegativeDecimal({
    value: cumulativeNetSellProceeds,
    field: "cumulativeNetSellProceeds",
  })
  assertNonNegativeDecimal({
    value: pendingBuyCommitment,
    field: "pendingBuyCommitment",
  })
  if (recoveryPosition === undefined || recoveryPosition === null) {
    if (compareDecimal({ left: cumulativeNetSellProceeds, right: "0" }) > 0) {
      throw new Error("Recovery Seller has SELL proceeds without a recovery Position")
    }
  }
  return {
    recoverySpent,
    priceTickSize: getRuleAmount({ marketMetadata, type: "PRICE_INCREMENT" }),
    quantityStepSize: getRuleAmount({ marketMetadata, type: "QUANTITY_INCREMENT" }),
    minQuantity: getRuleAmount({ marketMetadata, type: "MIN_QUANTITY" }),
    minNotional: getRuleAmount({ marketMetadata, type: "MIN_NOTIONAL" }),
    minPrice: getRuleAmount({ marketMetadata, type: "MIN_PRICE", required: false }),
    maxPrice: getRuleAmount({ marketMetadata, type: "MAX_PRICE", required: false }),
    maxQuantity: getRuleAmount({ marketMetadata, type: "MAX_QUANTITY", required: false }),
    maxNotional: getRuleAmount({ marketMetadata, type: "MAX_NOTIONAL", required: false }),
  }
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

function createStopAndReconcileIfOrderExists({
  stopState,
  activeOrders,
  symbol,
  explanation,
}) {
  if (Array.isArray(activeOrders)) {
    const existingOrder = activeOrders.find((order) =>
      order?.market?.symbol === symbol &&
      typeof order.clientOrderId === "string" &&
      order.clientOrderId.trim(),
    )
    if (existingOrder) {
      return createRecoverySellerStopAndReconcileDecision({
        stopState,
        orderIdentity: {
          clientOrderId: existingOrder.clientOrderId,
          ...(typeof existingOrder.brokerOrderId === "string" && existingOrder.brokerOrderId.trim()
            ? { brokerOrderId: existingOrder.brokerOrderId }
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

function findBlockingOrders({ activeOrders, symbol }) {
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
  return activeOrders.filter((order) => order.market.symbol === symbol)
}

function createCycleReconciliationResult({ stopState, orderIdentity, explanation }) {
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

function resolveExistingOrder({
  stopState,
  previousDecision,
  activeOrders,
  symbol,
  cycleState,
}) {
  const blockingOrders = findBlockingOrders({
    activeOrders,
    symbol,
  })

  if (["UNRESOLVED", "CLOSED"].includes(cycleState.status)) {
    if (blockingOrders.length > 0) {
      const [order] = blockingOrders
      return createCycleReconciliationResult({
        stopState,
        orderIdentity: order.clientOrderId
          ? {
            clientOrderId: order.clientOrderId,
            ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
          }
          : undefined,
        explanation: "Recovery Seller has an active order after its cycle became terminal or unresolved",
      })
    }
    const decision = createRecoverySellerLifecycleDecision({
      outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
      reasonCode: cycleState.status === "CLOSED" ? "CYCLE_CLOSED" : "CYCLE_UNRESOLVED",
      explanation: cycleState.status === "CLOSED"
        ? "The prior Recovery Seller cycle is closed; a distinct next-cycle state is required before another BUY"
        : "The Recovery Seller cycle has an unresolved terminal SELL and cannot start another BUY",
    })
    return applyRecoverySellerLifecycleTransition({
      stopState,
      previousDecision,
      nextDecision: decision,
    })
  }

  if (["SELL_SUBMITTED", "RECONCILIATION_REQUIRED"].includes(cycleState.status)) {
    const identity = cycleState.sellOrderIdentity
    const matchingOrders = blockingOrders.filter((order) =>
      order.clientOrderId === identity.clientOrderId)
    if (blockingOrders.length !== matchingOrders.length || matchingOrders.length > 1) {
      return createCycleReconciliationResult({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller cycle has an unexpected active order alongside its single submitted SELL",
      })
    }
    if (matchingOrders.length === 0) {
      return createCycleReconciliationResult({
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
      return createCycleReconciliationResult({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller active order identity conflicts with the cycle's single SELL identity",
      })
    }
    if (["PENDING", "UNKNOWN"].includes(order.status) ||
        typeof order.brokerOrderId !== "string" ||
        !order.brokerOrderId.trim()) {
      return createCycleReconciliationResult({
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
      return createCycleReconciliationResult({
        stopState,
        orderIdentity: identity,
        explanation: "Recovery Seller cycle SELL has an unsupported active-order state",
      })
    }
    const decision = createRecoverySellerLifecycleDecision({
      outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT,
      reasonCode: "WAIT_FOR_EXISTING_RS_SELL",
      explanation: "The cycle's single acknowledged SELL must remain unchanged until its authoritative terminal outcome is reconciled",
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

  if (cycleState.status !== "ACCUMULATING") {
    return createStopResult({
      stopState,
      explanation: "Recovery Seller cycle has an unsupported lifecycle status",
    })
  }

  const sellOrder = blockingOrders.find((order) => order.side === "SELL")
  if (sellOrder) {
    return createCycleReconciliationResult({
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

  if (blockingOrders.length === 0) {
    return undefined
  }
  if (blockingOrders.length > 1) {
    const [order] = blockingOrders
    return createCycleReconciliationResult({
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

  const [order] = blockingOrders
  if (["PENDING", "UNKNOWN"].includes(order.status) ||
      typeof order.brokerOrderId !== "string" ||
      !order.brokerOrderId.trim()) {
    return createCycleReconciliationResult({
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

  const decision = createRecoverySellerLifecycleDecision({
    outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT,
    reasonCode: "WAIT_FOR_EXISTING_RS_BUY",
    explanation: "An existing acknowledged Recovery Seller BUY must reach an authoritative terminal state before another tranche is considered",
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

function getBuyFilterReason({
  quantityMeetsMinimum,
  notionalMeetsMinimum,
  quantityWithinMaximum,
  notionalWithinMaximum,
  priceWithinFilters,
}) {
  if (!quantityMeetsMinimum) {
    return "MIN_QUANTITY"
  }
  if (!notionalMeetsMinimum) {
    return "MIN_NOTIONAL"
  }
  if (!quantityWithinMaximum) {
    return "MAX_QUANTITY"
  }
  if (!notionalWithinMaximum) {
    return "MAX_NOTIONAL"
  }
  if (!priceWithinFilters) {
    return "PRICE_FILTER"
  }
  return "UNKNOWN_FILTER"
}

function createBuyDisposition({ reason, buyPrice, buyQuantity, buyNotional, rules }) {
  return Object.freeze({
    status: "EXCHANGE_CONSTRAINED_BUY",
    reason,
    price: buyPrice,
    quantity: buyQuantity,
    notional: buyNotional,
    minimumQuantity: rules.minQuantity,
    minimumNotional: rules.minNotional,
    ...(rules.minPrice ? { minimumPrice: rules.minPrice } : {}),
    ...(rules.maxPrice ? { maximumPrice: rules.maxPrice } : {}),
    ...(rules.maxQuantity ? { maximumQuantity: rules.maxQuantity } : {}),
    ...(rules.maxNotional ? { maximumNotional: rules.maxNotional } : {}),
  })
}

function createLifecycleResult({ stopState, previousDecision, decision, action, buyDisposition }) {
  const gated = applyRecoverySellerLifecycleTransition({
    stopState,
    previousDecision,
    nextDecision: decision,
  })
  return Object.freeze({
    stopState: gated.stopState,
    ...(gated.stopState.status === "STOPPED" ? { stopDecision: gated.stopState.decision } : {}),
    decision: gated.decision,
    ...(gated.decision.outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.SUBMIT && action
      ? { action }
      : {}),
    ...(buyDisposition ? { buyDisposition } : {}),
  })
}

/**
 * Evaluate one RS BUY tranche using the established Conservative cadence,
 * configured orderQuantity, percentage-below-reference pricing and exchange
 * tick/step checks. This function is pure: it creates an intent decision only.
 *
 * activeOrders must contain only orders already resolved as owned by this RS
 * market/cycle through OrderRegistry ownership. Shared account balance and
 * aggregate reservations remain the Trading Engine allocator's responsibility.
 *
 * @param {object} input Pure market, pair, recovery accounting, order and STOP snapshots.
 * @returns {object} Immutable lifecycle decision and optional BUY intent.
 */
export function evaluateRecoverySellerBuyDecision({
  stopState,
  previousDecision,
  marketPrice,
  pairConfig,
  marketMetadata,
  recoveryPosition,
  cycleState,
  cumulativeNetSellProceeds = "0",
  pendingBuyCommitment = "0",
  activeOrders = [],
  strategyStopped,
  marketPaused,
  reconciliationComplete,
  lastBuyPrice,
} = {}) {
  if (!stopState) {
    throw new TypeError("Recovery Seller BUY policy requires a valid STOP state")
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
      if (existingOrderResult.stopState.status === "STOPPED") {
        return Object.freeze({
          ...existingOrderResult,
          ...(existingOrderResult.decision.outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK
            ? { stopDecision: existingOrderResult.stopState.decision }
            : {}),
        })
      }
      return existingOrderResult
    }
    if (stopState.status === "STOPPED") {
      const gated = applyRecoverySellerStopGate({
        stopState,
      })
      return Object.freeze({
        stopState: gated.stopState,
        stopDecision: gated.stopState.decision,
        decision: gated.decision,
      })
    }

    const rules = validateInput({
      marketPrice,
      pairConfig,
      marketMetadata,
      recoveryPosition,
      cycleState,
      cumulativeNetSellProceeds,
      pendingBuyCommitment,
      activeOrders,
      strategyStopped,
      marketPaused,
      reconciliationComplete,
    })

    if (compareDecimal({ left: pendingBuyCommitment, right: "0" }) > 0) {
      return createStopResult({
        stopState,
        explanation: "Recovery Seller has an unresolved BUY commitment without an identifiable active order",
      })
    }

    const readinessBlock = strategyStopped
      ? {
        reasonCode: "STRATEGY_STOPPED",
        explanation: "Recovery Seller is stopped by its operator and may not create a new BUY",
      }
      : marketPaused
        ? {
          reasonCode: "MARKET_PAUSED",
          explanation: "The market is paused and Recovery Seller may not create a new BUY",
        }
        : !reconciliationComplete
          ? {
            reasonCode: "RECONCILIATION_INCOMPLETE",
            explanation: "Recovery Seller cannot create a new BUY while order, fill, inventory or reservation reconciliation is incomplete",
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
      })
    }

    const hasRecoveryPosition = compareDecimal({
      left: rules.recoverySpent,
      right: "0",
    }) > 0
    if (hasRecoveryPosition && lastBuyPrice === undefined) {
      throw new Error("Active Recovery Seller Position requires reconciled completed-BUY VWAP before the next standing BUY")
    }

    const referencePrice = lastBuyPrice ?? marketPrice.price
    assertPositiveDecimal({
      value: referencePrice,
      field: "lastBuyPrice",
    })
    const buyPrice = calculateInitialBuyPrice({
      lastTradePrice: referencePrice,
      priceStepPercent: String(pairConfig.priceStepPercent),
      priceTickSize: rules.priceTickSize,
    }).price
    const buyQuantity = roundDecimalToIncrement({
      value: String(pairConfig.orderQuantity),
      increment: rules.quantityStepSize,
      direction: "down",
    })
    const buyNotional = multiplyDecimal({
      left: buyPrice,
      right: buyQuantity,
    })

    const quantityMeetsMinimum = compareDecimal({
      left: buyQuantity,
      right: rules.minQuantity,
    }) >= 0
    const notionalMeetsMinimum = compareDecimal({
      left: buyNotional,
      right: rules.minNotional,
    }) >= 0
    const quantityWithinMaximum = !rules.maxQuantity ||
      compareDecimal({ left: buyQuantity, right: rules.maxQuantity }) <= 0
    const notionalWithinMaximum = !rules.maxNotional ||
      compareDecimal({ left: buyNotional, right: rules.maxNotional }) <= 0
    const priceWithinFilters =
      (!rules.minPrice || compareDecimal({ left: buyPrice, right: rules.minPrice }) >= 0) &&
      (!rules.maxPrice || compareDecimal({ left: buyPrice, right: rules.maxPrice }) <= 0)

    if (!quantityMeetsMinimum || !notionalMeetsMinimum ||
        !quantityWithinMaximum || !notionalWithinMaximum || !priceWithinFilters) {
      const reason = getBuyFilterReason({
        quantityMeetsMinimum,
        notionalMeetsMinimum,
        quantityWithinMaximum,
        notionalWithinMaximum,
        priceWithinFilters,
      })
      const decision = createRecoverySellerLifecycleDecision({
        outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
        reasonCode: "BUY_EXCHANGE_FILTER_REJECTED",
        explanation: `Recovery Seller BUY is outside the current exchange filters: ${reason}`,
      })
      return createLifecycleResult({
        stopState,
        previousDecision,
        decision,
        buyDisposition: createBuyDisposition({
          reason,
          buyPrice,
          buyQuantity,
          buyNotional,
          rules,
        }),
      })
    }

    if (pairConfig.investment !== undefined) {
      const outstandingRecovery = maxDecimal({
        left: "0",
        right: subtractDecimal({
          left: rules.recoverySpent,
          right: cumulativeNetSellProceeds,
        }),
      })
      const committedExposure = addDecimal({
        left: outstandingRecovery,
        right: pendingBuyCommitment,
      })
      const proposedExposure = addDecimal({
        left: committedExposure,
        right: buyNotional,
      })
      if (compareDecimal({
        left: proposedExposure,
        right: String(pairConfig.investment),
      }) > 0) {
        const decision = createRecoverySellerLifecycleDecision({
          outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
          reasonCode: "INVESTMENT_LIMIT_REACHED",
          explanation: "Recovery Seller's own per-pair investment limit blocks another BUY tranche",
        })
        return createLifecycleResult({
          stopState,
          previousDecision,
          decision,
        })
      }
    }

    const decision = createRecoverySellerLifecycleDecision({
      outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.SUBMIT,
      reasonCode: "BUY_TRANCHE_ELIGIBLE",
      explanation: "Recovery Seller BUY tranche passed its pure policy and exchange-filter checks",
    })
    return createLifecycleResult({
      stopState,
      previousDecision,
      decision,
      action: Object.freeze({
        side: "BUY",
        type: marketMetadata.orderType,
        price: buyPrice,
        quantity: buyQuantity,
        notional: buyNotional,
        reason: hasRecoveryPosition ? "NEXT_STANDING_BUY" : "INITIAL_BUY",
      }),
    })
  } catch (error) {
    return createStopAndReconcileIfOrderExists({
      stopState,
      activeOrders,
      symbol: marketPrice?.symbol,
      explanation: error instanceof Error && error.message
        ? `Recovery Seller BUY policy failed closed: ${error.message}`
        : "Recovery Seller BUY policy encountered an unmodeled condition",
    })
  }
}
