import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester-operational-state.js"
import { reconcileRecoveredMarketState } from "./reconcile-recovered-market-state.js"
import { restoreHarvesterJournalState } from "./restore-harvester-journal-state.js"

function canonicalizeEvidence(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeEvidence)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalizeEvidence(value[key])]),
    )
  }
  return value
}

function createReconciliationEvidenceDigest({ targetMarket, historyRetentionEvidence, reconciliation }) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeEvidence({
      schemaVersion: 1,
      targetMarket: {
        marketId: targetMarket.id,
        venue: targetMarket.venue,
        symbol: targetMarket.symbol,
      },
      historyRetentionEvidence,
      reconciliation: {
        status: reconciliation.status,
        orderReconciliation: reconciliation.orderReconciliation,
        audit: reconciliation.audit,
      },
    })))
    .digest("hex")
}

async function readVerifiedProjection({ operationalStateStore }) {
  const read = await operationalStateStore.readAll()
  if (read?.ok !== true || read.data?.durableWriteSupported !== true || !Array.isArray(read.data.records)) {
    return toResult({
      errors: read?.errors?.length
        ? read.errors
        : [new Error("Durable-fact stream is not verified and durably readable")],
    })
  }
  return projectHarvesterOperationalState({ records: read.data.records })
}

function createHistoryRetentionEvidence({ projection, targetMarket }) {
  const coverage = [...projection.data.marketHistoryCoverage].reverse().find(({ symbol }) =>
    symbol === targetMarket?.symbol
  )
  if (!coverage) {
    throw new Error(`No committed market-history coverage fact exists for ${targetMarket?.symbol ?? "the target market"}`)
  }
  return Object.freeze({
    ...coverage,
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    baselineFactId: coverage.factId,
  })
}

async function reconcileCandidateMarket({
  projection,
  candidateState,
  reconcileOwnedOrders,
  getRecoveredState,
  refreshAccountSnapshot,
  refreshOpenOrders,
  fetchMarketTradeHistory,
  markets,
  targetMarket,
  historyRetentionEvidence,
  auditAccountState,
}) {
  const readCandidateState = async () => {
    const result = await getRecoveredState({ candidateState })
    if (result?.ok === false) {
      throw result.errors?.[0] ?? new Error("Candidate state read failed")
    }
    return result?.ok === true ? result.data : result
  }
  const reconciliation = await reconcileRecoveredMarketState({
    projection,
    reconcileOwnedOrders: ({ recoveryMode }) => reconcileOwnedOrders({
      candidateState,
      recoveryMode,
    }),
    getRecoveredState: readCandidateState,
    refreshAccountSnapshot,
    refreshOpenOrders,
    fetchMarketTradeHistory,
    markets,
    targetMarket,
    historyRetentionEvidence,
    ...(auditAccountState ? { auditAccountState } : {}),
  })
  return { reconciliation, readCandidateState }
}

async function resolveMarketSafetyBlockers({
  operationalStateStore,
  projection,
  targetMarket,
  historyRetentionEvidence,
  reconciliation,
}) {
  const resolvedSafetyBlockerIds = []
  let unresolvedSafetyBlockers = projection.data.stickySafetyBlockers ?? []
  if (reconciliation.data.ready === true) {
    const blockersToResolve = [...unresolvedSafetyBlockers]
      .filter(({ scope, symbol }) => scope === "MARKET" && symbol === targetMarket.symbol)
      .sort((...blockers) => {
        const [left, right] = blockers
        return left.blockerId.localeCompare(right.blockerId)
      })
    if (blockersToResolve.length > 0) {
      const evidenceDigest = createReconciliationEvidenceDigest({
        targetMarket,
        historyRetentionEvidence,
        reconciliation: reconciliation.data,
      })
      for (const blocker of blockersToResolve) {
        const resolution = await recordSafetyBlockerResolved({
          operationalStateStore,
          blockerId: blocker.blockerId,
          resolvedBy: `reconciliation:market-audit:${targetMarket.symbol}`,
          resolution: "AUTHORITATIVE_RECONCILIATION",
          evidenceDigest,
        })
        if (resolution?.ok !== true || resolution.data?.durable !== true) {
          return resolution?.ok === false
            ? resolution
            : toResult({
              error: new Error(`Authoritative market reconciliation did not durably resolve safety blocker ${blocker.blockerId}`),
            })
        }
        resolvedSafetyBlockerIds.push(blocker.blockerId)
      }
    }
  }

  if (resolvedSafetyBlockerIds.length > 0) {
    const readback = await operationalStateStore.readAll()
    if (readback?.ok !== true || readback.data?.durableWriteSupported !== true || !Array.isArray(readback.data.records)) {
      return toResult({
        errors: readback?.errors?.length
          ? readback.errors
          : [new Error("Resolved safety blockers could not be verified in the Operational State Store")],
      })
    }
    const verifiedProjection = projectHarvesterOperationalState({ records: readback.data.records })
    if (verifiedProjection?.ok !== true) {
      return verifiedProjection
    }
    unresolvedSafetyBlockers = verifiedProjection.data.stickySafetyBlockers
  }
  return { resolvedSafetyBlockerIds, unresolvedSafetyBlockers }
}

function validateCandidateReconciliationInput(options) {
  const {
    operationalStateStore,
    reconcileOwnedOrders,
    getRecoveredState,
  } = options
  if (typeof operationalStateStore?.readAll !== "function") {
    throw new TypeError("Durable-fact candidate reconciliation requires an initialized read port")
  }
  if (typeof reconcileOwnedOrders !== "function" || typeof getRecoveredState !== "function") {
    throw new TypeError("Durable-fact candidate reconciliation requires a candidate-bound owned-order reconciler and state reader")
  }
  return options
}

function createCandidateReconciliationResult({
  reconciliation,
  resolvedSafetyBlockerIds,
  unresolvedSafetyBlockers,
  finalCandidate,
  targetMarket,
}) {
  const targetScopedBlockers = unresolvedSafetyBlockers.filter(({ scope, symbol }) =>
    scope === "ACCOUNT" || symbol === targetMarket.symbol
  )
  const targetMarketReady = reconciliation.ready === true && targetScopedBlockers.length === 0
  const targetMarketReconciliation = Object.freeze({
    ...reconciliation,
    ready: targetMarketReady,
    status: targetMarketReady ? reconciliation.status : "BLOCKED",
    ...(!targetMarketReady && reconciliation.ready === true
      ? { reason: "ACTIVE_SAFETY_BLOCKER" }
      : {}),
  })
  const candidateState = Object.freeze({
    ...finalCandidate,
    stickySafetyBlockers: Object.freeze([...unresolvedSafetyBlockers]),
  })
  return toResult({
    data: Object.freeze({
      candidateState,
      targetMarketReconciliation,
      targetMarketReady,
      resolvedSafetyBlockerIds: Object.freeze([...resolvedSafetyBlockerIds]),
      unresolvedSafetyBlockers: Object.freeze([...unresolvedSafetyBlockers]),
      readiness: "BLOCKED",
      allMarketsReady: false,
      candidateOnly: true,
      restorationEnabled: false,
      requiresExchangeReconciliation: true,
      historyCoverageComplete: false,
    }),
  })
}

async function runCandidateMarketReconciliation({ input, projection, candidate }) {
  const {
    operationalStateStore,
    marketMetadata,
    markets,
    targetMarket,
    reconcileOwnedOrders,
    getRecoveredState,
    refreshAccountSnapshot,
    refreshOpenOrders,
    fetchMarketTradeHistory,
    auditAccountState,
  } = input
  const historyRetentionEvidence = createHistoryRetentionEvidence({ projection, targetMarket })
  const { reconciliation, readCandidateState } = await reconcileCandidateMarket({
    projection,
    candidateState: candidate.data,
    reconcileOwnedOrders,
    getRecoveredState,
    refreshAccountSnapshot,
    refreshOpenOrders,
    fetchMarketTradeHistory,
    markets,
    targetMarket,
    historyRetentionEvidence,
    auditAccountState,
  })
  if (reconciliation?.ok !== true) {
    return reconciliation
  }

  const safetyBlockers = await resolveMarketSafetyBlockers({
    operationalStateStore,
    projection,
    targetMarket,
    historyRetentionEvidence,
    reconciliation,
  })
  if (safetyBlockers?.ok === false) {
    return safetyBlockers
  }
  const finalCandidate = await readCandidateState()
  return createCandidateReconciliationResult({
    reconciliation: reconciliation.data,
    resolvedSafetyBlockerIds: safetyBlockers.resolvedSafetyBlockerIds,
    unresolvedSafetyBlockers: safetyBlockers.unresolvedSafetyBlockers,
    finalCandidate,
    targetMarket,
  })
}

/**
 * Reconcile one offline durable-fact candidate market using only the existing
 * read-only recovered-market audit boundary. A passing market audit never
 * establishes account-wide readiness or enables runtime restoration.
 */
export async function reconcileHarvesterOperationalStateCandidate(options = {}) {
  try {
    const input = validateCandidateReconciliationInput(options)
    const projection = await readVerifiedProjection({
      operationalStateStore: input.operationalStateStore,
    })
    if (projection?.ok !== true) {
      return projection
    }
    const candidate = restoreHarvesterJournalState({
      projection,
      marketMetadata: input.marketMetadata,
    })
    if (candidate?.ok !== true) {
      return candidate
    }
    return await runCandidateMarketReconciliation({ input, projection, candidate })
  } catch (error) {
    return toResult({ error })
  }
}
