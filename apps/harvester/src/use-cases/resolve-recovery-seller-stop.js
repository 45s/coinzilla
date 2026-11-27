import { createHash } from "node:crypto"
import { ensure, toResult } from "@coinzilla/utils"
import { resolveRecoverySellerStopState } from "../domain/strategies/recovery-seller/stop-decision.js"
import {
  hasControlCharacters,
  isAuthenticatedLocalOperatorIdentity,
  LOCAL_OPERATOR_ID_PATTERN,
} from "../infrastructure/security/local-operator-identity.js"
import {
  recordSafetyBlockerRaised,
  recordSafetyBlockerResolved,
} from "./record-safety-control-facts.js"

const RECOVERY_SELLER_STOP_RESTART_PENDING_REASON = "RECOVERY_SELLER_STOP_RESTART_PENDING"

function validateAuthenticatedOperatorAction({
  operatorIdentity,
  operatorId,
  actionId,
  resolutionReason,
}) {
  const authenticated = isAuthenticatedLocalOperatorIdentity(operatorIdentity)
  const validOperator = authenticated &&
    operatorIdentity.operatorId === operatorId &&
    operatorIdentity.authMethod === "OS_ACCOUNT" &&
    LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "")
  const validAction = typeof actionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId)
  const validReason = typeof resolutionReason === "string" &&
    resolutionReason.trim() === resolutionReason &&
    resolutionReason.length >= 8 &&
    resolutionReason.length <= 512 &&
    !hasControlCharacters(resolutionReason)
  if (!validOperator || !validAction || !validReason) {
    throw new TypeError("Recovery Seller STOP resolution requires an authenticated operating-system operator identity, unique action ID, and printable resolution reason")
  }
}

function createResolutionEvidence({
  operatorId,
  operatorIdentity,
  actionId,
  resolutionReason,
  causeFixed,
  reconciliation,
  accounting,
  actionBlockerIds,
}) {
  ensure.object({
    value: reconciliation,
    name: "reconciliation",
  })
  ensure.object({
    value: accounting,
    name: "accounting",
  })
  return {
    operatorId,
    operatorAuthMethod: operatorIdentity.authMethod,
    actionId,
    resolutionReason,
    actionBlockerIds: [...actionBlockerIds],
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

function createPendingRestartEvidenceDigest({
  blockerId,
  evidenceDigest,
  operatorId,
  actionId,
  resolutionReason,
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      blockerId,
      evidenceDigest,
      operatorId,
      actionId,
      resolutionReason,
      reason: RECOVERY_SELLER_STOP_RESTART_PENDING_REASON,
    }))
    .digest("hex")
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
  operatorIdentity,
  operatorId,
  actionId,
  resolutionReason,
  causeFixed,
  reconciliation,
  accounting,
  actionBlockerIds = [blockerId],
} = {}) {
  try {
    validateAuthenticatedOperatorAction({
      operatorIdentity,
      operatorId,
      actionId,
      resolutionReason,
    })
    if (
      !Array.isArray(actionBlockerIds) ||
      actionBlockerIds.length !== 1 ||
      actionBlockerIds[0] !== blockerId
    ) {
      throw new TypeError("Recovery Seller STOP resolution must target exactly its original blocker")
    }
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
      operatorIdentity,
      actionId,
      resolutionReason,
      causeFixed,
      reconciliation,
      accounting,
      actionBlockerIds,
    })
    const evidenceDigest = createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex")
    const pendingRestartEvidenceDigest = createPendingRestartEvidenceDigest({
      blockerId,
      evidenceDigest,
      operatorId,
      actionId,
      resolutionReason,
    })
    const pendingRaised = await recordSafetyBlockerRaised({
      operationalStateStore,
      producer: "RECOVERY_SELLER_STOP_WORKFLOW",
      scope: "ACCOUNT",
      symbol: null,
      reason: RECOVERY_SELLER_STOP_RESTART_PENDING_REASON,
      evidenceDigest: pendingRestartEvidenceDigest,
    })
    if (
      pendingRaised?.ok !== true ||
      pendingRaised.data?.record?.factType !== "SAFETY_BLOCKER_RAISED"
    ) {
      return pendingRaised?.ok === false
        ? pendingRaised
        : toResult({ error: new Error("Recovery Seller controlled-restart blocker was not durably acknowledged") })
    }
    const pendingRestartBlockerId = pendingRaised.data.record.data.blockerId
    const persisted = await recordSafetyBlockerResolved({
      operationalStateStore,
      blockerId,
      resolvedBy: `operator:${operatorId}:${actionId}`,
      resolution: "OPERATOR_ACTION",
      evidenceDigest,
      operatorIdentity,
      operatorId,
      actionId,
      resolutionReason,
      actionBlockerIds,
    })
    if (persisted?.ok !== true || persisted.data?.record?.factType !== "SAFETY_BLOCKER_RESOLVED") {
      const errors = persisted?.errors?.length
        ? persisted.errors
        : [new Error("Recovery Seller STOP resolution was not durably acknowledged")]
      return toResult({
        errors,
        data: {
          pendingRestartBlockerId,
          resolutionPendingRestart: true,
        },
      })
    }
    return toResult({
      data: {
        stopState: nextStopState,
        record: persisted.data.record,
        duplicate: persisted.data.duplicate === true,
        pendingRestartBlockerId,
        resolutionPendingRestart: true,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
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
      resolvedBy: `operator:${operatorId}:${actionId}`,
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
