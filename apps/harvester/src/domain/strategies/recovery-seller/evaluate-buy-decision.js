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
  cumulativeNetSellProceeds,
  pendingBuyCommitment,
  activeOrders,
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

function findBlockingOrders({ activeOrders, symbol }) {
  return activeOrders.filter((order) =>
    order?.market?.symbol === symbol &&
    ACTIVE_ORDER_STATUSES.has(order.status),
  )
}

function resolveExistingOrder({ stopState, activeOrders, symbol }) {
  const blockingOrders = findBlockingOrders({
    activeOrders,
    symbol,
  })
  if (blockingOrders.length === 0) {
    return undefined
  }
  if (blockingOrders.length > 1) {
    const unresolved = blockingOrders.find((order) =>
      ["PENDING", "UNKNOWN"].includes(order.status) ||
      typeof order.brokerOrderId !== "string" ||
      !order.brokerOrderId.trim())
    if (unresolved && typeof unresolved.clientOrderId === "string" && unresolved.clientOrderId.trim()) {
      return createRecoverySellerStopAndReconcileDecision({
        stopState,
        orderIdentity: {
          clientOrderId: unresolved.clientOrderId,
          ...(unresolved.brokerOrderId ? { brokerOrderId: unresolved.brokerOrderId } : {}),
        },
        explanation: "Recovery Seller has multiple active orders or an unresolved submission identity for this market",
      })
    }
    return createStopResult({
      stopState,
      explanation: "Recovery Seller has multiple active orders for one market; order ownership or cycle state is inconsistent",
    })
  }

  const [order] = blockingOrders
  if (["PENDING", "UNKNOWN"].includes(order.status) ||
      typeof order.brokerOrderId !== "string" ||
      !order.brokerOrderId.trim()) {
    if (typeof order.clientOrderId !== "string" || !order.clientOrderId.trim()) {
      return createStopResult({
        stopState,
        explanation: "Recovery Seller has an unresolved active order without its original clientOrderId",
      })
    }
    return createRecoverySellerStopAndReconcileDecision({
      stopState,
      orderIdentity: {
        clientOrderId: order.clientOrderId,
        ...(order.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
      },
      explanation: "Recovery Seller order submission or acknowledgement outcome is unresolved",
    })
  }

  if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status) ||
      typeof order.clientOrderId !== "string" ||
      !order.clientOrderId.trim()) {
    return createStopResult({
      stopState,
      explanation: "Recovery Seller active order has an unsupported status or incomplete canonical identity",
    })
  }

  const decision = createRecoverySellerLifecycleDecision({
    outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT,
    reasonCode: "WAIT_FOR_EXISTING_RS_ORDER",
    explanation: "An existing acknowledged Recovery Seller order must reach an authoritative terminal state before another BUY is considered",
    orderIdentity: {
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    },
  })
  return applyRecoverySellerLifecycleTransition({
    stopState,
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
  cumulativeNetSellProceeds = "0",
  pendingBuyCommitment = "0",
  activeOrders = [],
  lastBuyPrice,
} = {}) {
  if (!stopState) {
    throw new TypeError("Recovery Seller BUY policy requires a valid STOP state")
  }

  const existingOrderResult = resolveExistingOrder({
    stopState,
    activeOrders,
    symbol: marketPrice?.symbol,
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

  try {
    const rules = validateInput({
      marketPrice,
      pairConfig,
      marketMetadata,
      recoveryPosition,
      cumulativeNetSellProceeds,
      pendingBuyCommitment,
      activeOrders,
    })

    if (compareDecimal({ left: pendingBuyCommitment, right: "0" }) > 0) {
      return createStopResult({
        stopState,
        explanation: "Recovery Seller has an unresolved BUY commitment without an identifiable active order",
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
    return createStopResult({
      stopState,
      explanation: error instanceof Error && error.message
        ? `Recovery Seller BUY policy failed closed: ${error.message}`
        : "Recovery Seller BUY policy encountered an unmodeled condition",
    })
  }
}
