import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
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
export async function recordStrategyMarketControl({
  operationalStateStore,
  action,
  transitionId,
  symbol,
  reason,
} = {}) {
  try {
    requireStore({ operationalStateStore,
operation: "recordStrategyMarketControl" })
    if (action !== "PAUSE" && action !== "RESUME") {
      throw new TypeError("Strategy market-control action must be PAUSE or RESUME")
    }
    if (typeof transitionId !== "string" || !transitionId.trim() || transitionId !== transitionId.trim() ||
        typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol) ||
        typeof reason !== "string" || !reason.trim() || reason !== reason.trim()) {
      throw new TypeError("Strategy market control requires a unique transition ID, canonical symbol, and reason")
    }
    const prefix = action === "PAUSE" ? "strategy-market-paused:" : "strategy-market-resumed:"
    return await appendDurably({
      operationalStateStore,
      operation: "Strategy market-control",
      fact: {
        factId: prefix + transitionId,
        factType: action === "PAUSE" ? "STRATEGY_MARKET_PAUSED" : "STRATEGY_MARKET_RESUMED",
        data: { symbol,
reason },
      },
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
function validateSafetyBlockerRaisedData({ producer, scope, symbol, reason, evidenceDigest }) {
  if (scope !== "ACCOUNT" && scope !== "MARKET") {
    throw new TypeError("Safety blocker scope must be ACCOUNT or MARKET")
  }
  if ((scope === "ACCOUNT" && symbol !== null) ||
      (scope === "MARKET" && (typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)))) {
    throw new TypeError("Safety blocker symbol must be null for ACCOUNT scope or canonical for MARKET scope")
  }
  if (producer !== undefined && producer !== "USER_DATA_EVENT_HANDLER") {
    throw new TypeError("Safety blocker producer must identify a supported producer")
  }
  if (typeof reason !== "string" || !/^[A-Z][A-Z0-9_]{1,127}$/.test(reason) ||
      typeof evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
    throw new TypeError("Safety blocker requires a canonical reason code and SHA-256 evidence digest")
  }
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
function validateSafetyBlockerResolution({
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
  if (typeof blockerId !== "string" || !/^[a-f0-9]{64}$/.test(blockerId) ||
      typeof resolvedBy !== "string" || !resolvedBy.trim() || resolvedBy !== resolvedBy.trim() ||
      !["AUTHORITATIVE_RECONCILIATION", "OPERATOR_ACTION"].includes(resolution) ||
      typeof evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
    throw new TypeError("Safety blocker resolution requires blocker identity, actor, explicit resolution, and SHA-256 evidence")
  }
  if (resolution === "AUTHORITATIVE_RECONCILIATION") {
    if (!resolvedBy.startsWith("reconciliation:") ||
        operatorIdentity !== undefined ||
        operatorId !== undefined ||
        actionId !== undefined ||
        resolutionReason !== undefined ||
        actionBlockerIds !== undefined) {
      throw new TypeError("Authoritative reconciliation resolution must use its exclusive resolver identity")
    }
    return
  }
  const expectedResolvedBy = `operator:${operatorId}:${actionId}`
  if (!isAuthenticatedLocalOperatorIdentity(operatorIdentity) ||
      operatorIdentity.operatorId !== operatorId ||
      operatorIdentity.authMethod !== "OS_ACCOUNT" ||
      !LOCAL_OPERATOR_ID_PATTERN.test(operatorId ?? "") ||
      typeof actionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId) ||
      typeof resolutionReason !== "string" ||
      resolutionReason.trim() !== resolutionReason ||
      resolutionReason.length < 8 ||
      resolutionReason.length > 512 ||
      hasControlCharacters(resolutionReason) ||
      resolvedBy !== expectedResolvedBy ||
      !Array.isArray(actionBlockerIds) ||
      actionBlockerIds.length === 0 ||
      actionBlockerIds.length > 256 ||
      actionBlockerIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) ||
      new Set(actionBlockerIds).size !== actionBlockerIds.length ||
      [...actionBlockerIds].sort().join("|") !== actionBlockerIds.join("|") ||
      !actionBlockerIds.includes(blockerId)) {
    throw new TypeError("Operator blocker resolution requires authenticated identity, unique action ID, reason, and exact blocker set")
  }
}

function sameActionBlockerIds({ left, right }) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((blockerId, index) => blockerId === right[index])
}

function isExactSafetyBlockerResolution({ existing, expected }) {
  return existing?.blockerId === expected.blockerId &&
    existing?.resolvedBy === expected.resolvedBy &&
    existing?.resolution === expected.resolution &&
    existing?.evidenceDigest === expected.evidenceDigest &&
    existing?.operatorId === expected.operatorId &&
    existing?.operatorAuthMethod === expected.operatorAuthMethod &&
    existing?.actionId === expected.actionId &&
    existing?.resolutionReason === expected.resolutionReason &&
    (expected.actionBlockerIds === undefined
      ? existing?.actionBlockerIds === undefined
      : sameActionBlockerIds({
        left: existing?.actionBlockerIds,
        right: expected.actionBlockerIds,
      }))
}

async function verifyRaisedSafetyBlocker({
  operationalStateStore,
  blockerId,
  evidenceDigest,
  expectedResolution,
}) {
  const read = await operationalStateStore.readAll()
  if (read?.ok !== true || !Array.isArray(read.data?.records)) {
    return toResult({
      errors: read?.errors?.length
        ? read.errors
        : [new Error("Safety blocker resolution requires a verified Operational State Store record stream")],
    })
  }
  const raised = read.data.records.find((record) =>
    record.factType === "SAFETY_BLOCKER_RAISED" && record.data?.blockerId === blockerId
  )
  if (!raised) {
    throw new Error("Cannot resolve a safety blocker without its committed raised fact")
  }
  if (raised.data.evidenceDigest === evidenceDigest) {
    throw new Error("Safety-blocker resolution requires evidence independent from the triggering evidence")
  }
  const resolutions = read.data.records.filter((record) =>
    record.factType === "SAFETY_BLOCKER_RESOLVED"
  )
  const existingForBlocker = resolutions.find((record) => record.data?.blockerId === blockerId)
  if (existingForBlocker) {
    if (isExactSafetyBlockerResolution({
      existing: existingForBlocker.data,
      expected: expectedResolution,
    })) {
      return {
        duplicateRecord: existingForBlocker,
      }
    }
    throw new Error("Safety blocker already has a different durable resolution action")
  }
  if (expectedResolution.actionId) {
    const actionRecords = resolutions.filter((record) =>
      record.data?.actionId === expectedResolution.actionId
    )
    for (const record of actionRecords) {
      if (!isExactSafetyBlockerResolution({
        existing: record.data,
        expected: {
          ...expectedResolution,
          blockerId: record.data.blockerId,
        },
      })) {
        throw new Error("Operator action ID was already used with different operator, reason, evidence, or blocker set")
      }
    }
    const legacyActionRecord = resolutions.find((record) =>
      record.data?.resolution === "OPERATOR_ACTION" &&
      typeof record.data?.resolvedBy === "string" &&
      record.data.resolvedBy.endsWith(`:${expectedResolution.actionId}`) &&
      record.data.actionId === undefined
    )
    if (legacyActionRecord) {
      throw new Error("Operator action ID already exists in legacy resolution history without replay-safe metadata")
    }
  }
  return undefined
}

export async function recordSafetyBlockerResolved({
  operationalStateStore,
  blockerId,
  resolvedBy,
  resolution,
  evidenceDigest,
  operatorIdentity,
  operatorId,
  actionId,
  resolutionReason,
  actionBlockerIds,
} = {}) {
  try {
    requireStore({
      operationalStateStore,
      operation: "recordSafetyBlockerResolved",
      needsRead: true,
    })
    validateSafetyBlockerResolution({
      blockerId,
      resolvedBy,
      resolution,
      evidenceDigest,
      operatorIdentity,
      operatorId,
      actionId,
      resolutionReason,
      actionBlockerIds,
    })
    const expectedResolution = {
      blockerId,
      resolvedBy,
      resolution,
      evidenceDigest,
      ...(resolution === "OPERATOR_ACTION"
        ? {
          operatorId,
          operatorAuthMethod: operatorIdentity.authMethod,
          actionId,
          resolutionReason,
          actionBlockerIds: [...actionBlockerIds],
        }
        : {}),
    }
    const verification = await verifyRaisedSafetyBlocker({
      operationalStateStore,
      blockerId,
      evidenceDigest,
      expectedResolution,
    })
    if (verification?.ok === false) {
      return verification
    }
    if (verification?.duplicateRecord) {
      return toResult({
        data: {
          durable: true,
          duplicate: true,
          record: verification.duplicateRecord,
        },
      })
    }
    return await appendDurably({
      operationalStateStore,
      operation: "Safety blocker resolution",
      fact: {
        factId: `safety-blocker-resolved:${blockerId}`,
        factType: "SAFETY_BLOCKER_RESOLVED",
        data: expectedResolution,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
