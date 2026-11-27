import { toResult } from "@coinzilla/utils"
import {
  createAccountResolutionEvidenceDigest,
  getAccountResolutionTargetBlockers,
  getActiveAccountResolutionBlockers,
  readVerifiedAccountResolutionProjection,
  validateAccountResolutionAudit,
  validateAccountResolutionInput,
} from "./resolve-user-data-account-blockers.helpers.js"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"

async function collectAccountResolutionAudit(options) {
  const initial = await readVerifiedAccountResolutionProjection(options.operationalStateStore)
  const targets = getAccountResolutionTargetBlockers({
    records: initial.records,
    projection: initial.projection,
    operatorId: options.operatorId,
    actionId: options.actionId,
    resolutionReason: options.resolutionReason,
  })
  const result = await options.reconcileAccount({
    scope: "ACCOUNT",
    blockerIds: targets.blockerIds,
    actionBlockerIds: targets.blockerIds,
    operatorId: options.operatorId,
    operatorAuthMethod: options.operatorIdentity.authMethod,
    actionId: options.actionId,
    resolutionReason: options.resolutionReason,
    configuredMarkets: [...options.configuredMarkets],
  })
  if (result?.ok !== true) {
    return result?.errors?.length
      ? toResult({ errors: result.errors })
      : toResult({ error: new Error("Authoritative account reconciliation failed") })
  }
  validateAccountResolutionAudit({
    audit: result.data,
    blockerIds: targets.blockerIds,
    configuredMarkets: options.configuredMarkets,
    operatorId: options.operatorId,
    actionId: options.actionId,
    resolutionReason: options.resolutionReason,
  })
  const evidenceDigest = createAccountResolutionEvidenceDigest({
    operatorId: options.operatorId,
    actionId: options.actionId,
    resolutionReason: options.resolutionReason,
    operatorIdentity: options.operatorIdentity,
    audit: result.data,
  })
  if (targets.priorEvidenceDigest && targets.priorEvidenceDigest !== evidenceDigest) {
    throw new Error("Operator action ID was replayed with different authoritative evidence")
  }
  if (targets.blockers.some(({ evidenceDigest: trigger }) => trigger === evidenceDigest)) {
    throw new Error("Resolution evidence must be independent from blocker-triggering evidence")
  }
  return {
    blockersToResolve: targets.blockersToResolve,
    blockerIds: targets.blockerIds,
    evidenceDigest,
    idempotentReplay: targets.idempotentReplay,
  }
}

async function appendAccountBlockerResolutions({ options, blockers, blockerIds, evidenceDigest }) {
  for (const blocker of blockers) {
    const result = await recordSafetyBlockerResolved({
      operationalStateStore: options.operationalStateStore,
      blockerId: blocker.blockerId,
      resolvedBy: `operator:${options.operatorId}:${options.actionId}`,
      resolution: "OPERATOR_ACTION",
      evidenceDigest,
      operatorIdentity: options.operatorIdentity,
      operatorId: options.operatorId,
      actionId: options.actionId,
      resolutionReason: options.resolutionReason,
      actionBlockerIds: blockerIds,
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return result?.ok === false
        ? result
        : toResult({
          error: new Error(`Resolution was not durable for blocker ${blocker.blockerId}`),
        })
    }
  }
  return undefined
}

async function verifyAccountResolutionReadback({
  operationalStateStore,
  blockerIds,
  operatorId,
  actionId,
  resolutionReason,
  evidenceDigest,
}) {
  const readback = await readVerifiedAccountResolutionProjection(operationalStateStore)
  const remaining = getActiveAccountResolutionBlockers(readback.projection)
  if (remaining.length > 0) {
    return toResult({ error: new Error("Durable readback still contains unresolved ACCOUNT safety blockers") })
  }
  const actionBlockerIds = [...blockerIds].sort()
  const actionFacts = readback.records.filter((record) =>
    record.factType === "SAFETY_BLOCKER_RESOLVED" &&
    record.data?.actionId === actionId
  )
  for (const blockerId of actionBlockerIds) {
    const fact = actionFacts.find((record) => record.data?.blockerId === blockerId)
    if (!fact ||
        fact.data.operatorId !== operatorId ||
        fact.data.operatorAuthMethod !== "OS_ACCOUNT" ||
        fact.data.resolutionReason !== resolutionReason ||
        fact.data.resolvedBy !== `operator:${operatorId}:${actionId}` ||
        fact.data.evidenceDigest !== evidenceDigest ||
        !Array.isArray(fact.data.actionBlockerIds) ||
        fact.data.actionBlockerIds.join("|") !== actionBlockerIds.join("|")) {
      return toResult({
        error: new Error(`Durable readback did not confirm exact resolution metadata for blocker ${blockerId}`),
      })
    }
  }
  const conflictingResolution = readback.records.find((record) =>
    record.factType === "SAFETY_BLOCKER_RESOLVED" &&
    actionBlockerIds.includes(record.data?.blockerId) &&
    record.data?.actionId !== actionId
  )
  if (conflictingResolution) {
    return toResult({
      error: new Error("Durable readback found a target blocker resolved by a different action"),
    })
  }
  return undefined
}

/**
 * Resolve user-data ACCOUNT blockers only after an authoritative account audit.
 * This writes durable audit facts; it never clears live state, resets Recovery
 * Seller STOP, restores runtime state, or enables trading.
 */
export async function resolveUserDataAccountBlockers(options = {}) {
  try {
    validateAccountResolutionInput(options)
    const audit = await collectAccountResolutionAudit(options)
    if (audit?.ok === false) {
      return audit
    }
    const appendResult = await appendAccountBlockerResolutions({
      options,
      blockers: audit.blockersToResolve,
      blockerIds: audit.blockerIds,
      evidenceDigest: audit.evidenceDigest,
    })
    if (appendResult) {
      return appendResult
    }
    const readbackResult = await verifyAccountResolutionReadback({
      operationalStateStore: options.operationalStateStore,
      blockerIds: audit.blockerIds,
      operatorId: options.operatorId,
      actionId: options.actionId,
      resolutionReason: options.resolutionReason,
      evidenceDigest: audit.evidenceDigest,
    })
    if (readbackResult) {
      return readbackResult
    }
    return toResult({
      data: Object.freeze({
        resolvedBlockerIds: Object.freeze(audit.blockerIds),
        evidenceDigest: audit.evidenceDigest,
        idempotentReplay: audit.idempotentReplay,
        durableReadbackVerified: true,
        readiness: "BLOCKED",
        requiresControlledRestart: true,
        runtimeStateReset: false,
        recoverySellerStopReset: false,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
