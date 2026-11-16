import { CanonicalOrder, Market } from "@coinzilla/entities"
import { addDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { calculateVerifiedLegacySpotAllocation } from "../domain/strategies/recovery-seller/legacy-spot-allocation.js"
import { applyReconciledMixedSellOrder } from "../domain/strategies/recovery-seller/mixed-sell-fill-accounting.js"
import { calculateRecoverySellerProfitability } from "../domain/strategies/recovery-seller/calculate-profitability.js"

const TERMINAL_ORDER_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

function assertLegacyPositionRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      !(record.market instanceof Market) ||
      !record.position || typeof record.position !== "object" ||
      !record.accounting || typeof record.accounting !== "object") {
    throw new TypeError("Recovery Seller initialLegacyPositions must contain market, position and accounting records")
  }
  if (record.position.remainingQuantity === undefined ||
      record.position.originalQuantity === undefined ||
      record.position.averageCost === undefined ||
      !Array.isArray(record.accounting.appliedFillIds)) {
    throw new TypeError("Recovery Seller legacy position/accounting record is incomplete")
  }
}

function createLegacyPositionMap(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("initialLegacyPositions must be an array")
  }
  const positions = new Map()
  for (const record of records) {
    assertLegacyPositionRecord(record)
    if (positions.has(record.market.id)) {
      throw new TypeError(`Recovery Seller legacy Position already exists for market ${record.market.id}`)
    }
    positions.set(record.market.id, Object.freeze({
      market: record.market,
      position: record.position,
      accounting: record.accounting,
    }))
  }
  return positions
}

function getLegacyPositionRecord({ state, marketId }) {
  if (typeof marketId !== "string" || !marketId.trim()) {
    throw new TypeError("Recovery Seller legacy Position lookup requires marketId")
  }
  const record = state.legacyPositions.get(marketId)
  if (!record) {
    throw new TypeError(`Recovery Seller legacy Position is not configured for market ${marketId}`)
  }
  return record
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

function createLegacySpotPositions({ legacyPositions }) {
  return [...legacyPositions.values()].map(({ market, position }) => ({
    market,
    originalQuantity: position.originalQuantity,
    remainingQuantity: position.remainingQuantity,
  }))
}

function createAdditionalTrackedQuoteCashFlow({ legacyPositions }) {
  const totals = new Map()
  for (const { market, accounting } of legacyPositions.values()) {
    const assetId = market.quoteAsset.id
    totals.set(assetId, addDecimal({
      left: totals.get(assetId) ?? "0",
      right: accounting.realizedQuoteProceeds,
    }))
  }
  return Object.freeze([...totals.keys()].sort().map((assetId) => Object.freeze({
    assetId,
    amount: totals.get(assetId),
  })))
}

function createAdditionalTrackedBaseQuantity({ state, balances, portfolio }) {
  if (portfolio !== state.portfolio) {
    throw new Error("Recovery Seller Spot allocation requires the current shared Portfolio snapshot")
  }
  return calculateVerifiedLegacySpotAllocation({
    balances,
    portfolio,
    legacyPositions: createLegacySpotPositions({
      legacyPositions: state.legacyPositions,
    }),
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

function reconcileTerminalMixedSellTransition({
  state,
  reconciliation,
  terminalOrder,
  canonicalFills,
  canonicalFillAllocations,
  minProfit,
}) {
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

  // The terminal OrderRegistry and both accounting projections are published
  // together. Until this point the old registry continues reserving the SELL.
  state.portfolio = accounting.portfolio
  state.legacyPositions = nextLegacyPositions
  state.orderRegistry = registryUpdate.registry

  return Object.freeze({
    ...accounting,
    orderRegistry: state.orderRegistry,
    profitability,
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
 * @returns {object} Serialized RS accounting and account-snapshot provider operations.
 */
export function createRecoverySellerAccountingWorkflow({
  initialPortfolio = new Portfolio(),
  initialOrderRegistry = OrderRegistry.empty(),
  initialLegacyPositions = [],
} = {}) {
  if (!(initialPortfolio instanceof Portfolio)) {
    throw new TypeError("initialPortfolio must be a Portfolio")
  }
  if (!(initialOrderRegistry instanceof OrderRegistry)) {
    throw new TypeError("initialOrderRegistry must be an OrderRegistry")
  }

  const state = {
    portfolio: initialPortfolio,
    orderRegistry: initialOrderRegistry,
    legacyPositions: createLegacyPositionMap(initialLegacyPositions),
    updateQueue: Promise.resolve(),
  }

  const reconcileTerminalMixedSell = (input = {}) => {
    const task = state.updateQueue.then(() => {
      try {
        return toResult({
          data: reconcileTerminalMixedSellTransition({
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

  return Object.freeze({
    reconcileTerminalMixedSell,
    getPortfolio: () => state.portfolio,
    getOrderRegistry: () => state.orderRegistry,
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
