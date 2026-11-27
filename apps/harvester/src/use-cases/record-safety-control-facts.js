import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { mapStrategyPausedData } from "../application/events/lifecycle-event-dtos.js"
import {
  hasControlCharacters,
  isAuthenticatedLocalOperatorIdentity,
  LOCAL_OPERATOR_ID_PATTERN,
} from "../infrastructure/security/local-operator-identity.js"

const requireStore = ({ operationalStateStore, operation, needsRead = false }) => {
  if (typeof operationalStateStore?.append !== "function" ||
      (needsRead && typeof operationalStateStore?.readAll !== "function")) {
    throw new TypeError(`${operation  } requires the initialized Operational State Store append/read capability`)
  }
}

const appendDurably = async ({ operationalStateStore, fact, operation }) => {
  const result = await operationalStateStore.append(fact)
  if (result?.ok !== true || result.data?.durable !== true) {
    return toResult({
      errors: result?.errors?.length
        ? result.errors
        : [new Error(`${operation  } append did not confirm durable commitment`)],
    })
  }
  return result
}

/** Persist a strategy pause/resume transition with a caller-owned unique transition ID. */
function validateStrategyMarketControlAction(action) {
  if (action !== "PAUSE" && action !== "RESUME") {
    throw new TypeError("Strategy market-control action must be PAUSE or RESUME")
  }
}

function validateStrategyMarketControlIdentity({ transitionId, symbol, reason } = {}) {
  const validTransitionId = typeof transitionId === "string" &&
    transitionId.trim() !== "" &&
    transitionId === transitionId.trim()
  const validSymbol = typeof symbol === "string" && /^[A-Z0-9]{3,30}$/.test(symbol)
  const validReason = typeof reason === "string" && reason.trim() !== "" && reason === reason.trim()
  if (!validTransitionId || !validSymbol || !validReason) {
    throw new TypeError("Strategy market control requires a unique transition ID, canonical symbol, and reason")
  }
}

function validateStrategyMarketControlError({ action, error } = {}) {
  if (error !== undefined && (action !== "PAUSE" || !(error instanceof Error))) {
    throw new TypeError("Strategy market-control error evidence is allowed only as an Error on PAUSE")
  }
}

function createStrategyMarketControlFact({
  action,
  transitionId,
  symbol,
  reason,
  error,
} = {}) {
  validateStrategyMarketControlAction(action)
  validateStrategyMarketControlIdentity({
    transitionId,
    symbol,
    reason,
  })
  validateStrategyMarketControlError({
    action,
    error,
  })
  const pauseData = action === "PAUSE"
    ? mapStrategyPausedData({
      symbol,
      reason,
      error,
    }).data
    : undefined
  const prefix = action === "PAUSE" ? "strategy-market-paused:" : "strategy-market-resumed:"
  return {
    factId: prefix + transitionId,
    factType: action === "PAUSE" ? "STRATEGY_MARKET_PAUSED" : "STRATEGY_MARKET_RESUMED",
    data: pauseData ?? {
      symbol,
      reason,
    },
  }
}

export async function recordStrategyMarketControl(input = {}) {
  try {
    const { operationalStateStore } = input
    requireStore({ operationalStateStore,
      operation: "recordStrategyMarketControl" })
    const fact = createStrategyMarketControlFact(input)
    return await appendDurably({
      operationalStateStore,
      operation: "Strategy market-control",
      fact,
    })
  } catch (error) {
    return toResult({ error })
  }
}

/**
 * Persist a sticky safety blocker. Its identity binds scope/reason to the digest
 * of the evidence that caused the blocker; the evidence itself remains outside
 * the fact stream unless separately allowlisted.
 */
function validateSafetyBlockerScopeAndSymbol({ scope, symbol }) {
  const validScope = scope === "ACCOUNT" || scope === "MARKET"
  if (!validScope) {
    throw new TypeError("Safety blocker scope must be ACCOUNT or MARKET")
  }
  const validAccountSymbol = scope === "ACCOUNT" && symbol === null
  const validMarketSymbol = scope === "MARKET" &&
    typeof symbol === "string" &&
    /^[A-Z0-9]{3,30}$/.test(symbol)
  if (!validAccountSymbol && !validMarketSymbol) {
    throw new TypeError("Safety blocker symbol must be null for ACCOUNT scope or canonical for MARKET scope")
  }
}

function validateSafetyBlockerProducer({ producer, reason }) {
  const validProducer = producer === undefined ||
    ["USER_DATA_EVENT_HANDLER", "RECOVERY_SELLER_STOP_WORKFLOW"].includes(producer)
  if (!validProducer) {
    throw new TypeError("Safety blocker producer must identify a supported producer")
  }
  if (producer === "RECOVERY_SELLER_STOP_WORKFLOW" && reason !== "RECOVERY_SELLER_UNEXPECTED_CONDITION") {
    throw new TypeError("Recovery Seller STOP producer may emit only its dedicated blocker reason")
  }
}

function validateSafetyBlockerReasonAndEvidence({ reason, evidenceDigest }) {
  const validReason = typeof reason === "string" && /^[A-Z][A-Z0-9_]{1,127}$/.test(reason)
  const validDigest = typeof evidenceDigest === "string" && /^[a-f0-9]{64}$/.test(evidenceDigest)
  if (!validReason || !validDigest) {
    throw new TypeError("Safety blocker requires a canonical reason code and SHA-256 evidence digest")
  }
}

function validateSafetyBlockerRaisedData(input) {
  validateSafetyBlockerScopeAndSymbol(input)
  validateSafetyBlockerProducer(input)
  validateSafetyBlockerReasonAndEvidence(input)
}

export async function recordSafetyBlockerRaised({
  operationalStateStore,
  producer = "USER_DATA_EVENT_HANDLER",
  scope,
  symbol = null,
  reason,
  evidenceDigest,
} = {}) {
  try {
    requireStore({ operationalStateStore,
operation: "recordSafetyBlockerRaised" })
    validateSafetyBlockerRaisedData({
      producer,
      scope,
      symbol,
      reason,
      evidenceDigest,
    })
    const blockerId = createHash("sha256")
      .update([scope, symbol ?? "", reason, evidenceDigest].join("\0"))
      .digest("hex")
    return await appendDurably({
      operationalStateStore,
      operation: "Safety blocker",
      fact: {
        factId: `safety-blocker-raised:${  blockerId}`,
        factType: "SAFETY_BLOCKER_RAISED",
        data: {
          blockerId,
          ...(producer === undefined ? {} : { producer }),
          scope,
          symbol,
          reason,
          evidenceDigest,
        },
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}

/**
 * Resolve an existing sticky blocker only with explicit actor/action and
 * independent reconciliation evidence. Restart alone is never a resolution.
 */
function isRecoverySellerStopBlocker(raisedFact) {
  const producer = raisedFact?.data?.producer
  const isRecoverySellerProducer = producer === undefined || producer === "RECOVERY_SELLER_STOP_WORKFLOW"
  return isRecoverySellerProducer &&
    raisedFact?.data?.reason === "RECOVERY_SELLER_UNEXPECTED_CONDITION"
}

function validateOperatorActionIdentity({ operatorIdentity, operatorId, actionId, resolvedBy }) {
  const expectedResolvedBy = `operator:${operatorId}:${actionId}`
  const authenticated = isAuthenticatedLocalOperatorIdentity(operatorIdentity)
  const validOperator = authenticated &&
    operatorIdentity.operatorId === operatorId &&
    operatorIdentity.authMethod === "OS_ACCOUNT" &&
    LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "")
  const validAction = typeof actionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId) &&
    resolvedBy === expectedResolvedBy
  if (!validOperator || !validAction) {
    throw new TypeError("Operator blocker resolution requires an authenticated OS identity and unique action ID")
  }
}

function validateOperatorActionReason(resolutionReason) {
  const validReason = typeof resolutionReason === "string" &&
    resolutionReason.trim() === resolutionReason &&
    resolutionReason.length >= 8 &&
    resolutionReason.length <= 512 &&
    !hasControlCharacters(resolutionReason)
  if (!validReason) {
    throw new TypeError("Operator blocker resolution requires a printable 8-512 character reason")
  }
}

function validateOperatorActionBlockerSet({ blockerId, actionBlockerIds }) {
  const validBlockerIds = Array.isArray(actionBlockerIds) &&
    actionBlockerIds.length > 0 &&
    actionBlockerIds.length <= 256 &&
    actionBlockerIds.every((id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
  const canonicalBlockerIds = validBlockerIds &&
    new Set(actionBlockerIds).size === actionBlockerIds.length &&
    [...actionBlockerIds].sort().join("|") === actionBlockerIds.join("|")
  if (!canonicalBlockerIds || !actionBlockerIds.includes(blockerId)) {
    throw new TypeError("Operator blocker resolution requires the exact canonical target blocker set")
  }
}

function validateOperatorActionMetadata(options) {
  validateOperatorActionIdentity(options)
  validateOperatorActionReason(options.resolutionReason)
  validateOperatorActionBlockerSet(options)
}

function validateRecoverySellerStopAction(options) {
  validateOperatorActionMetadata(options)
  const exactBlockerSet = Array.isArray(options.actionBlockerIds) &&
    options.actionBlockerIds.length === 1 &&
    options.actionBlockerIds[0] === options.blockerId
  if (!exactBlockerSet) {
    throw new TypeError("Recovery Seller STOP resolution requires the exact durable blocker set")
  }
}

function validateSafetyBlockerResolutionBase({ blockerId, resolvedBy, resolution, evidenceDigest }) {
  const validBlockerId = typeof blockerId === "string" && /^[a-f0-9]{64}$/.test(blockerId)
  const validActor = typeof resolvedBy === "string" &&
    resolvedBy.trim() !== "" &&
    resolvedBy === resolvedBy.trim()
  const validResolution = ["AUTHORITATIVE_RECONCILIATION", "OPERATOR_ACTION"].includes(resolution)
  const validEvidence = typeof evidenceDigest === "string" && /^[a-f0-9]{64}$/.test(evidenceDigest)
  if (!validBlockerId || !validActor || !validResolution || !validEvidence) {
    throw new TypeError("Safety blocker resolution requires blocker identity, actor, explicit resolution, and SHA-256 evidence")
  }
}

function validateSafetyBlockerResolution(options) {
  validateSafetyBlockerResolutionBase(options)
  if (options.raisedFact?.data?.reason === "RECOVERY_SELLER_UNEXPECTED_CONDITION" &&
      options.raisedFact.data.producer !== "RECOVERY_SELLER_STOP_WORKFLOW" &&
      options.raisedFact.data.producer !== undefined) {
    throw new TypeError("Recovery Seller STOP reason has ambiguous producer provenance and cannot be resolved")
  }
  if (isRecoverySellerStopBlocker(options.raisedFact)) {
    if (options.resolution !== "OPERATOR_ACTION") {
      throw new TypeError("Recovery Seller STOP must remain exclusively owned by its operator-action resolver")
    }
    validateRecoverySellerStopAction(options)
    return
  }
  if (options.raisedFact?.data?.scope === "ACCOUNT") {
    if (options.resolution !== "OPERATOR_ACTION" ||
        options.raisedFact.data.producer !== "USER_DATA_EVENT_HANDLER") {
      throw new TypeError("Account-wide user-data blockers require authenticated structured operator-action resolution")
    }
    validateOperatorActionMetadata(options)
    return
  }
  if (options.resolution === "AUTHORITATIVE_RECONCILIATION") {
    const hasOperatorMetadata = [
      options.operatorIdentity,
      options.operatorId,
      options.actionId,
      options.resolutionReason,
      options.actionBlockerIds,
    ].some((value) => value !== undefined)
    if (hasOperatorMetadata) {
      throw new TypeError("Authoritative reconciliation facts must not contain operator-action metadata")
    }
    return
  }
  throw new TypeError("Operator-action resolution is restricted to account-wide user-data blockers and Recovery Seller STOP")
}

function sameActionBlockerIds({ left, right }) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.join("|") === right.join("|")
}

function isSameOperatorActionMetadata({ existing, expected }) {
  const sameIdentity = existing?.operatorId === expected.operatorId &&
    existing?.operatorAuthMethod === expected.operatorAuthMethod &&
    existing?.actionId === expected.actionId
  const sameReasonAndEvidence = existing?.resolutionReason === expected.resolutionReason &&
    existing?.evidenceDigest === expected.evidenceDigest
  return sameIdentity &&
    sameReasonAndEvidence &&
    sameActionBlockerIds({
      left: existing?.actionBlockerIds,
      right: expected.actionBlockerIds,
    })
}

function hasNoOperatorActionMetadata(existing) {
  return existing?.actionBlockerIds === undefined &&
    existing?.actionId === undefined &&
    existing?.operatorId === undefined &&
    existing?.operatorAuthMethod === undefined &&
    existing?.resolutionReason === undefined
}

function isSameResolutionBase({ existing, expected }) {
  return existing?.blockerId === expected.blockerId &&
    existing?.resolvedBy === expected.resolvedBy &&
    existing?.resolution === expected.resolution &&
    existing?.evidenceDigest === expected.evidenceDigest
}

function isSameResolutionMetadata({ existing, expected }) {
  if (expected.actionBlockerIds === undefined) {
    return hasNoOperatorActionMetadata(existing)
  }
  return isSameOperatorActionMetadata({
    existing,
    expected,
  })
}

function isExactSafetyBlockerResolution({ existing, expected }) {
  return isSameResolutionBase({
    existing,
    expected,
  }) && isSameResolutionMetadata({
    existing,
    expected,
  })
}

async function readRaisedSafetyBlockerContext({ operationalStateStore, blockerId, evidenceDigest }) {
  const read = await operationalStateStore.readAll()
  if (read?.ok !== true || !Array.isArray(read.data?.records)) {
    return toResult({
      errors: read?.errors?.length
        ? read.errors
        : [new Error("Safety blocker resolution requires a verified Operational State Store record stream")],
    })
  }
  const raisedFact = read.data.records.find((record) =>
    record.factType === "SAFETY_BLOCKER_RAISED" && record.data?.blockerId === blockerId
  )
  if (!raisedFact) {
    throw new Error("Cannot resolve a safety blocker without its committed raised fact")
  }
  if (raisedFact.data.evidenceDigest === evidenceDigest) {
    throw new Error("Safety-blocker resolution requires evidence independent from the triggering evidence")
  }
  return {
    records: read.data.records,
    raisedFact,
  }
}

function findExistingBlockerResolution({ records, expectedResolution }) {
  const existing = records.find((record) =>
    record.factType === "SAFETY_BLOCKER_RESOLVED" &&
    record.data?.blockerId === expectedResolution.blockerId
  )
  if (!existing) {
    return undefined
  }
  if (!isExactSafetyBlockerResolution({
    existing: existing.data,
    expected: expectedResolution,
  })) {
    throw new Error("Safety blocker already has a different durable resolution action")
  }
  return existing
}

function validateActionIdReuse({ records, expectedResolution }) {
  if (!expectedResolution.actionId) {
    return
  }
  const actionRecords = records.filter((record) =>
    record.factType === "SAFETY_BLOCKER_RESOLVED" &&
    record.data?.actionId === expectedResolution.actionId
  )
  for (const record of actionRecords) {
    if (!isSameOperatorActionMetadata({
      existing: record.data,
      expected: expectedResolution,
    })) {
      throw new Error("Operator action ID was already used with different operator, reason, evidence, or blocker set")
    }
  }
  const legacyActionRecord = records.find((record) =>
    record.data?.resolution === "OPERATOR_ACTION" &&
    typeof record.data?.resolvedBy === "string" &&
    record.data.resolvedBy.endsWith(`:${expectedResolution.actionId}`) &&
    record.data.actionId === undefined
  )
  if (legacyActionRecord) {
    throw new Error("Operator action ID already exists in legacy resolution history without replay-safe metadata")
  }
}

function createExpectedResolution({
  blockerId,
  resolvedBy,
  resolution,
  evidenceDigest,
  operatorIdentity,
  operatorId,
  actionId,
  resolutionReason,
  actionBlockerIds,
}) {
  const base = {
    blockerId,
    resolvedBy,
    resolution,
    evidenceDigest,
  }
  if (resolution !== "OPERATOR_ACTION" || actionBlockerIds === undefined) {
    return base
  }
  return {
    ...base,
    operatorId,
    operatorAuthMethod: operatorIdentity.authMethod,
    actionId,
    resolutionReason,
    actionBlockerIds: [...actionBlockerIds],
  }
}

async function persistSafetyBlockerResolution({
  operationalStateStore,
  context,
  options,
}) {
  validateSafetyBlockerResolution({
    ...options,
    raisedFact: context.raisedFact,
  })
  const expectedResolution = createExpectedResolution(options)
  const existing = findExistingBlockerResolution({
    records: context.records,
    expectedResolution,
  })
  if (existing) {
    return toResult({
      data: {
        durable: true,
        duplicate: true,
        record: existing,
      },
    })
  }
  validateActionIdReuse({
    records: context.records,
    expectedResolution,
  })
  return appendDurably({
    operationalStateStore,
    operation: "Safety blocker resolution",
    fact: {
      factId: `safety-blocker-resolved:${options.blockerId}`,
      factType: "SAFETY_BLOCKER_RESOLVED",
      data: expectedResolution,
    },
  })
}

export async function recordSafetyBlockerResolved(options = {}) {
  try {
    const { operationalStateStore, blockerId, evidenceDigest } = options
    requireStore({
      operationalStateStore,
      operation: "recordSafetyBlockerResolved",
      needsRead: true,
    })
    const context = await readRaisedSafetyBlockerContext({
      operationalStateStore,
      blockerId,
      evidenceDigest,
    })
    if (context?.ok === false) {
      return context
    }
    return await persistSafetyBlockerResolution({
      operationalStateStore,
      context,
      options,
    })
  } catch (error) {
    return toResult({ error })
  }
}
