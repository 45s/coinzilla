import { createHash } from "node:crypto"
import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { ensure, toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import {
  RECOVERY_SELLER_ACCOUNTING_ERROR_CODES,
  RecoverySellerAccountingError,
} from "../domain/strategies/recovery-seller/recovery-seller-accounting-error.js"

const TERMINAL_ORDER_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

function createFactId({ marketId, cycleId, sellOrderClientId, sellOrderBrokerOrderId }) {
  const identity = JSON.stringify([
    marketId,
    cycleId,
    sellOrderClientId,
    sellOrderBrokerOrderId,
  ])
  const digest = createHash("sha256").update(identity).digest("hex")
  return `recovery-seller-mixed-sell-reconciled:${digest}`
}

function createReconciliationInputError({ message, options, cause }) {
  return new RecoverySellerAccountingError({
    code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.RECONCILIATION_INVALID,
    message,
    context: {
      marketId: options.terminalOrder?.market?.id ?? null,
      cycleId: options.ownership?.cycleId ?? null,
      sellOrderClientId: options.terminalOrder?.clientOrderId ?? null,
    },
    cause,
  })
}

function validateTerminalOrder({ terminalOrder, options }) {
  if (!(terminalOrder instanceof CanonicalOrder) ||
      !TERMINAL_ORDER_STATUSES.has(terminalOrder.status) ||
      typeof terminalOrder.brokerOrderId !== "string" ||
      !terminalOrder.brokerOrderId.trim()) {
    throw createReconciliationInputError({
      message: "Recovery Seller mixed-SELL reconciliation requires an acknowledged terminal CanonicalOrder",
      options,
    })
  }
}

function validateRecoverySellerOwnership({ ownership, options }) {
  if (
    ownership?.strategyId !== StrategyId.RECOVERY_SELLER ||
    ownership.purpose !== "RECOVERY_SELL" ||
    typeof ownership.cycleId !== "string" || !ownership.cycleId.trim() ||
    typeof ownership.positionId !== "string" || !ownership.positionId.trim()
  ) {
    throw createReconciliationInputError({
      message: "Recovery Seller mixed-SELL reconciliation requires immutable cycle and Position ownership",
      options,
    })
  }
}

function validateCommittedAccounting({ accountingApplied, eligible, options }) {
  if (accountingApplied !== true) {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.ACCOUNTING_NOT_COMMITTED,
      message: "Recovery Seller mixed-SELL reconciliation requires a committed accounting result",
      context: {
        marketId: options.terminalOrder?.market?.id ?? null,
        cycleId: options.ownership?.cycleId ?? null,
        sellOrderClientId: options.terminalOrder?.clientOrderId ?? null,
      },
    })
  }
  if (typeof eligible !== "boolean") {
    throw createReconciliationInputError({
      message: "Recovery Seller mixed-SELL reconciliation requires an explicit eligibility result",
      options,
    })
  }
}

function validateCanonicalSellFills({ canonicalFills, terminalOrder, options }) {
  if (!Array.isArray(canonicalFills) || canonicalFills.length === 0) {
    throw createReconciliationInputError({
      message: "Recovery Seller mixed-SELL reconciliation requires the complete canonical terminal fill set",
      options,
    })
  }
  const fillIds = new Set()
  for (const fill of canonicalFills) {
    if (!(fill instanceof Fill) ||
        fill.side !== "SELL" ||
        fill.market.id !== terminalOrder.market.id ||
        fill.clientOrderId !== terminalOrder.clientOrderId ||
        fill.brokerOrderId !== terminalOrder.brokerOrderId ||
        fillIds.has(fill.id)) {
      throw createReconciliationInputError({
        message: "Recovery Seller mixed-SELL reconciliation contains missing, duplicate or foreign canonical fills",
        options,
      })
    }
    fillIds.add(fill.id)
  }
  return Object.freeze([...fillIds].sort())
}

function validateReconciliationInput(options) {
  const {
    operationalStateStore,
    terminalOrder,
    ownership,
    canonicalFills,
    accountingApplied,
    eligible,
  } = options
  try {
    ensure.function({
      value: operationalStateStore?.append,
      name: "operationalStateStore.append",
    })
  } catch (cause) {
    throw createReconciliationInputError({
      message: "Recovery Seller mixed-SELL reconciliation requires durable Operational State Store append",
      options,
      cause,
    })
  }
  validateTerminalOrder({
    terminalOrder,
    options,
  })
  validateRecoverySellerOwnership({
    ownership,
    options,
  })
  validateCommittedAccounting({
    accountingApplied,
    eligible,
    options,
  })
  return validateCanonicalSellFills({
    canonicalFills,
    terminalOrder,
    options,
  })
}
/**
 * Commit the durable boundary after terminal mixed-SELL accounting has applied
 * both the shared Portfolio and legacy projections. A terminal order status or
 * a fill fact by itself is never sufficient to release the cycle reservation.
 */
function createRecoverySellerMixedSellReconciledFact({
  terminalOrder,
  ownership,
  appliedFillIds,
  eligible,
}) {
  const { market } = terminalOrder
  const factId = createFactId({
    marketId: market.id,
    cycleId: ownership.cycleId,
    sellOrderClientId: terminalOrder.clientOrderId,
    sellOrderBrokerOrderId: terminalOrder.brokerOrderId,
  })
  return {
    factId,
    factType: "RECOVERY_SELLER_MIXED_SELL_RECONCILED",
    data: {
      cycleId: ownership.cycleId,
      marketId: market.id,
      venue: market.venue,
      symbol: market.symbol,
      baseAssetId: market.baseAsset.id,
      quoteAssetId: market.quoteAsset.id,
      sellOrderClientId: terminalOrder.clientOrderId,
      sellOrderBrokerOrderId: terminalOrder.brokerOrderId,
      terminalStatus: terminalOrder.status,
      appliedFillIds,
      accountingApplied: true,
      eligible,
    },
  }
}

function createDurableFactCommitError({ options, message, cause }) {
  return new RecoverySellerAccountingError({
    code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.DURABLE_FACT_COMMIT_FAILED,
    message,
    context: {
      marketId: options.terminalOrder?.market?.id ?? null,
      cycleId: options.ownership?.cycleId ?? null,
      sellOrderClientId: options.terminalOrder?.clientOrderId ?? null,
    },
    cause,
  })
}

async function appendRecoverySellerMixedSellReconciliationFact({
  operationalStateStore,
  fact,
  options,
}) {
  let result
  try {
    result = await operationalStateStore.append(fact)
  } catch (cause) {
    throw createDurableFactCommitError({
      options,
      message: "Recovery Seller mixed-SELL reconciliation fact append failed",
      cause,
    })
  }
  if (result?.ok !== true || result.data?.durable !== true) {
    throw createDurableFactCommitError({
      options,
      message: "Recovery Seller mixed-SELL reconciliation fact append was not durably confirmed",
      cause: result?.errors?.[0],
    })
  }
  return result
}

function normalizeRecoverySellerReconciliationError({ error, options }) {
  if (error instanceof RecoverySellerAccountingError) {
    return error
  }
  return createDurableFactCommitError({
    options,
    message: "Recovery Seller mixed-SELL reconciliation fact could not be recorded",
    cause: error,
  })
}

export async function recordRecoverySellerMixedSellReconciled(options = {}) {
  try {
    const {
      operationalStateStore,
      terminalOrder,
      ownership,
      eligible,
    } = options
    const appliedFillIds = validateReconciliationInput(options)
    const fact = createRecoverySellerMixedSellReconciledFact({
      terminalOrder,
      ownership,
      appliedFillIds,
      eligible,
    })
    return await appendRecoverySellerMixedSellReconciliationFact({
      operationalStateStore,
      fact,
      options,
    })
  } catch (error) {
    return toResult({
      error: normalizeRecoverySellerReconciliationError({
        error,
        options,
      }),
    })
  }
}
