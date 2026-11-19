import { CanonicalOrder, Fill } from "@coinzilla/entities"
import {
  addDecimal,
  DECIMAL_ROUNDING_MODES,
  divideDecimal,
  ensure,
  subtractDecimal,
  toResult,
} from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { applyReconciledMixedSellOrder } from "../domain/strategies/recovery-seller/mixed-sell-fill-accounting.js"
import { calculateRecoverySellerProfitability } from "../domain/strategies/recovery-seller/calculate-profitability.js"

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
  return { quantity, quoteQuantity }
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
  if (!isRecoverySellerBuyExecutionIdentityCompatible({ existing, identity })) {
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

function reconcileTerminalMixedSellTransition({
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
  // Until this point, the old registry still reserves the SELL.
  // Publish terminal order and both accounting projections as one transition.
  state.portfolio = result.accounting.portfolio
  state.legacyPositions = result.nextLegacyPositions
  state.orderRegistry = registryUpdate.registry
  return Object.freeze({
    ...result.accounting,
    orderRegistry: state.orderRegistry,
    profitability: result.profitability,
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
    updateQueue: Promise.resolve(),
  }
  if (!(state.portfolio instanceof Portfolio)) {
    throw new TypeError("initialPortfolio must be a Portfolio")
  }
  if (!(state.orderRegistry instanceof OrderRegistry)) {
    throw new TypeError("initialOrderRegistry must be an OrderRegistry")
  }
  if (!(state.recoverySellerBuyExecutionByCycle instanceof Map)) {
    throw new TypeError("sharedState.recoverySellerBuyExecutionByCycle must be a Map")
  }
  return state
}

function createRecoverySellerAccountingOperations({
  state,
  onOperationalStateExecutionFill,
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
      transition: reconcileTerminalMixedSellTransition,
    }),
    initializeLegacyPositions: createSerializedWorkflowOperation({
      state,
      transition: initializeLegacyPositionsTransition,
    }),
  }
}

function createRecoverySellerAccountingWorkflowApi({ state, operations } = {}) {
  return Object.freeze({
    ...operations,
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
  sharedState,
} = {}) {
  if (onOperationalStateExecutionFill !== undefined) {
    ensure.function({
      value: onOperationalStateExecutionFill,
      name: "onOperationalStateExecutionFill",
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
  })
  return createRecoverySellerAccountingWorkflowApi({ state, operations })
}