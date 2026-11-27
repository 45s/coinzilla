import { createHash } from "node:crypto"
import { ensure, toResult } from "@coinzilla/utils"
import { resolveRecoverySellerStopState } from "../domain/strategies/recovery-seller/stop-decision.js"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"
import {
  hasControlCharacters,
  isAuthenticatedLocalOperatorIdentity,
  LOCAL_OPERATOR_ID_PATTERN,
} from "../infrastructure/security/local-operator-identity.js"


const MAX_RECONCILIATION_AGE_MS = 5 * 60 * 1000
const FUTURE_RECONCILIATION_TOLERANCE_MS = 30 * 1000

function validateAuthenticatedOperator({ operatorIdentity, operatorId }) {
  const authenticated = isAuthenticatedLocalOperatorIdentity(operatorIdentity)
  const validOperator = authenticated &&
    operatorIdentity.operatorId === operatorId &&
    operatorIdentity.authMethod === "OS_ACCOUNT" &&
    LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "")
  if (!validOperator) {
    throw new TypeError("Recovery Seller STOP resolution requires an authenticated operating-system operator identity")
  }
}

function validateResolutionAction({ actionId, resolutionReason, causeFixed }) {
  const validActionId = typeof actionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId)
  const validReason = typeof resolutionReason === "string" &&
    resolutionReason.trim() === resolutionReason &&
    resolutionReason.length >= 8 &&
    resolutionReason.length <= 512 &&
    !hasControlCharacters(resolutionReason)
  if (causeFixed !== true || !validActionId || !validReason) {
    throw new TypeError("Recovery Seller STOP resolution requires cause-fixed acknowledgement, action ID, and printable reason")
  }
}

function validateMarketSet({ configuredMarkets, auditedMarkets }) {
  const validMarkets = (markets) => Array.isArray(markets) &&
    markets.length > 0 &&
    markets.every((symbol) => typeof symbol === "string" && /^[A-Z0-9]{2,20}$/.test(symbol))
  if (!validMarkets(configuredMarkets) || !validMarkets(auditedMarkets)) {
    throw new TypeError("Recovery Seller STOP resolution requires complete configured and audited market sets")
  }
  const configured = [...new Set(configuredMarkets)].sort()
  const audited = [...new Set(auditedMarkets)].sort()
  if (configured.length !== configuredMarkets.length ||
      audited.length !== auditedMarkets.length ||
      configured.join("|") !== audited.join("|")) {
    throw new Error("Recovery Seller STOP resolution requires authoritative reconciliation of every configured market")
  }
}

function validateReconciliationCompleteness(reconciliation) {
  const complete = reconciliation.ordersReconciled === true &&
    reconciliation.fillsReconciled === true &&
    reconciliation.balancesReconciled === true &&
    reconciliation.allConfiguredMarketsAudited === true
  const noUnresolvedFacts = reconciliation.unresolvedOrderCount === 0 &&
    reconciliation.unresolvedFillCount === 0 &&
    reconciliation.balanceDiscrepancyCount === 0
  if (!complete || !noUnresolvedFacts) {
    throw new Error("Recovery Seller STOP resolution requires authoritative account reconciliation with zero unresolved facts or discrepancies")
  }
}

function validateReconciliationFreshness({ capturedAt, now }) {
  const capturedTime = Date.parse(capturedAt)
  const age = now.getTime() - capturedTime
  if (!Number.isFinite(capturedTime) ||
      age > MAX_RECONCILIATION_AGE_MS ||
      age < -FUTURE_RECONCILIATION_TOLERANCE_MS) {
    throw new Error("Recovery Seller STOP resolution requires fresh authoritative account reconciliation")
  }
}

function validateReconciliationMetadata({
  reconciliation,
  operatorId,
  operatorIdentity,
  actionId,
  resolutionReason,
  blockerId,
  now,
}) {
  const validMetadata = reconciliation.source === "AUTHORITATIVE_ACCOUNT_RECONCILIATION" &&
    reconciliation.scope === "ACCOUNT" &&
    reconciliation.status === "READY" &&
    typeof reconciliation.reconciliationId === "string" &&
    reconciliation.reconciliationId.trim().length > 0 &&
    reconciliation.operatorId === operatorId &&
    reconciliation.operatorAuthMethod === operatorIdentity.authMethod &&
    reconciliation.actionId === actionId &&
    reconciliation.resolutionReason === resolutionReason &&
    Array.isArray(reconciliation.blockerIds) &&
    reconciliation.blockerIds.length === 1 &&
    reconciliation.blockerIds[0] === blockerId
  if (!validMetadata) {
    throw new Error("Recovery Seller STOP resolution requires authoritative account reconciliation metadata for the exact blocker and operator action")
  }
  validateMarketSet({
    configuredMarkets: reconciliation.configuredMarkets,
    auditedMarkets: reconciliation.auditedMarkets,
  })
  validateReconciliationCompleteness(reconciliation)
  validateReconciliationFreshness({
    capturedAt: reconciliation.capturedAt,
    now,
  })
}

function validateAccountingEvidence(accounting) {
  const consistent = accounting.verified === true &&
    accounting.portfolioConsistent === true &&
    accounting.legacyConsistent === true &&
    accounting.reservationsConsistent === true
  if (!consistent) {
    throw new Error("Recovery Seller STOP resolution requires verified Portfolio, legacy, and reservation accounting")
  }
}

function validateStopResolutionEvidence({
  blockerId,
  operatorIdentity,
  operatorId,
  actionId,
  resolutionReason,
  causeFixed,
  reconciliation,
  accounting,
  now,
}) {
  if (typeof blockerId !== "string" || !/^[a-f0-9]{64}$/.test(blockerId)) {
    throw new TypeError("Recovery Seller STOP resolution requires the exact durable blocker identity")
  }
  validateAuthenticatedOperator({
    operatorIdentity,
    operatorId,
  })
  validateResolutionAction({
    actionId,
    resolutionReason,
    causeFixed,
  })
  ensure.object({
    value: reconciliation,
    name: "reconciliation",
  })
  ensure.object({
    value: accounting,
    name: "accounting",
  })
  validateReconciliationMetadata({
    reconciliation,
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    blockerId,
    now,
  })
  validateAccountingEvidence(accounting)
}

function createResolutionEvidence({
  operatorIdentity,
  operatorId,
  actionId,
  resolutionReason,
  causeFixed,
  reconciliation,
  accounting,
}) {
  return {
    operatorIdentity: {
      operatorId: operatorIdentity.operatorId,
      authMethod: operatorIdentity.authMethod,
    },
    operatorId,
    actionId,
    resolutionReason,
    causeFixed,
    reconciliation: {
      source: reconciliation.source,
      scope: reconciliation.scope,
      status: reconciliation.status,
      allConfiguredMarketsAudited: reconciliation.allConfiguredMarketsAudited,
      configuredMarkets: [...reconciliation.configuredMarkets].sort(),
      auditedMarkets: [...reconciliation.auditedMarkets].sort(),
      reconciliationId: reconciliation.reconciliationId,
      capturedAt: reconciliation.capturedAt,
      operatorId: reconciliation.operatorId,
      operatorAuthMethod: reconciliation.operatorAuthMethod,
      actionId: reconciliation.actionId,
      resolutionReason: reconciliation.resolutionReason,
      blockerIds: [...reconciliation.blockerIds].sort(),
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
 * Validate and prepare the canonical Recovery Seller STOP resolution evidence.
 *
 * @param {object} input Authenticated operator action and authoritative evidence.
 * @returns {object} The next STOP state and canonical evidence digest.
 */
function prepareRecoverySellerStopResolution(input) {
  validateStopResolutionEvidence({
    blockerId: input.blockerId,
    operatorIdentity: input.operatorIdentity,
    operatorId: input.operatorId,
    actionId: input.actionId,
    resolutionReason: input.resolutionReason,
    causeFixed: input.causeFixed,
    reconciliation: input.reconciliation,
    accounting: input.accounting,
    now: input.now(),
  })
  const nextStopState = resolveRecoverySellerStopState({
    state: input.stopState,
    operatorId: input.operatorId,
    actionId: input.actionId,
    causeFixed: input.causeFixed,
    reconciliation: input.reconciliation,
    accounting: input.accounting,
  })
  const evidence = createResolutionEvidence({
    operatorIdentity: input.operatorIdentity,
    operatorId: input.operatorId,
    actionId: input.actionId,
    resolutionReason: input.resolutionReason,
    causeFixed: input.causeFixed,
    reconciliation: input.reconciliation,
    accounting: input.accounting,
  })
  const evidenceDigest = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex")
  return {
    nextStopState,
    evidenceDigest,
  }
}

async function persistRecoverySellerStopResolution(input) {
  return recordSafetyBlockerResolved({
    operationalStateStore: input.operationalStateStore,
    blockerId: input.blockerId,
    resolvedBy: `operator:${input.operatorId}:${input.actionId}`,
    resolution: "OPERATOR_ACTION",
    evidenceDigest: input.evidenceDigest,
    operatorIdentity: input.operatorIdentity,
    operatorId: input.operatorId,
    actionId: input.actionId,
    resolutionReason: input.resolutionReason,
    actionBlockerIds: [input.blockerId],
  })
}

/**
 * Persist an authenticated Recovery Seller STOP resolution.
 *
 * @param {object} input Authenticated operator action and authoritative evidence.
 * @returns {Promise<object>} Durable resolution result.
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
  now = () => new Date(),
} = {}) {
  try {
    const input = {
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
      now,
    }
    const prepared = prepareRecoverySellerStopResolution(input)
    const persisted = await persistRecoverySellerStopResolution({
      ...input,
      evidenceDigest: prepared.evidenceDigest,
    })
    if (persisted?.ok !== true ||
        persisted.data?.record?.factType !== "SAFETY_BLOCKER_RESOLVED") {
      return persisted?.ok === false
        ? persisted
        : toResult({ error: new Error("Recovery Seller STOP resolution was not durably acknowledged") })
    }
    return toResult({
      data: {
        stopState: prepared.nextStopState,
        record: persisted.data.record,
        duplicate: persisted.data.duplicate === true,
        evidenceDigest: prepared.evidenceDigest,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
