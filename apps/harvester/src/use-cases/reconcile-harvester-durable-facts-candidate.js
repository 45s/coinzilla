import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { recordSafetyBlockerResolved } from "./record-safety-control-facts.js"
import { projectHarvesterDurableFacts } from "../infrastructure/durable-facts/project-harvester-durable-facts.js"
import { reconcileRecoveredMarketState } from "./reconcile-recovered-market-state.js"
import { restoreHarvesterJournalState } from "./restore-harvester-journal-state.js"

/**
 * Reconcile one offline durable-fact candidate market using only the existing
 * read-only recovered-market audit boundary. A passing market audit never
 * establishes account-wide readiness or enables runtime restoration.
 */
const canonicalizeEvidence = (value) => {
  if (Array.isArray(value)) { return value.map(canonicalizeEvidence) }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalizeEvidence(value[key])]),
    )
  }
  return value
}

const createReconciliationEvidenceDigest = ({ targetMarket, historyRetentionEvidence, reconciliation }) =>
  createHash("sha256")
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

export async function reconcileHarvesterDurableFactsCandidate({
  durableFactsStore,
  marketMetadata,
  markets,
  targetMarket,
  reconcileOwnedOrders,
  getRecoveredState,
  refreshAccountSnapshot,
  refreshOpenOrders,
  fetchMarketTradeHistory,
  auditAccountState,
} = {}) {
  try {
    if (typeof durableFactsStore?.readAll !== "function") {
      throw new TypeError("Durable-fact candidate reconciliation requires an initialized read port")
    }
    if (typeof reconcileOwnedOrders !== "function" || typeof getRecoveredState !== "function") {
      throw new TypeError("Durable-fact candidate reconciliation requires a candidate-bound owned-order reconciler and state reader")
    }
    const read = await durableFactsStore.readAll()
    if (read?.ok !== true || read.data?.durableWriteSupported !== true || !Array.isArray(read.data.records)) {
      return toResult({
        errors: read?.errors?.length
          ? read.errors
          : [new Error("Durable-fact stream is not verified and durably readable")],
      })
    }
    const projection = projectHarvesterDurableFacts({ records: read.data.records })
    if (projection?.ok !== true) { return projection }
    const candidate = restoreHarvesterJournalState({ projection, marketMetadata })
    if (candidate?.ok !== true) { return candidate }

    const coverage = [...projection.data.marketHistoryCoverage].reverse().find(({ symbol }) =>
      symbol === targetMarket?.symbol
    )
    if (!coverage) {
      throw new Error("No committed market-history coverage fact exists for " + (targetMarket?.symbol ?? "the target market"))
    }
    const historyRetentionEvidence = Object.freeze({
      ...coverage,
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: coverage.factId,
    })
    let reconciledCandidateState
    const readCandidateState = async () => {
      const result = await getRecoveredState({ candidateState: candidate.data })
      if (result?.ok === false) { throw result.errors?.[0] ?? new Error("Candidate state read failed") }
      reconciledCandidateState = result?.ok === true ? result.data : result
      return reconciledCandidateState
    }
    const reconciliation = await reconcileRecoveredMarketState({
      projection,
      reconcileOwnedOrders: ({ recoveryMode }) => reconcileOwnedOrders({
        candidateState: candidate.data,
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
    if (reconciliation?.ok !== true) { return reconciliation }

    const resolvedSafetyBlockerIds = []
    if (reconciliation.data.ready === true) {
      const blockersToResolve = [...(projection.data.stickySafetyBlockers ?? [])]
        .filter(({ scope, symbol }) => scope === "MARKET" && symbol === targetMarket.symbol)
        .sort((left, right) => left.blockerId.localeCompare(right.blockerId))
      if (blockersToResolve.length > 0) {
        const evidenceDigest = createReconciliationEvidenceDigest({
          targetMarket,
          historyRetentionEvidence,
          reconciliation: reconciliation.data,
        })
        for (const blocker of blockersToResolve) {
          const resolution = await recordSafetyBlockerResolved({
            durableFactsStore,
            blockerId: blocker.blockerId,
            resolvedBy: "reconciliation:market-audit:" + targetMarket.symbol,
            resolution: "AUTHORITATIVE_RECONCILIATION",
            evidenceDigest,
          })
          if (resolution?.ok !== true || resolution.data?.durable !== true) {
            return resolution?.ok === false
              ? resolution
              : toResult({ error: new Error("Authoritative market reconciliation did not durably resolve safety blocker " + blocker.blockerId) })
          }
          resolvedSafetyBlockerIds.push(blocker.blockerId)
        }
      }
    }

    let unresolvedSafetyBlockers = projection.data.stickySafetyBlockers ?? []
    if (resolvedSafetyBlockerIds.length > 0) {
      const readback = await durableFactsStore.readAll()
      if (readback?.ok !== true || readback.data?.durableWriteSupported !== true || !Array.isArray(readback.data.records)) {
        return toResult({
          errors: readback?.errors?.length
            ? readback.errors
            : [new Error("Resolved safety blockers could not be verified in the durable-facts stream")],
        })
      }
      const verifiedProjection = projectHarvesterDurableFacts({ records: readback.data.records })
      if (verifiedProjection?.ok !== true) { return verifiedProjection }
      unresolvedSafetyBlockers = verifiedProjection.data.stickySafetyBlockers
    }

    const targetScopedBlockers = unresolvedSafetyBlockers.filter(({ scope, symbol }) =>
      scope === "ACCOUNT" || symbol === targetMarket.symbol
    )
    const targetMarketReady = reconciliation.data.ready === true && targetScopedBlockers.length === 0
    const targetMarketReconciliation = Object.freeze({
      ...reconciliation.data,
      ready: targetMarketReady,
      status: targetMarketReady ? reconciliation.data.status : "BLOCKED",
      ...(!targetMarketReady && reconciliation.data.ready === true
        ? { reason: "ACTIVE_SAFETY_BLOCKER" }
        : {}),
    })
    const finalCandidate = await readCandidateState()
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
  } catch (error) {
    return toResult({ error })
  }
}
