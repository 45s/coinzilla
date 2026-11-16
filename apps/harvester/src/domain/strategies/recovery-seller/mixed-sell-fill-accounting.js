import { Fill } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { StrategyId } from "../strategy-ids.js"
import { createMixedSellFillAllocation } from "./mixed-sell-fill-allocation.js"
import {
  applyLegacySellAllocation,
} from "./legacy-position.js"
import {
  MixedSellFillReconciliationError,
  reconcileMixedSellFillOrder,
} from "./mixed-sell-fill-reconciliation.js"

function fail({ code, message, cause }) {
  throw new MixedSellFillReconciliationError({
    code,
    message,
    cause,
  })
}

function validateInputs({
  portfolio,
  legacyPosition,
  legacyAccounting,
  canonicalFills,
  canonicalFillAllocations,
} = {}) {
  if (!(portfolio instanceof Portfolio)) {
    throw new TypeError("applyReconciledMixedSellOrder requires a shared Portfolio")
  }
  if (!legacyPosition || typeof legacyPosition !== "object" || Array.isArray(legacyPosition)) {
    throw new TypeError("applyReconciledMixedSellOrder requires a legacy Position")
  }
  if (!legacyAccounting || typeof legacyAccounting !== "object" || Array.isArray(legacyAccounting)) {
    throw new TypeError("applyReconciledMixedSellOrder requires legacy Position accounting")
  }
  if (!Array.isArray(canonicalFills) || canonicalFills.some((fill) => !(fill instanceof Fill))) {
    throw new TypeError("applyReconciledMixedSellOrder canonicalFills must contain canonical Fill values")
  }
  if (!Array.isArray(canonicalFillAllocations)) {
    throw new TypeError("applyReconciledMixedSellOrder canonicalFillAllocations must be an array")
  }
}

function indexCanonicalFills({ canonicalFills, canonicalFillAllocations, orderRegistry }) {
  if (canonicalFills.length !== canonicalFillAllocations.length) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
      message: "Canonical Fill values and allocation metadata must contain the same complete history.",
    })
  }

  const fillsById = new Map()
  for (const fill of canonicalFills) {
    if (fillsById.has(fill.id)) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
        message: `Canonical Fill history repeats Fill identity ${fill.id}.`,
      })
    }
    fillsById.set(fill.id, fill)
  }

  for (const allocation of canonicalFillAllocations) {
    if (!allocation || typeof allocation.fillId !== "string" || !fillsById.has(allocation.fillId)) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
        message: "Every mixed SELL allocation must resolve to its original canonical Fill.",
      })
    }
    const fill = fillsById.get(allocation.fillId)
    let expected
    try {
      expected = createMixedSellFillAllocation({
        fill,
        orderRegistry,
        recoveryQuantity: allocation.recovery?.grossBaseQuantity,
        legacyQuantity: allocation.legacy?.grossBaseQuantity,
      })
    } catch (cause) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_INVALID_ALLOCATION",
        message: `Canonical Fill ${fill.id} could not be allocated from registered execution facts: ${cause?.message ?? String(cause)}.`,
        cause,
      })
    }
    if (expected.fillFingerprint !== allocation.fillFingerprint ||
        expected.allocationFingerprint !== allocation.allocationFingerprint ||
        JSON.stringify(expected.recovery) !== JSON.stringify(allocation.recovery) ||
        JSON.stringify(expected.legacy) !== JSON.stringify(allocation.legacy)) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_ALLOCATION_CONFLICT",
        message: `Canonical Fill ${fill.id} allocation facts do not match a fresh allocation from its execution facts.`,
      })
    }
  }

  return fillsById
}

function findProjectionHistory({ portfolio, legacyAccounting, allocation, reconciliation }) {
  const { fillId } = allocation
  const portfolioHistory = portfolio.appliedFillFingerprints.find((item) => item.id === fillId)
  const legacyHistory = legacyAccounting.appliedFillFingerprints.find((item) => item.id === fillId)
  const portfolioApplied = portfolioHistory !== undefined
  const legacyApplied = legacyHistory !== undefined

  if (portfolioApplied !== legacyApplied) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_PROJECTION_HISTORY_MISMATCH",
      message: `Recovery Portfolio and legacy accounting projection histories disagree for Fill ${fillId}.`,
    })
  }

  if (!portfolioApplied) {
    return false
  }

  if (portfolioHistory.positionId !== reconciliation.orderOwnership.positionId ||
      portfolioHistory.strategyId !== reconciliation.orderOwnership.strategyId ||
      portfolioHistory.allocationFingerprint !== allocation.allocationFingerprint ||
      portfolioHistory.allocationSideFingerprint !== JSON.stringify(allocation.recovery) ||
      portfolioHistory.fingerprint !== allocation.fillFingerprint ||
      legacyHistory.allocationFingerprint !== allocation.allocationFingerprint ||
      legacyHistory.fillFingerprint !== allocation.fillFingerprint) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_PROJECTION_HISTORY_MISMATCH",
      message: `Recovery Portfolio and legacy accounting contain conflicting allocation identity for Fill ${fillId}.`,
    })
  }

  return true
}

function assertProjectionHistoryParity({
  portfolio,
  legacyAccounting,
  canonicalFillAllocations,
  reconciliation,
}) {
  let appliedCount = 0
  for (const allocation of canonicalFillAllocations) {
    if (findProjectionHistory({
      portfolio,
      legacyAccounting,
      allocation,
      reconciliation,
    })) {
      appliedCount += 1
    }
  }

  if (appliedCount !== 0 && appliedCount !== canonicalFillAllocations.length) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_PROJECTION_HISTORY_MISMATCH",
      message: "A terminal mixed SELL cannot resume from partially committed projection histories.",
    })
  }

  return appliedCount === canonicalFillAllocations.length
}

function applyProjections({
  portfolio,
  legacyPosition,
  legacyAccounting,
  reconciliation,
  canonicalFillAllocations,
  fillsById,
}) {
  let nextPortfolio = portfolio
  let nextLegacyPosition = legacyPosition
  let nextLegacyAccounting = legacyAccounting

  for (const allocation of canonicalFillAllocations) {
    const fill = fillsById.get(allocation.fillId)
    const portfolioResult = nextPortfolio.applySellAllocation({
      fill,
      allocationFingerprint: allocation.allocationFingerprint,
      allocationSide: allocation.recovery,
      positionId: reconciliation.orderOwnership.positionId,
      strategyId: reconciliation.orderOwnership.strategyId,
    })
    const legacyResult = applyLegacySellAllocation({
      position: nextLegacyPosition,
      accounting: nextLegacyAccounting,
      fill,
      allocation,
    })

    if (portfolioResult.applied !== legacyResult.applied ||
        portfolioResult.duplicate !== legacyResult.duplicate) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_PROJECTION_HISTORY_MISMATCH",
        message: `Recovery and legacy projections did not apply canonical Fill ${fill.id} consistently.`,
      })
    }

    nextPortfolio = portfolioResult.portfolio
    nextLegacyPosition = legacyResult.position
    nextLegacyAccounting = legacyResult.accounting
  }

  return {
    portfolio: nextPortfolio,
    legacyPosition: nextLegacyPosition,
    legacyAccounting: nextLegacyAccounting,
  }
}

function applyAtomicProjections(input) {
  try {
    return applyProjections(input)
  } catch (cause) {
    if (cause instanceof MixedSellFillReconciliationError) {
      throw cause
    }
    return fail({
      code: "RS_MIXED_SELL_RECONCILIATION_PROJECTION_APPLY_FAILED",
      message: `The recovery and legacy projections could not be applied atomically: ${cause?.message ?? String(cause)}.`,
      cause,
    })
  }
}

/**
 * Commit one fully reconciled mixed SELL to both immutable RS accounting
 * projections. The caller publishes the returned Portfolio and legacy
 * snapshots together; no input object is mutated if either projection fails.
 *
 * This is a domain transition only. It does not update exchange custody,
 * account-snapshot baselines, order reservations, or runtime state.
 *
 * @param {object} input
 * @param {Portfolio} input.portfolio Shared Portfolio containing the recovery Position.
 * @param {object} input.legacyPosition Logical legacy Position and fixed original basis.
 * @param {object} input.legacyAccounting Independent legacy realized-P&L projection.
 * @param {object} input.reconciliation Order-scoped staged mixed SELL allocation state.
 * @param {import("@coinzilla/entities").CanonicalOrder} input.terminalOrder Authoritative terminal order.
 * @param {import("../../orders/order-registry.js").OrderRegistry} input.orderRegistry Canonical order/ownership registry.
 * @param {Fill[]} input.canonicalFills Complete canonical SELL fills for the order.
 * @param {object[]} input.canonicalFillAllocations Complete immutable allocation history for the order.
 * @returns {object} Immutable pair of updated accounting projections and terminal reconciliation.
 */
export function applyReconciledMixedSellOrder({
  portfolio,
  legacyPosition,
  legacyAccounting,
  reconciliation,
  terminalOrder,
  orderRegistry,
  canonicalFills,
  canonicalFillAllocations,
} = {}) {
  validateInputs({
    portfolio,
    legacyPosition,
    legacyAccounting,
    canonicalFills,
    canonicalFillAllocations,
  })

  if (reconciliation?.orderOwnership?.strategyId !== StrategyId.RECOVERY_SELLER) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Atomic mixed SELL accounting requires Recovery Seller order ownership.",
    })
  }

  const terminalResult = reconcileMixedSellFillOrder({
    reconciliation,
    terminalOrder,
    orderRegistry,
    canonicalFillAllocations,
  })
  const fillsById = indexCanonicalFills({
    canonicalFills,
    canonicalFillAllocations,
    orderRegistry,
  })

  if (canonicalFillAllocations.length === 0) {
    return Object.freeze({
      portfolio,
      legacyPosition,
      legacyAccounting,
      reconciliation: terminalResult.reconciliation,
      applied: false,
      duplicate: false,
    })
  }

  const duplicate = assertProjectionHistoryParity({
    portfolio,
    legacyAccounting,
    canonicalFillAllocations,
    reconciliation: terminalResult.reconciliation,
  })

  const projections = applyAtomicProjections({
    portfolio,
    legacyPosition,
    legacyAccounting,
    reconciliation: terminalResult.reconciliation,
    canonicalFillAllocations,
    fillsById,
  })

  if (duplicate &&
      (projections.portfolio !== portfolio ||
       projections.legacyPosition !== legacyPosition ||
       projections.legacyAccounting !== legacyAccounting)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_PROJECTION_HISTORY_MISMATCH",
      message: "A duplicate terminal SELL replay must remain an exact no-op in both accounting projections.",
    })
  }

  return Object.freeze({
    ...projections,
    reconciliation: terminalResult.reconciliation,
    applied: !duplicate,
    duplicate,
  })
}
