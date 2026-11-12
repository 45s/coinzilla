import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"

const requireStore = ({ durableFactsStore, operation, needsRead = false }) => {
  if (typeof durableFactsStore?.append !== "function" ||
      (needsRead && typeof durableFactsStore?.readAll !== "function")) {
    throw new TypeError(operation + " requires the initialized durable-fact append/read port")
  }
}

const appendDurably = async ({ durableFactsStore, fact, operation }) => {
  const result = await durableFactsStore.append(fact)
  if (result?.ok !== true || result.data?.durable !== true) {
    return toResult({
      errors: result?.errors?.length
        ? result.errors
        : [new Error(operation + " append did not confirm durable commitment")],
    })
  }
  return result
}

/** Persist a strategy pause/resume transition with a caller-owned unique transition ID. */
export async function recordStrategyMarketControl({
  durableFactsStore,
  action,
  transitionId,
  symbol,
  reason,
} = {}) {
  try {
    requireStore({ durableFactsStore, operation: "recordStrategyMarketControl" })
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
      durableFactsStore,
      operation: "Strategy market-control",
      fact: {
        factId: prefix + transitionId,
        factType: action === "PAUSE" ? "STRATEGY_MARKET_PAUSED" : "STRATEGY_MARKET_RESUMED",
        data: { symbol, reason },
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
export async function recordSafetyBlockerRaised({
  durableFactsStore,
  scope,
  symbol = null,
  reason,
  evidenceDigest,
} = {}) {
  try {
    requireStore({ durableFactsStore, operation: "recordSafetyBlockerRaised" })
    if (scope !== "ACCOUNT" && scope !== "MARKET") {
      throw new TypeError("Safety blocker scope must be ACCOUNT or MARKET")
    }
    if ((scope === "ACCOUNT" && symbol !== null) ||
        (scope === "MARKET" && (typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)))) {
      throw new TypeError("Safety blocker symbol must be null for ACCOUNT scope or canonical for MARKET scope")
    }
    if (typeof reason !== "string" || !/^[A-Z][A-Z0-9_]{1,127}$/.test(reason) ||
        typeof evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
      throw new TypeError("Safety blocker requires a canonical reason code and SHA-256 evidence digest")
    }
    const blockerId = createHash("sha256")
      .update([scope, symbol ?? "", reason, evidenceDigest].join("\0"))
      .digest("hex")
    return await appendDurably({
      durableFactsStore,
      operation: "Safety blocker",
      fact: {
        factId: "safety-blocker-raised:" + blockerId,
        factType: "SAFETY_BLOCKER_RAISED",
        data: { blockerId, scope, symbol, reason, evidenceDigest },
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
export async function recordSafetyBlockerResolved({
  durableFactsStore,
  blockerId,
  resolvedBy,
  resolution,
  evidenceDigest,
} = {}) {
  try {
    requireStore({ durableFactsStore, operation: "recordSafetyBlockerResolved", needsRead: true })
    if (typeof blockerId !== "string" || !/^[a-f0-9]{64}$/.test(blockerId) ||
        typeof resolvedBy !== "string" || !resolvedBy.trim() || resolvedBy !== resolvedBy.trim() ||
        !["AUTHORITATIVE_RECONCILIATION", "OPERATOR_ACTION"].includes(resolution) ||
        typeof evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
      throw new TypeError("Safety blocker resolution requires blocker identity, actor, explicit resolution, and SHA-256 evidence")
    }
    const read = await durableFactsStore.readAll()
    if (read?.ok !== true || !Array.isArray(read.data?.records)) {
      return toResult({
        errors: read?.errors?.length ? read.errors : [new Error("Safety blocker resolution requires a verified durable-fact stream")],
      })
    }
    const raised = read.data.records.find((record) =>
      record.factType === "SAFETY_BLOCKER_RAISED" && record.data?.blockerId === blockerId)
    if (!raised) {
      throw new Error("Cannot resolve a safety blocker without its committed raised fact")
    }
    if (raised.data.evidenceDigest === evidenceDigest) {
      throw new Error("Safety-blocker resolution requires evidence independent from the triggering evidence")
    }
    if ((resolution === "AUTHORITATIVE_RECONCILIATION" && !resolvedBy.startsWith("reconciliation:")) ||
        (resolution === "OPERATOR_ACTION" && !resolvedBy.startsWith("operator:"))) {
      throw new TypeError("Safety-blocker resolver identity must match the explicit reconciliation or operator action")
    }
    return await appendDurably({
      durableFactsStore,
      operation: "Safety blocker resolution",
      fact: {
        factId: "safety-blocker-resolved:" + blockerId,
        factType: "SAFETY_BLOCKER_RESOLVED",
        data: { blockerId, resolvedBy, resolution, evidenceDigest },
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
