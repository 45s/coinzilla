import {
  assertDecimalString,
  compareDecimal,
  roundDecimalToIncrement,
  toResult,
} from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { evaluateRecoverySellerBuyDecision } from "../domain/strategies/recovery-seller/evaluate-buy-decision.js"
import { evaluateRecoverySellerSellDecision } from "../domain/strategies/recovery-seller/evaluate-sell-decision.js"

function validateTransitionInput({ symbol, marketPrice, marketMetadata, pairConfig }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("Recovery Seller transition requires a market symbol")
  }
  if (!marketPrice || marketPrice.symbol !== symbol) {
    throw new TypeError("Recovery Seller transition requires a matching market-price snapshot")
  }
  assertDecimalString({
    value: marketPrice.price,
    field: "marketPrice.price",
  })
  if (compareDecimal({
    left: marketPrice.price,
    right: "0",
  }) <= 0) {
    throw new RangeError("marketPrice.price must be greater than zero")
  }
  if (!marketMetadata?.market || marketMetadata.market.symbol !== symbol) {
    throw new TypeError("Recovery Seller transition requires matching canonical market metadata")
  }
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Recovery Seller transition requires pairConfig")
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Recovery Seller transition snapshot must be an object")
  }
  if (!Array.isArray(snapshot.activeOrders)) {
    throw new TypeError("Recovery Seller transition snapshot activeOrders must be an array")
  }
  if (typeof snapshot.strategyStopped !== "boolean" ||
      typeof snapshot.marketPaused !== "boolean" ||
      typeof snapshot.reconciliationComplete !== "boolean" ||
      typeof snapshot.sellAdmissionBlocked !== "boolean") {
    throw new TypeError("Recovery Seller transition snapshot requires explicit readiness flags")
  }
  return snapshot
}

function hasRecoveryInventory({ recoveryPosition }) {
  if (recoveryPosition === undefined || recoveryPosition === null) {
    return false
  }
  assertDecimalString({
    value: recoveryPosition.quantity,
    field: "recoveryPosition.quantity",
  })
  return compareDecimal({
    left: recoveryPosition.quantity,
    right: "0",
  }) > 0
}

function canEvaluateSell({ snapshot }) {
  return snapshot.activeOrders.length === 0 &&
    snapshot.cycleState?.status === "ACCUMULATING" &&
    snapshot.strategyStopped === false &&
    snapshot.sellAdmissionBlocked === false &&
    snapshot.marketPaused === false &&
    snapshot.reconciliationComplete === true &&
    hasRecoveryInventory({
      recoveryPosition: snapshot.recoveryPosition,
    })
}

function getPriceTickSize({ marketMetadata }) {
  const { constraints: rules } = marketMetadata.tradingRules ?? {}
  if (!Array.isArray(rules)) {
    throw new TypeError("Recovery Seller SELL submission requires normalized exchange trading rules")
  }
  const matches = rules.filter((rule) => rule.type === "PRICE_INCREMENT")
  if (matches.length !== 1 || matches[0].status !== "SUPPORTED") {
    throw new Error("Recovery Seller SELL submission requires one supported PRICE_INCREMENT rule")
  }
  const amount = matches[0].value?.amount
  assertDecimalString({
    value: amount,
    field: "PRICE_INCREMENT",
  })
  if (compareDecimal({
    left: amount,
    right: "0",
  }) <= 0) {
    throw new RangeError("PRICE_INCREMENT must be greater than zero")
  }
  return amount
}

function createSellAction({ sellDecision, snapshot, marketPrice, marketMetadata }) {
  if (sellDecision.decision?.outcome !== "SUBMIT") {
    return undefined
  }
  const { orderIntent } = sellDecision
  if (!orderIntent?.plan || orderIntent.side !== "SELL") {
    throw new TypeError("Recovery Seller SELL policy returned an incomplete order intent")
  }
  assertDecimalString({
    value: orderIntent.plan.price,
    field: "sellPlan.price",
  })
  if (compareDecimal({
    left: marketPrice.price,
    right: orderIntent.plan.price,
  }) < 0) {
    return undefined
  }
  const price = roundDecimalToIncrement({
    value: marketPrice.price,
    increment: getPriceTickSize({
      marketMetadata,
    }),
    direction: "up",
  })
  if (compareDecimal({
    left: price,
    right: orderIntent.plan.price,
  }) < 0) {
    throw new Error("Recovery Seller SELL execution price fell below its planned profitability target")
  }
  return Object.freeze({
    ...orderIntent,
    side: "SELL",
    purpose: "RECOVERY_SELL",
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: snapshot.cycleState.positionId,
    cycleId: snapshot.cycleState.cycleId,
    price,
  })
}

function createBuyAction({ buyDecision }) {
  if (buyDecision.decision?.outcome !== "SUBMIT") {
    return undefined
  }
  if (!buyDecision.action || buyDecision.action.side !== "BUY") {
    throw new TypeError("Recovery Seller BUY policy returned an incomplete order action")
  }
  return Object.freeze({
    ...buyDecision.action,
    strategyId: StrategyId.RECOVERY_SELLER,
  })
}

function evaluateBuy({ evaluateBuyDecision, snapshot, input }) {
  return evaluateBuyDecision({
    ...snapshot,
    strategyStopped: snapshot.strategyStopped === true || snapshot.buyAdmissionBlocked === true,
    marketPrice: input.marketPrice,
    marketMetadata: input.marketMetadata,
    pairConfig: input.pairConfig,
  })
}

function evaluateSell({ evaluateSellDecision, snapshot, input }) {
  return evaluateSellDecision({
    pairConfig: input.pairConfig,
    marketMetadata: input.marketMetadata,
    cycleState: snapshot.cycleState,
    stopState: snapshot.stopState,
    planInput: snapshot.planInput,
  })
}

/**
 * Compose the pure Recovery Seller BUY/SELL policies with the durable order
 * submitter. The SELL policy's planned minimum price is the trigger: below it,
 * the evaluator continues the next BUY tranche; at/above it, the evaluator
 * submits one owned mixed SELL. Existing orders, STOP, pause and incomplete
 * reconciliation always take precedence over new actions.
 *
 * The snapshot provider owns recovery-cycle identity, actual BUY VWAP,
 * Position/legacy accounting, available Spot allocation and pending BUY
 * commitment. This evaluator does not invent or persist those facts.
 *
 * @param {object} input Dependencies for reading the current RS snapshot and submitting one owned action.
 * @param {Function} input.getSnapshot Read the authoritative market/cycle/account snapshot.
 * @param {Function} input.submitOrder Submit through createRecoverySellerOrderSubmitter.
 * @param {Function} [input.authorizeAction] Authorize account-wide quote/base commitments before submission.
 * @param {Function} [input.evaluateBuyDecision] Pure RS BUY policy override for testing.
 * @param {Function} [input.evaluateSellDecision] Pure RS SELL policy override for testing.
 * @returns {Function} Async transition evaluator for createLatestTransitionEvaluator.
 */
async function submitAuthorizedAction({
  authorizeAction,
  submitOrder,
  action,
  lifecycleDecision,
  snapshot,
  input,
} = {}) {
  const authorization = await authorizeAction({
    action,
    lifecycleDecision,
    snapshot,
    input,
  })
  if (authorization?.ok !== true || authorization.data?.allowed !== true) {
    if (authorization?.ok === true || authorization?.ok === false) {
      return authorization
    }
    return toResult({
      error: new TypeError("Recovery Seller action authorization returned an invalid result"),
    })
  }
  return submitOrder({
    lifecycleDecision,
    action,
    marketMetadata: input.marketMetadata,
  })
}

async function evaluateRecoverySellerSellTransition({
  input,
  snapshot,
  submitOrder,
  authorizeAction,
  evaluateSellDecision,
}) {
  const sellDecision = evaluateSell({
    evaluateSellDecision,
    snapshot,
    input,
  })
  if (sellDecision.decision?.outcome !== "SUBMIT") {
    return sellDecision
  }
  const action = createSellAction({
    sellDecision,
    snapshot,
    marketPrice: input.marketPrice,
    marketMetadata: input.marketMetadata,
  })
  if (!action) {
    return undefined
  }
  return submitAuthorizedAction({
    authorizeAction,
    submitOrder,
    action,
    lifecycleDecision: sellDecision.decision,
    snapshot,
    input,
  })
}

async function evaluateRecoverySellerBuyTransition({
  input,
  snapshot,
  submitOrder,
  authorizeAction,
  evaluateBuyDecision,
}) {
  const buyDecision = evaluateBuy({
    evaluateBuyDecision,
    snapshot,
    input,
  })
  const action = createBuyAction({
    buyDecision,
  })
  if (!action) {
    return buyDecision
  }
  return submitAuthorizedAction({
    authorizeAction,
    submitOrder,
    action,
    lifecycleDecision: buyDecision.decision,
    snapshot,
    input,
  })
}

async function evaluateRecoverySellerTransition({
  input,
  getSnapshot,
  submitOrder,
  authorizeAction,
  evaluateBuyDecision,
  evaluateSellDecision,
}) {
  try {
    validateTransitionInput(input)
    const snapshot = validateSnapshot(await getSnapshot(input))
    if (canEvaluateSell({ snapshot })) {
      const sellResult = await evaluateRecoverySellerSellTransition({
        input,
        snapshot,
        submitOrder,
        authorizeAction,
        evaluateSellDecision,
      })
      if (sellResult !== undefined) {
        return sellResult
      }
    }
    return evaluateRecoverySellerBuyTransition({
      input,
      snapshot,
      submitOrder,
      authorizeAction,
      evaluateBuyDecision,
    })
  } catch (error) {
    return toResult({
      error,
    })
  }
}

/**
 * Compose the pure Recovery Seller BUY/SELL policies with the durable order
 * submitter. The SELL policy's planned minimum price is the trigger: below it,
 * the evaluator continues the next BUY tranche; at/above it, the evaluator
 * submits one owned mixed SELL. Existing orders, STOP, pause and incomplete
 * reconciliation always take precedence over new actions.
 *
 * The snapshot provider owns recovery-cycle identity, actual BUY VWAP,
 * Position/legacy accounting, available Spot allocation and pending BUY
 * commitment. This evaluator does not invent or persist those facts.
 *
 * @param {object} input Dependencies for reading the current RS snapshot and submitting one owned action.
 * @param {Function} input.getSnapshot Read the authoritative market/cycle/account snapshot.
 * @param {Function} input.submitOrder Submit through createRecoverySellerOrderSubmitter.
 * @param {Function} [input.evaluateBuyDecision] Pure RS BUY policy override for testing.
 * @param {Function} [input.evaluateSellDecision] Pure RS SELL policy override for testing.
 * @returns {Function} Async transition evaluator for createLatestTransitionEvaluator.
 */
export function createRecoverySellerTransitionEvaluator({
  getSnapshot,
  submitOrder,
  authorizeAction = async () => toResult({ data: { allowed: true } }),
  evaluateBuyDecision = evaluateRecoverySellerBuyDecision,
  evaluateSellDecision = evaluateRecoverySellerSellDecision,
} = {}) {
  for (const [name, callback] of Object.entries({
    getSnapshot,
    submitOrder,
    authorizeAction,
    evaluateBuyDecision,
    evaluateSellDecision,
  })) {
    if (typeof callback !== "function") {
      throw new TypeError(`${name} must be a function`)
    }
  }
  return (input = {}) => evaluateRecoverySellerTransition({
    input,
    getSnapshot,
    submitOrder,
    authorizeAction,
    evaluateBuyDecision,
    evaluateSellDecision,
  })
}
