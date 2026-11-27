import { createHash } from "node:crypto"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"
import {
  hasControlCharacters,
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

function validateAccountResolutionStore({ operationalStateStore, reconcileAccount }) {
  if (typeof operationalStateStore?.readAll !== "function" ||
      typeof operationalStateStore?.append !== "function" ||
      typeof reconcileAccount !== "function") {
    throw new TypeError("Account-blocker resolution requires a durable store and authoritative reconciliation port")
  }
}

function validateAuthenticatedOperator({ operatorId, operatorIdentity }) {
  const authenticated = isAuthenticatedLocalOperatorIdentity(operatorIdentity)
  if (!LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "") ||
      !authenticated ||
      operatorIdentity.operatorId !== operatorId ||
      operatorIdentity.authMethod !== "OS_ACCOUNT") {
    throw new TypeError("Account-blocker resolution requires an authenticated operating-system operator identity")
  }
}

function validateActionDetails({ actionId, resolutionReason, causeFixed }) {
  const validActionId = typeof actionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId)
  const validReason = isText(resolutionReason) &&
    resolutionReason.length >= 8 &&
    resolutionReason.length <= 512 &&
    !hasControlCharacters(resolutionReason)
  if (!validActionId || !validReason || causeFixed !== true) {
    throw new TypeError("Account-blocker resolution requires a unique action ID, resolution reason, and causeFixed=true")
  }
}

function validateConfiguredMarkets(configuredMarkets) {
  const validMarkets = Array.isArray(configuredMarkets) &&
    configuredMarkets.length > 0 &&
    configuredMarkets.every((symbol) => isText(symbol) && /^[A-Z0-9]{3,30}$/.test(symbol))
  if (!validMarkets || new Set(configuredMarkets).size !== configuredMarkets.length) {
    throw new TypeError("Account-blocker resolution requires the unique configured market universe")
  }
}

export function validateAccountResolutionInput(options) {
  validateAccountResolutionStore(options)
  validateAuthenticatedOperator(options)
  validateActionDetails(options)
  validateConfiguredMarkets(options.configuredMarkets)
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
  if (blockers.some(({ producer, reason }) =>
    producer !== "USER_DATA_EVENT_HANDLER" ||
    ["RECOVERY_SELLER_UNEXPECTED_CONDITION", "RECOVERY_SELLER_STOP_RESTART_PENDING"].includes(reason)
  )) {
    throw new Error("An active ACCOUNT blocker has no verified user-data producer provenance or belongs to Recovery Seller STOP")
  }
  return blockers
}

function validateActionBlockerSet(first) {
  const blockerIds = first?.actionBlockerIds
  const validBlockers = Array.isArray(blockerIds) &&
    blockerIds.length > 0 &&
    blockerIds.length <= 256 &&
    blockerIds.every((id) => /^[a-f0-9]{64}$/.test(id))
  const canonicalBlockers = validBlockers &&
    new Set(blockerIds).size === blockerIds.length &&
    [...blockerIds].sort().join("|") === blockerIds.join("|")
  if (!canonicalBlockers) {
    throw new Error("Operator action ID was already used with a different blocker set")
  }
}

function validateActionIdentity({ first, operatorId, actionId }) {
  const expectedResolvedBy = `operator:${operatorId}:${actionId}`
  const validIdentity = first?.operatorId === operatorId &&
    first.operatorAuthMethod === "OS_ACCOUNT" &&
    first.actionId === actionId &&
    first.resolvedBy === expectedResolvedBy
  if (!validIdentity) {
    throw new Error("Operator action ID was already used with a different operator identity")
  }
}

function validateActionReasonAndEvidence({ first, resolutionReason }) {
  const validAction = first?.resolution === "OPERATOR_ACTION" &&
    first.resolutionReason === resolutionReason &&
    /^[a-f0-9]{64}$/.test(first.evidenceDigest ?? "")
  if (!validAction) {
    throw new Error("Operator action ID was already used with a different reason or evidence")
  }
}

function validateFirstActionFact({ first, operatorId, actionId, resolutionReason }) {
  validateActionBlockerSet(first)
  validateActionIdentity({
    first,
    operatorId,
    actionId,
  })
  validateActionReasonAndEvidence({
    first,
    resolutionReason,
  })
  return first
}

function validateActionFactConsistency({ actionFacts, first }) {
  for (const { data } of actionFacts) {
    const sameIdentity = data.operatorId === first.operatorId &&
      data.operatorAuthMethod === first.operatorAuthMethod &&
      data.actionId === first.actionId &&
      data.resolvedBy === first.resolvedBy
    const sameAction = data.resolution === first.resolution &&
      data.resolutionReason === first.resolutionReason &&
      data.evidenceDigest === first.evidenceDigest
    const sameBlockers = Array.isArray(data.actionBlockerIds) &&
      data.actionBlockerIds.join("|") === first.actionBlockerIds.join("|")
    if (!sameIdentity || !sameAction || !sameBlockers) {
      throw new Error("Durable facts for one operator action contain contradictory action metadata")
    }
  }
}

function validateExistingActionResolutionFacts(options) {
  const first = validateFirstActionFact({
    first: options.actionFacts[0]?.data,
    operatorId: options.operatorId,
    actionId: options.actionId,
    resolutionReason: options.resolutionReason,
  })
  validateActionFactConsistency({
    actionFacts: options.actionFacts,
    first,
  })
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

function sortBlockersById(blockers) {
  const blockersById = new Map(blockers.map((blocker) => [blocker.blockerId, blocker]))
  return [...blockersById.keys()].sort().map((blockerId) => blockersById.get(blockerId))
}

function rejectLegacyActionIdReuse({ resolvedFacts, actionId }) {
  const legacyActionFact = resolvedFacts.find((record) =>
    record.data?.resolution === "OPERATOR_ACTION" &&
    typeof record.data?.resolvedBy === "string" &&
    record.data.resolvedBy.endsWith(`:${actionId}`) &&
    record.data.actionId === undefined
  )
  if (legacyActionFact) {
    throw new Error("Operator action ID exists in legacy resolution history without replay-safe metadata; use a new action ID")
  }
}

function createNewActionTargets(activeBlockers) {
  if (activeBlockers.length === 0) {
    throw new Error("No active ACCOUNT safety blockers exist")
  }
  const blockers = sortBlockersById(activeBlockers)
  return {
    blockers,
    blockersToResolve: blockers,
    blockerIds: blockers.map(({ blockerId }) => blockerId),
    priorEvidenceDigest: undefined,
    idempotentReplay: false,
  }
}

function validateActiveBlockersWithinAction({ activeBlockers, blockerIdSet }) {
  if (activeBlockers.some(({ blockerId }) => !blockerIdSet.has(blockerId))) {
    throw new Error("New active ACCOUNT blockers are outside the original operator action target set")
  }
}

function getBlockersToResolve({
  blockers,
  activeBlockers,
  resolvedFacts,
  actionId,
  evidenceDigest,
}) {
  const resolvedByBlocker = new Map(resolvedFacts.map((fact) => [fact.data?.blockerId, fact]))
  const activeByBlocker = new Map(activeBlockers.map((blocker) => [blocker.blockerId, blocker]))
  const blockersToResolve = []
  for (const blocker of blockers) {
    const existingResolution = resolvedByBlocker.get(blocker.blockerId)
    const activeBlocker = activeByBlocker.get(blocker.blockerId)
    if (activeBlocker && existingResolution) {
      throw new Error("An ACCOUNT blocker is active despite an existing durable resolution fact")
    }
    if (activeBlocker) {
      blockersToResolve.push(activeBlocker)
      continue
    }
    if (!existingResolution ||
        existingResolution.data.actionId !== actionId ||
        existingResolution.data.evidenceDigest !== evidenceDigest) {
      throw new Error("An original action target is neither active nor durably resolved by that same action")
    }
  }
  return blockersToResolve
}

function validateNoConcurrentOtherAccountResolution({
  records,
  resolvedFacts,
  actionFacts,
  actionId,
  blockerIdSet,
}) {
  const firstActionSequence = Math.min(...actionFacts.map((fact) => Number(fact.sequence)))
  const raisedAccountBlockerIds = new Set(records
    .filter((fact) => fact.factType === "SAFETY_BLOCKER_RAISED" && fact.data?.scope === "ACCOUNT")
    .map((fact) => fact.data?.blockerId))
  const laterOtherAction = resolvedFacts.some((fact) =>
    Number(fact.sequence) > firstActionSequence &&
    fact.data.actionId !== actionId &&
    raisedAccountBlockerIds.has(fact.data.blockerId) &&
    !blockerIdSet.has(fact.data.blockerId)
  )
  if (laterOtherAction) {
    throw new Error("Another ACCOUNT blocker changed after the original operator action; a new action is required")
  }
}

function getExistingActionTargets({
  records,
  resolvedFacts,
  activeBlockers,
  actionFacts,
  operatorId,
  actionId,
  resolutionReason,
}) {
  const firstAction = validateExistingActionResolutionFacts({
    actionFacts,
    operatorId,
    actionId,
    resolutionReason,
  })
  const blockerIds = [...firstAction.actionBlockerIds]
  const blockerIdSet = new Set(blockerIds)
  validateActiveBlockersWithinAction({
    activeBlockers,
    blockerIdSet,
  })
  const blockers = getRaisedAccountBlockersByIds({
    records,
    blockerIds,
  })
  const blockersToResolve = getBlockersToResolve({
    blockers,
    activeBlockers,
    resolvedFacts,
    actionId,
    evidenceDigest: firstAction.evidenceDigest,
  })
  validateNoConcurrentOtherAccountResolution({
    records,
    resolvedFacts,
    actionFacts,
    actionId,
    blockerIdSet,
  })
  return {
    blockers,
    blockersToResolve,
    blockerIds,
    priorEvidenceDigest: firstAction.evidenceDigest,
    idempotentReplay: blockersToResolve.length === 0,
  }
}

export function getAccountResolutionTargetBlockers({
  records,
  projection,
  operatorId,
  actionId,
  resolutionReason,
}) {
  const activeBlockers = sortBlockersById(getActiveAccountResolutionBlockers(projection))
  const resolvedFacts = records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED")
  rejectLegacyActionIdReuse({
    resolvedFacts,
    actionId,
  })
  const actionFacts = resolvedFacts.filter((record) => record.data?.actionId === actionId)
  if (actionFacts.length === 0) {
    return createNewActionTargets(activeBlockers)
  }
  return getExistingActionTargets({
    records,
    resolvedFacts,
    activeBlockers,
    actionFacts,
    operatorId,
    actionId,
    resolutionReason,
  })
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
