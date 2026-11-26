import { toResult } from "@coinzilla/utils"
import {
  createAccountResolutionEvidenceDigest,
  getActiveAccountResolutionBlockers,
  readVerifiedAccountResolutionProjection,
  validateAccountResolutionAudit,
  validateAccountResolutionInput,
} from "./resolve-user-data-account-blockers.helpers.js"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"

async function collectAccountResolutionAudit(options) {
  const initial = await readVerifiedAccountResolutionProjection(options.operationalStateStore)
  const blockers = getActiveAccountResolutionBlockers(initial.projection)
  if (blockers.length === 0) {
    throw new Error("No active ACCOUNT safety blockers exist")
  }
  const blockerIds = blockers.map(({ blockerId }) => blockerId).sort()
  const result = await options.reconcileAccount({
    scope: "ACCOUNT",
    blockerIds,
    operatorId: options.operatorId,
    actionId: options.actionId,
    configuredMarkets: [...options.configuredMarkets],
  })
  if (result?.ok !== true) {
    return result?.errors?.length
      ? toResult({ errors: result.errors })
      : toResult({ error: new Error("Authoritative account reconciliation failed") })
  }
  validateAccountResolutionAudit({
    audit: result.data,
    blockerIds,
    configuredMarkets: options.configuredMarkets,
  })
  const evidenceDigest = createAccountResolutionEvidenceDigest({
    operatorId: options.operatorId,
    actionId: options.actionId,
    audit: result.data,
  })
  if (blockers.some(({ evidenceDigest: trigger }) => trigger === evidenceDigest)) {
    throw new Error("Resolution evidence must be independent from blocker-triggering evidence")
  }
  return { blockers, blockerIds, evidenceDigest }
}

async function appendAccountBlockerResolutions(options, blockers, evidenceDigest) {
  for (const blocker of blockers) {
    const result = await recordSafetyBlockerResolved({
      operationalStateStore: options.operationalStateStore,
      blockerId: blocker.blockerId,
      resolvedBy: `operator:${options.operatorId}:${options.actionId}`,
      resolution: "OPERATOR_ACTION",
      evidenceDigest,
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return result?.ok === false
        ? result
        : toResult({ error: new Error(`Resolution was not durable for blocker ${blocker.blockerId}`) })
    }
  }
  return undefined
}

async function verifyAccountResolutionReadback(store) {
  const readback = await readVerifiedAccountResolutionProjection(store)
  const remaining = getActiveAccountResolutionBlockers(readback.projection)
  if (remaining.length > 0) {
    return toResult({ error: new Error("Durable readback still contains unresolved ACCOUNT safety blockers") })
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
    const appendResult = await appendAccountBlockerResolutions(
      options,
      audit.blockers,
      audit.evidenceDigest,
    )
    if (appendResult) {
      return appendResult
    }
    const readbackResult = await verifyAccountResolutionReadback(options.operationalStateStore)
    if (readbackResult) {
      return readbackResult
    }
    return toResult({
      data: Object.freeze({
        resolvedBlockerIds: Object.freeze(audit.blockerIds),
        evidenceDigest: audit.evidenceDigest,
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
