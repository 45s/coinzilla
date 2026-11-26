import { createHash } from "node:crypto"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"
import {
  isAuthenticatedLocalOperatorIdentity,
  LOCAL_OPERATOR_ID_PATTERN,
} from "../infrastructure/security/local-operator-identity.js"

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
  operatorIdentity,
  actionId,
  resolutionReason,
  causeFixed,
  configuredMarkets,
}) {
  if (typeof operationalStateStore?.readAll !== "function" ||
      typeof operationalStateStore?.append !== "function" ||
      typeof reconcileAccount !== "function") {
    throw new TypeError("Account-blocker resolution requires a durable store and authoritative reconciliation port")
  }
  if (!LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "") ||
      !isAuthenticatedLocalOperatorIdentity(operatorIdentity) ||
      operatorIdentity.operatorId !== operatorId ||
      operatorIdentity.authMethod !== "OS_ACCOUNT") {
    throw new TypeError("Account-blocker resolution requires an authenticated operating-system operator identity")
  }
  if (!isText(actionId) || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId) ||
      !isText(resolutionReason) ||
      resolutionReason.length < 8 ||
      resolutionReason.length > 512 ||
      /[\\u0000-\\u001F\\u007F]/.test(resolutionReason) ||
      causeFixed !== true) {
    throw new TypeError("Account-blocker resolution requires a unique action ID, resolution reason, and causeFixed=true")
  }
  if (!Array.isArray(configuredMarkets) ||
      configuredMarkets.length === 0 ||
      configuredMarkets.some((symbol) => !isText(symbol) || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
      new Set(configuredMarkets).size !== configuredMarkets.length) {
    throw new TypeError("Account-blocker resolution requires the unique configured market universe")
  }
}

function validateAuditSource(audit) {
  if (audit?.status !== "READY" ||
      audit?.scope !== "ACCOUNT" ||
      audit?.source !== "AUTHORITATIVE_ACCOUNT_RECONCILIATION" ||
      audit?.allConfiguredMarketsAudited !== true) {
    throw new Error("Account-wide reconciliation source or scope is invalid")
  }
}

function validateAuditConsistency(audit) {
  validateAuditCompleteness(audit)
  validateAuditZeroDiscrepancies(audit)
}

function validateAuditCompleteness(audit) {
  if (audit?.openOrdersReconciled !== true ||
      audit?.fillsReconciled !== true ||
      audit?.balancesReconciled !== true ||
      audit?.accountingConsistent !== true) {
    throw new Error("Account-wide reconciliation is incomplete")
  }
}

function validateAuditZeroDiscrepancies(audit) {
  if (audit?.unresolvedOwnedOrders !== 0 ||
      audit?.unresolvedOwnedFills !== 0 ||
      audit?.unresolvedExternalOrders !== 0 ||
      audit?.balanceDiscrepancies !== 0) {
    throw new Error("Account-wide reconciliation did not prove zero discrepancies")
  }
}

function validateAuditStatus(audit) {
  validateAuditSource(audit)
  validateAuditConsistency(audit)
}

function validateAuditMarkets({ audit, configuredMarkets }) {
  const validMarket = (symbol) => isText(symbol) && /^[A-Z0-9]{3,30}$/.test(symbol)
  if (!Array.isArray(audit.auditedMarkets) ||
      audit.auditedMarkets.some((symbol) => !validMarket(symbol)) ||
      new Set(audit.auditedMarkets).size !== audit.auditedMarkets.length ||
      [...audit.auditedMarkets].sort().join("|") !== [...configuredMarkets].sort().join("|")) {
    throw new Error("Account-wide audit did not cover the exact configured market universe")
  }
}

function validateAuditBlockers({ audit, blockerIds }) {
  const origins = audit.blockerOrigins
  if (!Array.isArray(audit.blockerIds) ||
      [...audit.blockerIds].sort().join("|") !== [...blockerIds].sort().join("|") ||
      !Array.isArray(origins) ||
      origins.length !== blockerIds.length ||
      new Set(origins.map(({ blockerId }) => blockerId)).size !== blockerIds.length ||
      [...origins.map(({ blockerId }) => blockerId)].sort().join("|") !== [...blockerIds].sort().join("|") ||
      origins.some(({ producer }) => producer !== "USER_DATA_EVENT_HANDLER")) {
    throw new Error("Account-wide audit must cover exactly the original user-data ACCOUNT blocker action set")
  }
}

export function validateAccountResolutionAudit({
  audit,
  blockerIds,
  configuredMarkets,
  operatorId,
  actionId,
  resolutionReason,
}) {
  validateAuditStatus(audit)
  validateAuditMarkets({
    audit,
    configuredMarkets,
  })
  validateAuditBlockers({
    audit,
    blockerIds,
  })
  if (audit.operatorId !== operatorId ||
      audit.operatorAuthMethod !== "OS_ACCOUNT" ||
      audit.actionId !== actionId ||
      audit.resolutionReason !== resolutionReason ||
      !Array.isArray(audit.actionBlockerIds) ||
      [...audit.actionBlockerIds].sort().join("|") !== [...blockerIds].sort().join("|") ||
      !isText(audit.reconciliationId) ||
      !isText(audit.capturedAt) ||
      !Number.isFinite(Date.parse(audit.capturedAt))) {
    throw new Error("Account-wide audit is missing authenticated operator, action, reason, blocker-set, or capture identity")
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
  return {
    records: result.data.records,
    projection: projection.data,
  }
}

export function getActiveAccountResolutionBlockers(projection) {
  const blockers = (projection.stickySafetyBlockers ?? [])
    .filter(({ scope }) => scope === "ACCOUNT")
    .map((blocker) => ({ ...blocker }))
  if (blockers.some(({ producer }) => producer !== "USER_DATA_EVENT_HANDLER")) {
    throw new Error("An active ACCOUNT blocker has no verified user-data producer provenance")
  }
  return blockers
}

function validateExistingActionResolutionFacts({
  actionFacts,
  operatorId,
  actionId,
  resolutionReason,
}) {
  const first = actionFacts[0]?.data
  const expectedResolvedBy = `operator:${operatorId}:${actionId}`
  if (!first ||
      first.operatorId !== operatorId ||
      first.operatorAuthMethod !== "OS_ACCOUNT" ||
      first.actionId !== actionId ||
      first.resolution !== "OPERATOR_ACTION" ||
      first.resolvedBy !== expectedResolvedBy ||
      first.resolutionReason !== resolutionReason ||
      !Array.isArray(first.actionBlockerIds) ||
      first.actionBlockerIds.length === 0 ||
      first.actionBlockerIds.some((id) => !/^[a-f0-9]{64}$/.test(id)) ||
      new Set(first.actionBlockerIds).size !== first.actionBlockerIds.length ||
      [...first.actionBlockerIds].sort().join("|") !== first.actionBlockerIds.join("|") ||
      !/^[a-f0-9]{64}$/.test(first.evidenceDigest ?? "")) {
    throw new Error("Operator action ID was already used with different identity, reason, evidence, or blocker set")
  }
  for (const record of actionFacts) {
    const data = record.data
    if (data.operatorId !== first.operatorId ||
        data.operatorAuthMethod !== first.operatorAuthMethod ||
        data.actionId !== first.actionId ||
        data.resolution !== first.resolution ||
        data.resolvedBy !== first.resolvedBy ||
        data.resolutionReason !== first.resolutionReason ||
        data.evidenceDigest !== first.evidenceDigest ||
        !Array.isArray(data.actionBlockerIds) ||
        data.actionBlockerIds.join("|") !== first.actionBlockerIds.join("|")) {
      throw new Error("Durable facts for one operator action contain contradictory action metadata")
    }
  }
  return first
}

function getRaisedAccountBlockersByIds({ records, blockerIds }) {
  const raisedById = new Map(records
    .filter((record) => record.factType === "SAFETY_BLOCKER_RAISED")
    .map((record) => [record.data?.blockerId, record.data]))
  return blockerIds.map((blockerId) => {
    const raised = raisedById.get(blockerId)
    if (!raised ||
        raised.scope !== "ACCOUNT" ||
        raised.producer !== "USER_DATA_EVENT_HANDLER") {
      throw new Error("Operator action target contains a missing or non-user-data ACCOUNT blocker")
    }
    return {
      blockerId,
      producer: raised.producer,
      evidenceDigest: raised.evidenceDigest,
      reason: raised.reason,
    }
  })
}

export function getAccountResolutionTargetBlockers({
  records,
  projection,
  operatorId,
  actionId,
  resolutionReason,
}) {
  const activeBlockers = getActiveAccountResolutionBlockers(projection)
    .sort((left, right) => left.blockerId.localeCompare(right.blockerId))
  const resolvedFacts = records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED")
  const legacyActionFact = resolvedFacts.find((record) =>
    record.data?.resolution === "OPERATOR_ACTION" &&
    typeof record.data?.resolvedBy === "string" &&
    record.data.resolvedBy.endsWith(`:${actionId}`) &&
    record.data.actionId === undefined
  )
  if (legacyActionFact) {
    throw new Error("Operator action ID exists in legacy resolution history without replay-safe metadata; use a new action ID")
  }
  const actionFacts = resolvedFacts.filter((record) => record.data?.actionId === actionId)
  if (actionFacts.length === 0) {
    if (activeBlockers.length === 0) {
      throw new Error("No active ACCOUNT safety blockers exist")
    }
    const blockerIds = activeBlockers.map(({ blockerId }) => blockerId).sort()
    return {
      blockers: activeBlockers,
      blockersToResolve: activeBlockers,
      blockerIds,
      priorEvidenceDigest: undefined,
      idempotentReplay: false,
    }
  }

  const firstAction = validateExistingActionResolutionFacts({
    actionFacts,
    operatorId,
    actionId,
    resolutionReason,
  })
  const blockerIds = [...firstAction.actionBlockerIds]
  const blockerIdSet = new Set(blockerIds)
  if (activeBlockers.some(({ blockerId }) => !blockerIdSet.has(blockerId))) {
    throw new Error("New active ACCOUNT blockers are outside the original operator action target set")
  }
  const blockers = getRaisedAccountBlockersByIds({
    records,
    blockerIds,
  })
  const resolvedByBlocker = new Map(resolvedFacts.map((record) => [
    record.data?.blockerId,
    record,
  ]))
  const activeByBlocker = new Map(activeBlockers.map((blocker) => [
    blocker.blockerId,
    blocker,
  ]))
  const blockersToResolve = []
  for (const blocker of blockers) {
    const existingResolution = resolvedByBlocker.get(blocker.blockerId)
    const activeBlocker = activeByBlocker.get(blocker.blockerId)
    if (activeBlocker) {
      if (existingResolution) {
        throw new Error("An ACCOUNT blocker is active despite an existing durable resolution fact")
      }
      blockersToResolve.push(activeBlocker)
      continue
    }
    if (!existingResolution ||
        existingResolution.data.actionId !== actionId ||
        existingResolution.data.evidenceDigest !== firstAction.evidenceDigest) {
      throw new Error("An original action target is neither active nor durably resolved by that same action")
    }
  }
  const firstActionSequence = Math.min(...actionFacts.map((record) => Number(record.sequence)))
  const laterOtherAccountResolution = resolvedFacts.some((record) =>
    Number(record.sequence) > firstActionSequence &&
    record.data.actionId !== actionId &&
    records.some((raised) =>
      raised.factType === "SAFETY_BLOCKER_RAISED" &&
      raised.data?.scope === "ACCOUNT" &&
      raised.data.blockerId === record.data.blockerId &&
      !blockerIdSet.has(record.data.blockerId)
    )
  )
  if (laterOtherAccountResolution) {
    throw new Error("Another ACCOUNT blocker changed after the original operator action; a new action is required")
  }
  return {
    blockers,
    blockersToResolve,
    blockerIds,
    priorEvidenceDigest: firstAction.evidenceDigest,
    idempotentReplay: blockersToResolve.length === 0,
  }
}

export function createAccountResolutionEvidenceDigest({ operatorId, actionId, resolutionReason, operatorIdentity, audit }) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeAccountResolutionEvidence({
      schemaVersion: 1,
      operatorId,
      actionId,
      resolutionReason,
      operatorAuthMethod: operatorIdentity?.authMethod,
      causeFixed: true,
      audit,
    })))
    .digest("hex")
}
