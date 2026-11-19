import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { resolveRecoverySellerStopState } from "../domain/strategies/recovery-seller/stop-decision.js"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"

function createResolutionEvidence({ operatorId, actionId, causeFixed, reconciliation, accounting }) {
  return {
    operatorId,
    actionId,
    causeFixed,
    reconciliation: {
      ordersReconciled: reconciliation.ordersReconciled,
      fillsReconciled: reconciliation.fillsReconciled,
      balancesReconciled: reconciliation.balancesReconciled,
      unresolvedOrderCount: reconciliation.unresolvedOrderCount,
      unresolvedFillCount: reconciliation.unresolvedFillCount,
      balanceDiscrepancyCount: reconciliation.balanceDiscrepancyCount,
    },
    accounting: {
      verified: accounting.verified,
      portfolioConsistent: accounting.portfolioConsistent,
      legacyConsistent: accounting.legacyConsistent,
      reservationsConsistent: accounting.reservationsConsistent,
    },
  }
}

/**
 * Durably resolve one Recovery Seller STOP after explicit operator review.
 *
 * The active STOP is not cleared unless the domain prerequisites pass and the
 * Operational State Store confirms the OPERATOR_ACTION resolution fact.
 *
 * @param {object} input
 * @param {object} input.operationalStateStore Durable Operational State Store.
 * @param {string} input.blockerId Identity returned by the durable STOP-raise fact.
 * @param {object} input.stopState Current immutable RS STOP state.
 * @param {string} input.operatorId Stable operator identity.
 * @param {string} input.actionId Unique operator action identity.
 * @param {boolean} input.causeFixed True only after the underlying cause is fixed.
 * @param {object} input.reconciliation Authoritative order/fill/balance reconciliation evidence.
 * @param {object} input.accounting Verified Portfolio/legacy/reservation accounting evidence.
 * @returns {Promise<object>} Result containing the clear state only after durable acknowledgement.
 */
export async function resolveRecoverySellerStop({
  operationalStateStore,
  blockerId,
  stopState,
  operatorId,
  actionId,
  causeFixed,
  reconciliation,
  accounting,
} = {}) {
  try {
    const nextStopState = resolveRecoverySellerStopState({
      state: stopState,
      operatorId,
      actionId,
      causeFixed,
      reconciliation,
      accounting,
    })
    const evidence = createResolutionEvidence({
      operatorId,
      actionId,
      causeFixed,
      reconciliation,
      accounting,
    })
    const evidenceDigest = createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex")
    const persisted = await recordSafetyBlockerResolved({
      operationalStateStore,
      blockerId,
      resolvedBy: "operator:" + operatorId + ":" + actionId,
      resolution: "OPERATOR_ACTION",
      evidenceDigest,
    })
    if (persisted?.ok !== true || persisted.data?.record?.factType !== "SAFETY_BLOCKER_RESOLVED") {
      return persisted?.ok === false
        ? persisted
        : toResult({ error: new Error("Recovery Seller STOP resolution was not durably acknowledged") })
    }
    return toResult({
      data: {
        stopState: nextStopState,
        record: persisted.data.record,
        duplicate: persisted.data.duplicate === true,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
