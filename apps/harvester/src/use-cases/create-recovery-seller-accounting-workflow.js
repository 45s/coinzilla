import { randomUUID } from "node:crypto"
import { CanonicalOrder, Fill } from "@coinzilla/entities"
import {
  addDecimal,
  DECIMAL_ROUNDING_MODES,
  divideDecimal,
  ensure,
  multiplyDecimal,
  subtractDecimal,
  toResult,
} from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { createPositionId } from "../domain/portfolio/position.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { validateStrategySubmissionOwnership } from "../domain/orders/recovery-seller-submission-ownership.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import {
  RECOVERY_SELLER_ACCOUNTING_ERROR_CODES,
  RecoverySellerAccountingError,
} from "../domain/strategies/recovery-seller/recovery-seller-accounting-error.js"
import { applyReconciledMixedSellOrder } from "../domain/strategies/recovery-seller/mixed-sell-fill-accounting.js"
import { calculateRecoverySellerProfitability } from "../domain/strategies/recovery-seller/calculate-profitability.js"
import {
  createRecoverySellerCycleState,
  recordRecoverySellerCycleSellSubmission,
  reconcileRecoverySellerCycleSell,
} from "../domain/strategies/recovery-seller/cycle-state.js"

import {
  createLegacyPositionMap,
  initializeLegacyPositionsTransition,
  getLegacyPositionRecord,
  createAdditionalTrackedQuoteCashFlow,
  createAdditionalTrackedBaseQuantity,
} from "../domain/strategies/recovery-seller/legacy-accounting-state.js"
import {
  createRecoverySellerExecutionCallbacks,
} from "./recovery-seller-order-callbacks.js"

const TERMINAL_ORDER_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

/**
 * Build the canonical domain cycle state while retaining application market routing context.
 * @param {object} input Cycle identity, lifecycle status and optional sole-SELL identity.
 * @returns {object} Immutable canonical RS cycle state with its application market identifier.
 */
function createRecoverySellerTransitionCycleState({
  marketId,
  cycleId,
  positionId,
  status = "ACCUMULATING",
  orderIdentity,
}) {
  const accumulatingState = createRecoverySellerCycleState({
    cycleId,
    positionId,
  })
  const cycleState = status === "SELL_SUBMITTED"
    ? recordRecoverySellerCycleSellSubmission({
        state: accumulatingState,
        orderIdentity,
      })
    : accumulatingState
  return Object.freeze({
    ...cycleState,
    marketId,
  })
}

function calculateNetAllocatedQuoteProceeds({ allocationSide, quoteAssetId }) {
  let netProceeds = allocationSide.quoteProceeds
  for (const commission of allocationSide.commissions) {
    if (commission.assetId === quoteAssetId) {
      netProceeds = subtractDecimal({
        left: netProceeds,
        right: commission.amount,
      })
    } else if (commission.quoteValue !== undefined) {
      netProceeds = subtractDecimal({
        left: netProceeds,
        right: commission.quoteValue.amount,
      })
    }
  }
  return netProceeds
}

function calculateAllocationTotals({ canonicalFillAllocations, quoteAssetId }) {
  const totals = {
    recoveryNetQuoteProceeds: "0",
    legacyNetQuoteProceeds: "0",
    legacyBaseDebit: "0",
  }
  for (const allocation of canonicalFillAllocations) {
    totals.recoveryNetQuoteProceeds = addDecimal({
      left: totals.recoveryNetQuoteProceeds,
      right: calculateNetAllocatedQuoteProceeds({
        allocationSide: allocation.recovery,
        quoteAssetId,
      }),
    })
    totals.legacyNetQuoteProceeds = addDecimal({
      left: totals.legacyNetQuoteProceeds,
      right: calculateNetAllocatedQuoteProceeds({
        allocationSide: allocation.legacy,
        quoteAssetId,
      }),
    })
    totals.legacyBaseDebit = addDecimal({
      left: totals.legacyBaseDebit,
      right: allocation.legacy.baseDebit,
    })
  }
  return Object.freeze(totals)
}

function calculateOrderProfitability({
  portfolio,
  positionId,
  legacyPosition,
  market,
  canonicalFillAllocations,
  minProfit,
}) {
  const recoveryPosition = portfolio.getPosition({
    marketId: market.id,
    positionId,
  })
  if (!recoveryPosition) {
    throw new TypeError("Recovery Seller profitability requires its owned recovery Position")
  }
  const totals = calculateAllocationTotals({
    canonicalFillAllocations,
    quoteAssetId: market.quoteAsset.id,
  })
  return calculateRecoverySellerProfitability({
    recoveryCostBasis: recoveryPosition.spent.amount,
    recoveryNetQuoteProceeds: totals.recoveryNetQuoteProceeds,
    minProfit,
    legacyAverageCost: legacyPosition.averageCost,
    legacyBaseDebit: totals.legacyBaseDebit,
    legacyNetQuoteProceeds: totals.legacyNetQuoteProceeds,
  })
}

function resolveRecoverySellerBuyOrderOwnership({ registry, fill }) {
  if (!(fill instanceof Fill) || fill.side !== "BUY") {
    throw new TypeError("Recovery Seller BUY accounting requires a canonical BUY Fill")
  }
  const order = registry.getOrder({ clientOrderId: fill.clientOrderId })
  if (!order ||
      order.status === "REJECTED" ||
      order.side !== "BUY" ||
      order.market.id !== fill.market.id ||
      order.brokerOrderId !== fill.brokerOrderId) {
    throw new Error("Recovery Seller BUY Fill does not match a registered broker order identity")
  }
  const ownership = registry.getOwnership({
    clientOrderId: fill.clientOrderId,
    brokerOrderId: fill.brokerOrderId,
  })
  if (!ownership ||
      ownership.strategyId !== StrategyId.RECOVERY_SELLER ||
      ownership.purpose !== "RECOVERY_BUY" ||
      typeof ownership.cycleId !== "string" ||
      !ownership.cycleId.trim()) {
    throw new Error("Recovery Seller BUY Fill requires registered RS Position and cycle ownership")
  }
  return {
    order,
    ownership,
  }
}

function assertCanonicalRecoverySellerBuyFillQuantities({ fill } = {}) {
  const quantity = fill.quantity?.amount
  const quoteQuantity = fill.quoteQuantity?.amount
  const hasCanonicalQuantities = typeof quantity === "string" &&
    typeof quoteQuantity === "string" &&
    fill.quantity.asset.id === fill.market.baseAsset.id &&
    fill.quoteQuantity.asset.id === fill.market.quoteAsset.id
  if (!hasCanonicalQuantities) {
    throw new TypeError("Recovery Seller BUY execution requires canonical base and quote quantities")
  }
  return {
    quantity,
    quoteQuantity,
  }
}

function isRecoverySellerBuyExecutionIdentityCompatible({ existing, identity } = {}) {
  if (!existing) {
    return true
  }
  return existing.marketId === identity.marketId &&
    existing.positionId === identity.positionId &&
    existing.baseAssetId === identity.baseAssetId &&
    existing.quoteAssetId === identity.quoteAssetId
}

function createNextRecoverySellerBuyExecution({ state, fill, ownership } = {}) {
  const { quantity, quoteQuantity } = assertCanonicalRecoverySellerBuyFillQuantities({ fill })
  const existing = state.recoverySellerBuyExecutionByCycle.get(ownership.cycleId)
  const identity = {
    cycleId: ownership.cycleId,
    marketId: fill.market.id,
    positionId: ownership.positionId,
    baseAssetId: fill.market.baseAsset.id,
    quoteAssetId: fill.market.quoteAsset.id,
  }
  if (!isRecoverySellerBuyExecutionIdentityCompatible({
    existing,
    identity,
  })) {
    throw new Error("Recovery Seller cycle identity was reused across a different market, Position or asset pair")
  }
  return Object.freeze({
    ...identity,
    quantity: addDecimal({
      left: existing?.quantity ?? "0",
      right: quantity,
    }),
    quoteQuantity: addDecimal({
      left: existing?.quoteQuantity ?? "0",
      right: quoteQuantity,
    }),
  })
}

function calculateRecoverySellerBuyExecutionVwap({ execution } = {}) {
  if (!execution) {
    return undefined
  }
  return divideDecimal({
    left: execution.quoteQuantity,
    right: execution.quantity,
    scale: 18,
    rounding: DECIMAL_ROUNDING_MODES.TOWARD_ZERO,
  })
}

async function applyRecoverySellerBuyFillTransition({
  state,
  fill,
  onOperationalStateExecutionFill,
}) {
  const { order, ownership } = resolveRecoverySellerBuyOrderOwnership({
    registry: state.orderRegistry,
    fill,
  })
  const result = state.portfolio.applyFill({
    fill,
    positionId: ownership.positionId,
    strategyId: ownership.strategyId,
  })
  const nextBuyExecution = result.applied
    ? createNextRecoverySellerBuyExecution({
        state,
        fill,
        ownership,
      })
    : undefined
  if (result.applied && onOperationalStateExecutionFill) {
    const durableResult = await onOperationalStateExecutionFill({
      fill,
      order,
      ownership,
    })
    if (durableResult?.ok !== true || durableResult.data?.durable !== true) {
      throw durableResult?.errors?.[0] ??
        new Error("Execution-fill fact append did not confirm durable commitment")
    }
  }
  state.portfolio = result.portfolio
  if (nextBuyExecution) {
    state.recoverySellerBuyExecutionByCycle.set(ownership.cycleId, nextBuyExecution)
    state.recoverySellerCycleStates.set(nextBuyExecution.marketId, createRecoverySellerTransitionCycleState({
      marketId: nextBuyExecution.marketId,
      cycleId: ownership.cycleId,
      positionId: ownership.positionId,
    }))
  }
  return Object.freeze({
    ...result,
    order,
    ownership,
  })
}
function resolveRecoverySellerOrderOwnership({ registry, order }) {
  const ownership = registry.getOwnership({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
  })
  if (!ownership || ownership.strategyId !== StrategyId.RECOVERY_SELLER ||
      ownership.purpose !== "RECOVERY_SELL") {
    throw new Error("Recovery Seller terminal mixed SELL requires registered RS order ownership")
  }
  return ownership
}

function resolveTerminalMixedSellOrder({ state, terminalOrder } = {}) {
  if (!(terminalOrder instanceof CanonicalOrder) ||
      !TERMINAL_ORDER_STATUSES.has(terminalOrder.status)) {
    throw new TypeError("Recovery Seller mixed SELL commit requires an authoritative terminal CanonicalOrder")
  }
  const registryUpdate = state.orderRegistry.applyUpdate({
    order: terminalOrder,
  })
  if (registryUpdate.unknown || registryUpdate.stale) {
    throw new Error("Recovery Seller terminal order is unknown or stale; its shared reservation remains active")
  }
  const terminalRegisteredOrder = registryUpdate.registry.getOrder({
    clientOrderId: terminalOrder.clientOrderId,
  })
  if (!terminalRegisteredOrder ||
      terminalRegisteredOrder.status !== terminalOrder.status ||
      terminalRegisteredOrder.executedQuantity.amount !== terminalOrder.executedQuantity.amount) {
    throw new Error("Recovery Seller terminal order did not become the canonical registered order state")
  }
  return {
    registryUpdate,
    terminalRegisteredOrder,
  }
}

function isZeroFillRejectedTerminalMixedSell({ terminalOrder, canonicalFills, canonicalFillAllocations }) {
  return terminalOrder.status === "REJECTED" &&
    terminalOrder.executedQuantity.amount === "0" &&
    canonicalFills.length === 0 &&
    canonicalFillAllocations.length === 0
}

function calculateTerminalMixedSellAccounting({
  state,
  registryUpdate,
  terminalRegisteredOrder,
  reconciliation,
  canonicalFills,
  canonicalFillAllocations,
  minProfit,
} = {}) {
  const ownership = resolveRecoverySellerOrderOwnership({
    registry: registryUpdate.registry,
    order: terminalRegisteredOrder,
  })
  const legacyRecord = getLegacyPositionRecord({
    state,
    marketId: terminalRegisteredOrder.market.id,
  })
  const recoveryPosition = state.portfolio.getPosition({
    marketId: terminalRegisteredOrder.market.id,
    positionId: ownership.positionId,
  })
  if (!recoveryPosition) {
    throw new TypeError("Recovery Seller terminal mixed SELL requires its owned Portfolio Position")
  }
  const accounting = applyReconciledMixedSellOrder({
    portfolio: state.portfolio,
    legacyPosition: legacyRecord.position,
    legacyAccounting: legacyRecord.accounting,
    reconciliation,
    terminalOrder: terminalRegisteredOrder,
    orderRegistry: registryUpdate.registry,
    canonicalFills,
    canonicalFillAllocations,
  })
  const profitability = accounting.applied
    ? calculateOrderProfitability({
        portfolio: state.portfolio,
        positionId: ownership.positionId,
        legacyPosition: legacyRecord.position,
        market: terminalRegisteredOrder.market,
        canonicalFillAllocations,
        minProfit,
      })
    : undefined
  const nextLegacyRecord = Object.freeze({
    ...legacyRecord,
    position: accounting.legacyPosition,
    accounting: accounting.legacyAccounting,
  })
  const nextLegacyPositions = new Map(state.legacyPositions)
  nextLegacyPositions.set(terminalRegisteredOrder.market.id, nextLegacyRecord)
  return {
    accounting,
    profitability,
    nextLegacyPositions,
  }
}

async function persistTerminalMixedSellAccountingBoundary({
  callback,
  terminalOrder,
  ownership,
  canonicalFills,
  eligible,
  accountingApplied = true,
}) {
  if (typeof callback !== "function") {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.DURABLE_FACT_REQUIRED,
      message: "Recovery Seller terminal mixed-SELL accounting requires a durable reconciliation callback",
      context: {
        marketId: terminalOrder.market.id,
        cycleId: ownership.cycleId,
        sellOrderClientId: terminalOrder.clientOrderId,
      },
    })
  }
  let result
  try {
    result = await callback({
      terminalOrder,
      ownership,
      canonicalFills,
      accountingApplied,
      eligible,
    })
  } catch (cause) {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.DURABLE_FACT_COMMIT_FAILED,
      message: "Recovery Seller terminal mixed-SELL reconciliation fact append failed",
      context: {
        marketId: terminalOrder.market.id,
        cycleId: ownership.cycleId,
        sellOrderClientId: terminalOrder.clientOrderId,
      },
      cause,
    })
  }
  if (result?.ok !== true || result.data?.durable !== true) {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.DURABLE_FACT_COMMIT_FAILED,
      message: "Recovery Seller terminal mixed-SELL reconciliation fact was not durably committed",
      context: {
        marketId: terminalOrder.market.id,
        cycleId: ownership.cycleId,
        sellOrderClientId: terminalOrder.clientOrderId,
      },
      cause: result?.errors?.[0],
    })
  }
}

function publishTerminalMixedSellAccounting({
  state,
  registryUpdate,
  terminalRegisteredOrder,
  ownership,
  canonicalFills,
  result,
  reconciledCycleState,
}) {
  state.portfolio = result.accounting.portfolio
  state.legacyPositions = result.nextLegacyPositions
  state.orderRegistry = registryUpdate.registry
  const reservation = state.recoverySellerSellReservations.get(ownership.cycleId)
  if (reservation?.clientOrderId === terminalRegisteredOrder.clientOrderId) {
    state.recoverySellerSellReservations.delete(ownership.cycleId)
  }
  const cycleOutcome = Object.freeze({
    ...reconciledCycleState,
    marketId: terminalRegisteredOrder.market.id,
    sellOrderClientId: terminalRegisteredOrder.clientOrderId,
    sellOrderBrokerOrderId: terminalRegisteredOrder.brokerOrderId,
    appliedFillIds: Object.freeze(canonicalFills.map((fill) => fill.id).sort()),
    eligible: reconciledCycleState.profitabilityEligible,
  })
  state.recoverySellerCycleOutcomes.set(ownership.cycleId, cycleOutcome)
  state.recoverySellerCycleStates.set(terminalRegisteredOrder.market.id, cycleOutcome)
  return Object.freeze({
    ...result.accounting,
    applied: true,
    accountingApplied: result.accounting.applied === true,
    orderRegistry: state.orderRegistry,
    profitability: result.profitability,
  })
}

function resolveDuplicateTerminalMixedSellAccounting({
  state,
  ownership,
  terminalRegisteredOrder,
  canonicalFills,
  canonicalFillAllocations,
  result,
}) {
  const zeroFillRejected = isZeroFillRejectedTerminalMixedSell({
    terminalOrder: terminalRegisteredOrder,
    canonicalFills,
    canonicalFillAllocations,
  })
  if (result.accounting.duplicate !== true && !zeroFillRejected) {
    return undefined
  }
  const priorOutcome = state.recoverySellerCycleOutcomes.get(ownership.cycleId)
  if (zeroFillRejected && !priorOutcome) {
    return undefined
  }
  const replayFillIds = canonicalFills.map((fill) => fill.id).sort()
  const priorFillIds = priorOutcome?.appliedFillIds ?? []
  const sameCommittedBoundary =
    priorOutcome?.sellOrderClientId === terminalRegisteredOrder.clientOrderId &&
    priorOutcome?.sellOrderBrokerOrderId === terminalRegisteredOrder.brokerOrderId &&
    JSON.stringify(priorFillIds) === JSON.stringify(replayFillIds)
  if (!sameCommittedBoundary) {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.DUPLICATE_TERMINAL_BOUNDARY_CONFLICT,
      message: "Recovery Seller duplicate terminal accounting does not match the committed cycle/order/fill boundary",
      context: {
        marketId: terminalRegisteredOrder.market.id,
        cycleId: ownership.cycleId,
        sellOrderClientId: terminalRegisteredOrder.clientOrderId,
      },
    })
  }
  return Object.freeze({
    ...result.accounting,
    applied: false,
    duplicate: true,
    accountingApplied: false,
    orderRegistry: state.orderRegistry,
    profitability: result.profitability,
  })
}

function createReconciledTerminalCycleState({ state, terminalRegisteredOrder, ownership, eligible }) {
  const submittedCycleState = state.recoverySellerCycleStates.get(terminalRegisteredOrder.market.id)
  if (!submittedCycleState) {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.ACCOUNTING_NOT_COMMITTED,
      message: "Recovery Seller terminal mixed-SELL accounting requires its canonical submitted cycle state",
      context: {
        marketId: terminalRegisteredOrder.market.id,
        cycleId: ownership.cycleId,
        sellOrderClientId: terminalRegisteredOrder.clientOrderId,
      },
    })
  }
  return reconcileRecoverySellerCycleSell({
    state: submittedCycleState,
    orderIdentity: {
      clientOrderId: terminalRegisteredOrder.clientOrderId,
      brokerOrderId: terminalRegisteredOrder.brokerOrderId ?? undefined,
    },
    terminalOrderStatus: terminalRegisteredOrder.status,
    reconciliationComplete: true,
    profitabilityEligible: eligible,
  })
}

function prepareTerminalMixedSellTransition({
  state,
  reconciliation,
  terminalOrder,
  canonicalFills,
  canonicalFillAllocations,
  minProfit,
}) {
  const { registryUpdate, terminalRegisteredOrder } = resolveTerminalMixedSellOrder({
    state,
    terminalOrder,
  })
  const result = calculateTerminalMixedSellAccounting({
    state,
    registryUpdate,
    terminalRegisteredOrder,
    reconciliation,
    canonicalFills,
    canonicalFillAllocations,
    minProfit,
  })
  const ownership = resolveRecoverySellerOrderOwnership({
    registry: registryUpdate.registry,
    order: terminalRegisteredOrder,
  })
  const duplicateResult = resolveDuplicateTerminalMixedSellAccounting({
    state,
    ownership,
    terminalRegisteredOrder,
    canonicalFills,
    canonicalFillAllocations,
    result,
  })
  if (duplicateResult) {
    return {
      registryUpdate,
      terminalRegisteredOrder,
      result,
      ownership,
      duplicateResult,
    }
  }
  const reconciledCycleState = createReconciledTerminalCycleState({
    state,
    terminalRegisteredOrder,
    ownership,
    eligible: result.profitability?.eligible === true,
  })
  return {
    registryUpdate,
    terminalRegisteredOrder,
    result,
    ownership,
    duplicateResult,
    reconciledCycleState,
  }
}
async function reconcileTerminalMixedSellTransition({
  state,
  reconciliation,
  terminalOrder,
  canonicalFills,
  canonicalFillAllocations,
  minProfit,
  onOperationalStateRecoverySellerMixedSellReconciled,
}) {
  const prepared = prepareTerminalMixedSellTransition({
    state,
    reconciliation,
    terminalOrder,
    canonicalFills,
    canonicalFillAllocations,
    minProfit,
  })
  if (prepared.duplicateResult) {
    return prepared.duplicateResult
  }
  const zeroFillRejected = isZeroFillRejectedTerminalMixedSell({
    terminalOrder: prepared.terminalRegisteredOrder,
    canonicalFills,
    canonicalFillAllocations,
  })
  if (prepared.result.accounting.applied !== true && !zeroFillRejected) {
    throw new RecoverySellerAccountingError({
      code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.ACCOUNTING_NOT_COMMITTED,
      message: "Recovery Seller terminal mixed-SELL accounting did not commit; the sole-SELL reservation remains active",
      context: {
        marketId: prepared.terminalRegisteredOrder.market.id,
        cycleId: prepared.ownership.cycleId,
        sellOrderClientId: prepared.terminalRegisteredOrder.clientOrderId,
      },
    })
  }
  const eligible = prepared.result.profitability?.eligible === true
  await persistTerminalMixedSellAccountingBoundary({
    callback: onOperationalStateRecoverySellerMixedSellReconciled,
    terminalOrder: prepared.terminalRegisteredOrder,
    ownership: prepared.ownership,
    canonicalFills,
    eligible,
    accountingApplied: prepared.result.accounting.applied === true,
  })
  return publishTerminalMixedSellAccounting({
    state,
    registryUpdate: prepared.registryUpdate,
    terminalRegisteredOrder: prepared.terminalRegisteredOrder,
    ownership: prepared.ownership,
    canonicalFills,
    result: prepared.result,
    reconciledCycleState: prepared.reconciledCycleState,
  })
}

/**
 * Coordinate Recovery Seller terminal mixed-SELL accounting at the application
 * boundary. Domain projections are immutable; this workflow serializes the
 * terminal registry transition and commits the shared Portfolio, legacy
 * accounting and reservation release together.
 *
 * The exposed snapshot providers are intended to be supplied to
 * createAccountSnapshotManager. Legacy inventory remains outside Portfolio;
 * only independently verified Spot quantity is added to account baselines.
 *
 * @param {object} options
 * @param {Portfolio} [options.initialPortfolio] Shared Portfolio snapshot.
 * @param {OrderRegistry} [options.initialOrderRegistry] Shared order registry.
 * @param {Array<object>} [options.initialLegacyPositions] Market-scoped logical legacy state.
 * @param {Function} [options.onOperationalStateExecutionFill] Durable canonical Fill append callback.
 * @returns {object} Serialized RS accounting and account-snapshot provider operations.
 */
function createSerializedWorkflowOperation({ state, transition } = {}) {
  return (input = {}) => {
    const task = state.updateQueue.then(async () => {
      try {
        return toResult({
          data: await transition({
            state,
            ...input,
          }),
        })
      } catch (error) {
        return toResult({ error })
      }
    })
    state.updateQueue = task.then(() => undefined, () => undefined)
    return task
  }
}

function validateSharedRecoverySellerWorkflowState({
  sharedState,
  initialPortfolio,
  initialOrderRegistry,
  initialLegacyPositions,
} = {}) {
  if (sharedState === undefined) {
    return
  }
  ensure.object({
    value: sharedState,
    name: "sharedState",
    errMsg: "sharedState must be an account workflow state object",
  })
  if (!(sharedState.portfolio instanceof Portfolio)) {
    throw new TypeError("sharedState.portfolio must be a Portfolio")
  }
  if (!(sharedState.orderRegistry instanceof OrderRegistry)) {
    throw new TypeError("sharedState.orderRegistry must be an OrderRegistry")
  }
  if (!(sharedState.legacyPositions instanceof Map)) {
    throw new TypeError("sharedState.legacyPositions must be a Map")
  }
  if (typeof sharedState.updateQueue?.then !== "function") {
    throw new TypeError("sharedState.updateQueue must be a Promise-like queue")
  }
  if (initialPortfolio !== undefined && initialPortfolio !== sharedState.portfolio) {
    throw new TypeError("initialPortfolio must match sharedState.portfolio")
  }
  if (initialOrderRegistry !== undefined && initialOrderRegistry !== sharedState.orderRegistry) {
    throw new TypeError("initialOrderRegistry must match sharedState.orderRegistry")
  }
  if (initialLegacyPositions.length > 0) {
    throw new TypeError("initialLegacyPositions cannot be combined with sharedState")
  }
}

function hasConflictingActiveRecoverySellerSell({ state, order, cycleId }) {
  return state.orderRegistry.getActiveOrders().some((activeOrder) => {
    if (activeOrder.clientOrderId === order.clientOrderId ||
        activeOrder.side !== "SELL") {
      return false
    }
    const activeOwnership = state.orderRegistry.getOwnership({
      clientOrderId: activeOrder.clientOrderId,
      brokerOrderId: activeOrder.brokerOrderId,
    })
    return activeOwnership?.strategyId === StrategyId.RECOVERY_SELLER &&
      activeOwnership.cycleId === cycleId
  })
}

function reserveRecoverySellerSellCycleTransition({
  state,
  order,
  ownership,
  durableIntent,
}) {
  if (durableIntent !== true) {
    throw new Error("Recovery Seller SELL cycle reservation requires a durable submission intent")
  }
  if (!(order instanceof CanonicalOrder) || order.side !== "SELL") {
    throw new TypeError("Recovery Seller cycle reservation requires a canonical SELL order")
  }
  const normalizedOwnership = validateStrategySubmissionOwnership({
    order,
    purpose: "RECOVERY_SELL",
    ownership,
  })
  if (!normalizedOwnership) {
    throw new TypeError("Recovery Seller SELL cycle reservation requires explicit RS ownership")
  }
  const existing = state.recoverySellerSellReservations.get(normalizedOwnership.cycleId)
  if (existing) {
    if (existing.clientOrderId === order.clientOrderId &&
        existing.brokerOrderId === order.brokerOrderId) {
      return Object.freeze({
        durable: true,
        duplicate: true,
      })
    }
    throw new Error(`Recovery Seller cycle ${normalizedOwnership.cycleId} is already reserved by SELL order ${existing.clientOrderId}`)
  }
  if (hasConflictingActiveRecoverySellerSell({
    state,
    order,
    cycleId: normalizedOwnership.cycleId,
  })) {
    throw new Error(`Recovery Seller cycle ${normalizedOwnership.cycleId} already has an active SELL order`)
  }
  state.recoverySellerSellReservations.set(normalizedOwnership.cycleId, Object.freeze({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    positionId: normalizedOwnership.positionId,
    cycleId: normalizedOwnership.cycleId,
    marketId: order.market.id,
  }))
  state.recoverySellerCycleStates.set(order.market.id, createRecoverySellerTransitionCycleState({
    marketId: order.market.id,
    cycleId: normalizedOwnership.cycleId,
    positionId: normalizedOwnership.positionId,
    status: "SELL_SUBMITTED",
    orderIdentity: {
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId ?? undefined,
    },
  }))
  return Object.freeze({
    durable: true,
  })
}

function ensureRecoverySellerWorkflowMaps(state) {
  const properties = [
    ["recoverySellerBuyExecutionByCycle", "sharedState.recoverySellerBuyExecutionByCycle must be a Map"],
    ["recoverySellerSellReservations", "sharedState.recoverySellerSellReservations must be a Map"],
    ["recoverySellerCycleStates", "sharedState.recoverySellerCycleStates must be a Map"],
    ["recoverySellerCycleOutcomes", "sharedState.recoverySellerCycleOutcomes must be a Map"],
  ]
  for (const [property, errorMessage] of properties) {
    if (state[property] === undefined && !Object.isFrozen(state)) {
      state[property] = new Map()
    }
    if (!(state[property] instanceof Map)) {
      throw new TypeError(errorMessage)
    }
  }
}

function validateRecoverySellerWorkflowState(state) {
  if (!(state.portfolio instanceof Portfolio)) {
    throw new TypeError("initialPortfolio must be a Portfolio")
  }
  if (!(state.orderRegistry instanceof OrderRegistry)) {
    throw new TypeError("initialOrderRegistry must be an OrderRegistry")
  }
  ensureRecoverySellerWorkflowMaps(state)
}

function createRecoverySellerWorkflowState({
  sharedState,
  initialPortfolio,
  initialOrderRegistry,
  initialLegacyPositions,
} = {}) {
  validateSharedRecoverySellerWorkflowState({
    sharedState,
    initialPortfolio,
    initialOrderRegistry,
    initialLegacyPositions,
  })
  const state = sharedState ?? {
    portfolio: initialPortfolio ?? new Portfolio(),
    orderRegistry: initialOrderRegistry ?? OrderRegistry.empty(),
    legacyPositions: createLegacyPositionMap(initialLegacyPositions),
    recoverySellerBuyExecutionByCycle: new Map(),
    recoverySellerSellReservations: new Map(),
    recoverySellerCycleStates: new Map(),
    recoverySellerCycleOutcomes: new Map(),
    updateQueue: Promise.resolve(),
  }
  validateRecoverySellerWorkflowState(state)
  return state
}


function createRecoverySellerAccountingOperations({
  state,
  onOperationalStateExecutionFill,
  onOperationalStateRecoverySellerMixedSellReconciled,
} = {}) {
  return {
    applyBuyFill: createSerializedWorkflowOperation({
      state,
      transition: ({ state: currentState, fill }) => applyRecoverySellerBuyFillTransition({
        state: currentState,
        fill,
        onOperationalStateExecutionFill,
      }),
    }),
    reconcileTerminalMixedSell: createSerializedWorkflowOperation({
      state,
      transition: (input) => reconcileTerminalMixedSellTransition({
        ...input,
        onOperationalStateRecoverySellerMixedSellReconciled,
      }),
    }),
    reserveSellCycle: createSerializedWorkflowOperation({
      state,
      transition: reserveRecoverySellerSellCycleTransition,
    }),
    initializeLegacyPositions: createSerializedWorkflowOperation({
      state,
      transition: initializeLegacyPositionsTransition,
    }),
  }
}

function getLatestBuyExecutionForMarket({ state, marketId }) {
  return [...state.recoverySellerBuyExecutionByCycle.values()]
    .filter((execution) => execution.marketId === marketId)
    .at(-1)
}

function getOrCreateRecoverySellerCycleState({ state, marketId, createCycleId }) {
  const current = state.recoverySellerCycleStates.get(marketId)
  if (current && current.status !== "CLOSED") {
    if (current.status === "ACCUMULATING") {
      const cycleState = createRecoverySellerTransitionCycleState({
        marketId,
        cycleId: current.cycleId,
        positionId: current.positionId,
      })
      state.recoverySellerCycleStates.set(marketId, cycleState)
      return cycleState
    }
    return Object.freeze({ ...current })
  }
  const latestExecution = getLatestBuyExecutionForMarket({
    state,
    marketId,
  })
  if (latestExecution) {
    const outcome = state.recoverySellerCycleOutcomes.get(latestExecution.cycleId)
    if (outcome?.status !== "CLOSED") {
      const cycleState = outcome?.status === undefined || outcome.status === "ACCUMULATING"
        ? createRecoverySellerTransitionCycleState({
            marketId,
            cycleId: latestExecution.cycleId,
            positionId: latestExecution.positionId,
          })
        : Object.freeze({
            marketId,
            cycleId: latestExecution.cycleId,
            positionId: latestExecution.positionId,
            status: outcome.status,
          })
      state.recoverySellerCycleStates.set(marketId, cycleState)
      return cycleState
    }
  }
  const cycleId = createCycleId()
  if (typeof cycleId !== "string" || !cycleId.trim()) {
    throw new TypeError("createCycleId must return a non-empty string")
  }
  const cycleState = createRecoverySellerTransitionCycleState({
    marketId,
    cycleId,
    positionId: createPositionId({
      marketId,
      strategyId: StrategyId.RECOVERY_SELLER,
    }),
  })
  state.recoverySellerCycleStates.set(marketId, cycleState)
  return cycleState
}

function getRecoverySellerMarketActiveOrders({ state, marketId }) {
  return state.orderRegistry.getActiveOrders()
    .filter((order) => order.market.id === marketId)
    .map((order) => Object.freeze({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      side: order.side,
      status: order.status,
      originalQuantity: order.originalQuantity,
      executedQuantity: order.executedQuantity,
      limitPrice: order.limitPrice,
      ownership: state.orderRegistry.getOwnership({
        clientOrderId: order.clientOrderId,
      }),
    }))
}

function resolveRecoverySellerTransitionCycleState({
  state,
  marketId,
  activeOrders,
  createCycleId,
}) {
  const activeRecoveryOrder = activeOrders.find(
    (order) => order.ownership?.strategyId === StrategyId.RECOVERY_SELLER,
  )
  if (activeRecoveryOrder) {
    const cycleState = createRecoverySellerTransitionCycleState({
      marketId,
      cycleId: activeRecoveryOrder.ownership.cycleId,
      positionId: activeRecoveryOrder.ownership.positionId,
      status: activeRecoveryOrder.side === "SELL" ? "SELL_SUBMITTED" : "ACCUMULATING",
      orderIdentity: {
        clientOrderId: activeRecoveryOrder.clientOrderId,
        brokerOrderId: activeRecoveryOrder.brokerOrderId ?? undefined,
      },
    })
    state.recoverySellerCycleStates.set(marketId, cycleState)
    return cycleState
  }
  const reservation = [...state.recoverySellerSellReservations.values()]
    .find((item) => item.marketId === marketId)
  if (reservation) {
    const cycleState = createRecoverySellerTransitionCycleState({
      marketId,
      cycleId: reservation.cycleId,
      positionId: reservation.positionId,
      status: "SELL_SUBMITTED",
      orderIdentity: {
        clientOrderId: reservation.clientOrderId,
        brokerOrderId: reservation.brokerOrderId ?? undefined,
      },
    })
    state.recoverySellerCycleStates.set(marketId, cycleState)
    return cycleState
  }
  return getOrCreateRecoverySellerCycleState({
    state,
    marketId,
    createCycleId,
  })
}

function calculateRecoverySellerPendingBuyCommitment({ activeOrders, cycleId }) {
  let total = "0"
  for (const order of activeOrders) {
    if (order.side !== "BUY" ||
        order.ownership?.strategyId !== StrategyId.RECOVERY_SELLER ||
        order.ownership.cycleId !== cycleId) {
      continue
    }
    const remainingQuantity = subtractDecimal({
      left: order.originalQuantity.amount,
      right: order.executedQuantity.amount,
    })
    const quoteCommitment = multiplyDecimal({
      left: remainingQuantity,
      right: order.limitPrice.amount,
    })
    total = addDecimal({
      left: total,
      right: quoteCommitment,
    })
  }
  return total
}

function createRecoverySellerTransitionPlanInput({
  state,
  market,
  pairConfig,
  accountSnapshot,
  recoveryPosition,
  thirdAssetFeeQuoteValue,
}) {
  const legacyRecord = getLegacyPositionRecord({
    state,
    marketId: market.id,
  })
  const additionalTrackedBase = createAdditionalTrackedBaseQuantity({
    state,
    balances: accountSnapshot.balances,
    portfolio: state.portfolio,
  })
  const verifiedUnreservedLegacyQuantity = additionalTrackedBase
    .find((allocation) => allocation.assetId === market.baseAsset.id)?.amount ?? "0"
  return Object.freeze({
    recoveryQuantity: recoveryPosition?.quantity ?? "0",
    configuredLegacyQuantity: String(pairConfig.sellQuantity),
    legacyRemainingQuantity: legacyRecord.position.remainingQuantity,
    verifiedUnreservedLegacyQuantity,
    recoveryCostBasis: recoveryPosition?.spent ?? "0",
    legacyAverageCost: legacyRecord.position.averageCost,
    thirdAssetFeeQuoteValue: thirdAssetFeeQuoteValue ?? pairConfig.thirdAssetFeeQuoteValue,
  })
}

function createRecoverySellerPositionSnapshot({ state, market, cycleState }) {
  const position = state.portfolio.getPosition({
    marketId: market.id,
    positionId: cycleState.positionId,
  })
  return position
    ? Object.freeze({
        positionId: cycleState.positionId,
        quantity: position.baseQuantity.amount,
        spent: position.spent.amount,
      })
    : undefined
}

function createSellAdmissionSnapshotFlag({ sellAdmissionBlocked } = {}) {
  if (typeof sellAdmissionBlocked !== "boolean") {
    return {}
  }
  return { sellAdmissionBlocked }
}

function createRecoverySellerTransitionSnapshot({
  state,
  createCycleId,
  marketMetadata,
  pairConfig,
  accountSnapshot,
  stopState,
  strategyStopped,
  buyAdmissionBlocked,
  sellAdmissionBlocked,
  marketPaused,
  reconciliationComplete,
  thirdAssetFeeQuoteValue,
}) {
  const market = marketMetadata?.market
  if (!market || !Array.isArray(accountSnapshot?.balances)) {
    throw new TypeError("Recovery Seller transition snapshot requires market metadata and canonical account balances")
  }
  const activeOrders = getRecoverySellerMarketActiveOrders({
    state,
    marketId: market.id,
  })
  const cycleState = resolveRecoverySellerTransitionCycleState({
    state,
    marketId: market.id,
    activeOrders,
    createCycleId,
  })
  const recoveryPosition = createRecoverySellerPositionSnapshot({
    state,
    market,
    cycleState,
  })
  const planInput = createRecoverySellerTransitionPlanInput({
    state,
    market,
    pairConfig,
    accountSnapshot,
    recoveryPosition,
    thirdAssetFeeQuoteValue,
  })
  return Object.freeze({
    cycleState,
    recoveryPosition,
    planInput,
    cumulativeNetSellProceeds: "0",
    pendingBuyCommitment: calculateRecoverySellerPendingBuyCommitment({
      activeOrders,
      cycleId: cycleState.cycleId,
    }),
    activeOrders: Object.freeze(activeOrders),
    stopState,
    strategyStopped,
    buyAdmissionBlocked,
    ...createSellAdmissionSnapshotFlag({ sellAdmissionBlocked }),
    marketPaused,
    reconciliationComplete,
    lastBuyPrice: calculateRecoverySellerBuyExecutionVwap({ execution: state.recoverySellerBuyExecutionByCycle.get(cycleState.cycleId) }),
  })
}

function createRecoverySellerCycleStateApi({ state, createCycleId }) {
  return {
    getOrCreateCycleState: ({ marketId } = {}) =>
      getOrCreateRecoverySellerCycleState({
        state,
        marketId,
        createCycleId,
      }),
    getCycleStateForMarket: ({ marketId } = {}) =>
      state.recoverySellerCycleStates.get(marketId),
    getCycleOutcome: ({ cycleId } = {}) =>
      state.recoverySellerCycleOutcomes.get(cycleId),
    getLatestBuyExecutionForMarket: ({ marketId } = {}) =>
      getLatestBuyExecutionForMarket({
        state,
        marketId,
      }),
    getReservedSellCycleForMarket: ({ marketId } = {}) =>
      [...state.recoverySellerSellReservations.values()]
        .find((reservation) => reservation.marketId === marketId),
  }
}

function createRecoverySellerAccountingWorkflowApi({ state, operations, createCycleId } = {}) {
  return Object.freeze({
    ...operations,
    ...createRecoverySellerCycleStateApi({
      state,
      createCycleId,
    }),
    getTransitionSnapshot: (input = {}) =>
      createRecoverySellerTransitionSnapshot({
        state,
        createCycleId,
        ...input,
      }),
    getExecutionCallbacks: () => createRecoverySellerExecutionCallbacks({ state }),
    getBuyExecutionQuantity: ({ cycleId } = {}) =>
      state.recoverySellerBuyExecutionByCycle.get(cycleId)?.quantity,
    getBuyExecutionVwap: ({ cycleId } = {}) =>
      calculateRecoverySellerBuyExecutionVwap({
        execution: state.recoverySellerBuyExecutionByCycle.get(cycleId),
      }),
    getBuyExecutionState: ({ cycleId } = {}) => {
      const execution = state.recoverySellerBuyExecutionByCycle.get(cycleId)
      return execution
        ? Object.freeze({
            ...execution,
            vwap: calculateRecoverySellerBuyExecutionVwap({ execution }),
          })
        : undefined
    },
    getPortfolio: () => state.portfolio,
    getOrderRegistry: () => state.orderRegistry,
    getActiveOrders: () => state.orderRegistry.getActiveOrders(),
    getReservedSellCycle: ({ cycleId } = {}) => {
      const reservation = state.recoverySellerSellReservations.get(cycleId)
      return reservation ? Object.freeze({ ...reservation }) : undefined
    },
    getLegacyPosition: ({ marketId } = {}) => getLegacyPositionRecord({
      state,
      marketId,
    }).position,
    getLegacyAccounting: ({ marketId } = {}) => getLegacyPositionRecord({
      state,
      marketId,
    }).accounting,
    getAdditionalTrackedBaseQuantity: ({ balances, portfolio = state.portfolio } = {}) =>
      createAdditionalTrackedBaseQuantity({
        state,
        balances,
        portfolio,
      }),
    getAdditionalTrackedQuoteCashFlow: () => createAdditionalTrackedQuoteCashFlow({
      legacyPositions: state.legacyPositions,
    }),
  })
}

export function createRecoverySellerAccountingWorkflow({
  initialPortfolio,
  initialOrderRegistry,
  initialLegacyPositions = [],
  onOperationalStateExecutionFill,
  onOperationalStateRecoverySellerMixedSellReconciled,
  sharedState,
  createCycleId = randomUUID,
} = {}) {
  ensure.function({
    value: createCycleId,
    name: "createCycleId",
  })
  if (onOperationalStateExecutionFill !== undefined) {
    ensure.function({
      value: onOperationalStateExecutionFill,
      name: "onOperationalStateExecutionFill",
    })
  }
  if (onOperationalStateRecoverySellerMixedSellReconciled !== undefined) {
    ensure.function({
      value: onOperationalStateRecoverySellerMixedSellReconciled,
      name: "onOperationalStateRecoverySellerMixedSellReconciled",
    })
  }
  const state = createRecoverySellerWorkflowState({
    sharedState,
    initialPortfolio,
    initialOrderRegistry,
    initialLegacyPositions,
  })
  const operations = createRecoverySellerAccountingOperations({
    state,
    onOperationalStateExecutionFill,
    onOperationalStateRecoverySellerMixedSellReconciled,
  })
  return createRecoverySellerAccountingWorkflowApi({
    state,
    operations,
    createCycleId,
  })
}