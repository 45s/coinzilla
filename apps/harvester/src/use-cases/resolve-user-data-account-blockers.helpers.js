import { createHash } from "node:crypto"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"

const isText = (value) => typeof value === "string" && value.trim() === value && value.length > 0

export function canonicalizeAccountResolutionEvidence(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeAccountResolutionEvidence)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalizeAccountResolutionEvidence(value[key]),
    ]))
  }
  return value
}

export function validateAccountResolutionInput({
  operationalStateStore,
  reconcileAccount,
  operatorId,
  actionId,
  causeFixed,
  configuredMarkets,
}) {
  if (typeof operationalStateStore?.readAll !== "function" ||
      typeof operationalStateStore?.append !== "function" ||
      typeof reconcileAccount !== "function") {
    throw new TypeError("Account-blocker resolution requires a durable store and authoritative reconciliation port")
  }
  if (!isText(operatorId) || !isText(actionId) || causeFixed !== true) {
    throw new TypeError("Account-blocker resolution requires operator identity, unique action ID, and causeFixed=true")
  }
  if (!Array.isArray(configuredMarkets) ||
      configuredMarkets.length === 0 ||
      configuredMarkets.some((symbol) => !isText(symbol) || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
      new Set(configuredMarkets).size !== configuredMarkets.length) {
    throw new TypeError("Account-blocker resolution requires the unique configured market universe")
  }
}

function validateAuditStatus(audit) {
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
      audit?.balanceDiscrepancies !== 0) {
    throw new Error("Account-wide reconciliation did not prove complete zero-discrepancy readiness")
  }
}

function validateAuditMarkets(audit, configuredMarkets) {
  const validMarket = (symbol) => isText(symbol) && /^[A-Z0-9]{3,30}$/.test(symbol)
  if (!Array.isArray(audit.auditedMarkets) ||
      audit.auditedMarkets.some((symbol) => !validMarket(symbol)) ||
      new Set(audit.auditedMarkets).size !== audit.auditedMarkets.length ||
      [...audit.auditedMarkets].sort().join("|") !== [...configuredMarkets].sort().join("|")) {
    throw new Error("Account-wide audit did not cover the exact configured market universe")
  }
}

function validateAuditBlockers(audit, blockerIds) {
  const origins = audit.blockerOrigins
  if (!Array.isArray(audit.blockerIds) ||
      [...audit.blockerIds].sort().join("|") !== [...blockerIds].sort().join("|") ||
      !Array.isArray(origins) ||
      origins.length !== blockerIds.length ||
      new Set(origins.map(({ blockerId }) => blockerId)).size !== blockerIds.length ||
      [...origins.map(({ blockerId }) => blockerId)].sort().join("|") !== [...blockerIds].sort().join("|") ||
      origins.some(({ producer }) => producer !== "USER_DATA_EVENT_HANDLER")) {
    throw new Error("Account-wide audit must cover exactly the active user-data ACCOUNT blockers")
  }
}

export function validateAccountResolutionAudit({ audit, blockerIds, configuredMarkets }) {
  validateAuditStatus(audit)
  validateAuditMarkets(audit, configuredMarkets)
  validateAuditBlockers(audit, blockerIds)
  if (!isText(audit.reconciliationId) ||
      !isText(audit.capturedAt) ||
      !Number.isFinite(Date.parse(audit.capturedAt))) {
    throw new Error("Account-wide audit is missing canonical reconciliation identity or capture time")
  }
}

export async function readVerifiedAccountResolutionProjection(store) {
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

export function getActiveAccountResolutionBlockers(projection) {
  return (projection.stickySafetyBlockers ?? [])
    .filter(({ scope }) => scope === "ACCOUNT")
    .map((blocker) => ({ ...blocker }))
}

export function createAccountResolutionEvidenceDigest({ operatorId, actionId, audit }) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeAccountResolutionEvidence({
      schemaVersion: 1,
      operatorId,
      actionId,
      causeFixed: true,
      audit,
    })))
    .digest("hex")
}
