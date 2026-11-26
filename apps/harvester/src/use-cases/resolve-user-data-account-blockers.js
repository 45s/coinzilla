import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"

const isText = (value) => typeof value === "string" && value.trim() === value && value.length > 0

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function validateAccountAudit(audit, blockerIds, configuredMarkets) {
  const origins = audit?.blockerOrigins
  if (audit?.status !== "READY" ||
      audit?.scope !== "ACCOUNT" ||
      audit?.source !== "AUTHORITATIVE_ACCOUNT_RECONCILIATION" ||
      audit?.allConfiguredMarketsAudited !== true ||
      audit?.openOrdersReconciled !== true ||
      audit?.fillsReconciled !== true ||
      audit?.balancesReconciled !== true ||
      audit?.accountingConsistent !== true ||
      audit?.unresolvedOwnedOrders !== 0 ||
      audit?.unresolvedOwnedFills !== 0 ||
      audit?.unresolvedExternalOrders !== 0 ||
      audit?.balanceDiscrepancies !== 0 ||
      !Array.isArray(audit.auditedMarkets) ||
      audit.auditedMarkets.length === 0 ||
      audit.auditedMarkets.some((symbol) => !isText(symbol) || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
      new Set(audit.auditedMarkets).size !== audit.auditedMarkets.length ||
      [...audit.auditedMarkets].sort().join("\\0") !== [...configuredMarkets].sort().join("\\0") ||
      !Array.isArray(audit.blockerIds) ||
      [...audit.blockerIds].sort().join("\0") !== [...blockerIds].sort().join("\0") ||
      !Array.isArray(origins) ||
      origins.length !== blockerIds.length ||
      origins.some(({ blockerId, producer }) =>
        !blockerIds.includes(blockerId) || producer !== "USER_DATA_EVENT_HANDLER") ||
      !isText(audit.reconciliationId) ||
      !isText(audit.capturedAt) ||
      !Number.isFinite(Date.parse(audit.capturedAt))) {
    throw new Error("Account-wide reconciliation is incomplete or does not prove every required zero-discrepancy invariant")
  }
}

async function readVerifiedProjection(store) {
  const result = await store.readAll()
  if (result?.ok !== true ||
      result.data?.durableWriteSupported !== true ||
      !Array.isArray(result.data.records)) {
    throw result?.errors?.[0] ?? new Error("Account-blocker resolution requires a verified durable fact stream")
  }
  const projection = projectHarvesterOperationalState({ records: result.data.records })
  if (projection?.ok !== true) {
    throw projection?.errors?.[0] ?? new Error("Operational State projection failed")
  }
  return { records: result.data.records, projection: projection.data }
}

function getActiveAccountBlockers(projection) {
  return (projection.stickySafetyBlockers ?? [])
    .filter(({ scope }) => scope === "ACCOUNT")
    .map((blocker) => ({ ...blocker }))
}

/**
 * Resolve user-data ACCOUNT blockers after an injected authoritative account-wide
 * reconciliation. This only writes durable audit facts; it never clears live
 * user-data state, resets Recovery Seller STOP, or enables runtime readiness.
 */
export async function resolveUserDataAccountBlockers({
  operationalStateStore,
  reconcileAccount,
  operatorId,
  actionId,
  causeFixed,
  configuredMarkets,
} = {}) {
  try {
    if (typeof operationalStateStore?.readAll !== "function" ||
        typeof operationalStateStore?.append !== "function" ||
        typeof reconcileAccount !== "function" ||
        !Array.isArray(configuredMarkets) ||
        configuredMarkets.length === 0 ||
        configuredMarkets.some((symbol) => !isText(symbol) || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
        new Set(configuredMarkets).size !== configuredMarkets.length) {
      throw new TypeError("Account-blocker resolution requires a durable store and authoritative reconciliation port")
    }
    if (!isText(operatorId) || !isText(actionId) || causeFixed !== true) {
      throw new TypeError("Account-blocker resolution requires operator identity, unique action ID, and causeFixed=true")
    }
    const initial = await readVerifiedProjection(operationalStateStore)
    const blockers = getActiveAccountBlockers(initial.projection)
    if (blockers.length === 0) {
      throw new Error("No active ACCOUNT safety blockers exist")
    }
    const blockerIds = blockers.map(({ blockerId }) => blockerId).sort()
    const auditResult = await reconcileAccount({
      scope: "ACCOUNT",
      blockerIds,
      operatorId,
      actionId,
      configuredMarkets: [...configuredMarkets],
    })
    if (auditResult?.ok !== true) {
      return auditResult?.errors?.length
        ? toResult({ errors: auditResult.errors })
        : toResult({ error: new Error("Authoritative account reconciliation failed") })
    }
    const audit = auditResult.data
    validateAccountAudit(audit, blockerIds, configuredMarkets)
    const evidenceDigest = createHash("sha256")
      .update(JSON.stringify(canonicalize({
        schemaVersion: 1,
        operatorId,
        actionId,
        causeFixed: true,
        audit,
      })))
      .digest("hex")
    if (blockers.some(({ evidenceDigest: triggeringDigest }) => triggeringDigest === evidenceDigest)) {
      throw new Error("Resolution evidence must be independent from the blocker-triggering evidence")
    }

    for (const blocker of blockers) {
      const result = await recordSafetyBlockerResolved({
        operationalStateStore,
        blockerId: blocker.blockerId,
        resolvedBy: `operator:${operatorId}:${actionId}`,
        resolution: "OPERATOR_ACTION",
        evidenceDigest,
      })
      if (result?.ok !== true || result.data?.durable !== true) {
        return result?.ok === false
          ? result
          : toResult({ error: new Error(`Resolution was not durably committed for blocker ${blocker.blockerId}`) })
      }
    }

    const readback = await readVerifiedProjection(operationalStateStore)
    const remaining = getActiveAccountBlockers(readback.projection)
    if (remaining.length !== 0) {
      return toResult({ error: new Error("Durable readback still contains unresolved ACCOUNT safety blockers") })
    }
    return toResult({
      data: Object.freeze({
        resolvedBlockerIds: Object.freeze(blockerIds),
        evidenceDigest,
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
