import { toResult } from "@coinzilla/utils"
import { projectHarvesterDurableFacts } from "../infrastructure/durable-facts/project-harvester-durable-facts.js"
import { reconcileRecoveredMarketState } from "./reconcile-recovered-market-state.js"
import { restoreHarvesterJournalState } from "./restore-harvester-journal-state.js"

/**
 * Reconcile one offline durable-fact candidate market using only the existing
 * read-only recovered-market audit boundary. A passing market audit never
 * establishes account-wide readiness or enables runtime restoration.
 */
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
    const finalCandidate = await readCandidateState()
    return toResult({
      data: Object.freeze({
        candidateState: finalCandidate,
        targetMarketReconciliation: reconciliation.data,
        targetMarketReady: reconciliation.data.ready,
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
