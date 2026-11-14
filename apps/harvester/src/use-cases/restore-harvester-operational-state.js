import { toResult } from "@coinzilla/utils"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester-durable-facts.js"
import { restoreHarvesterJournalState } from "./restore-harvester-journal-state.js"

/**
 * Verify and rehydrate an offline candidate from the application-owned durable
 * fact stream. This function deliberately performs no broker reads or writes
 * and never marks the candidate ready for strategy evaluation.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore Initialized store with verified readAll().
 * @param {Map|Array} options.marketMetadata Canonical exchange market metadata.
 * @returns {Promise<object>} Candidate Portfolio, RecoveryLedger map, and OrderRegistry.
 */
export async function restoreHarvesterOperationalState({ operationalStateStore, marketMetadata } = {}) {
  try {
    if (typeof operationalStateStore?.readAll !== "function") {
      throw new TypeError("restoreHarvesterOperationalState requires an initialized durable-fact read port")
    }
    const read = await operationalStateStore.readAll()
    if (read?.ok !== true || read.data?.durableWriteSupported !== true || !Array.isArray(read.data.records)) {
      return toResult({
        errors: read?.errors?.length
          ? read.errors
          : [new Error("Durable-fact stream is not verified and durably readable")],
      })
    }
    const projection = projectHarvesterOperationalState({ records: read.data.records })
    if (projection?.ok !== true) { return projection }
    const restored = restoreHarvesterJournalState({ projection, marketMetadata })
    if (restored?.ok !== true) { return restored }
    return toResult({
      data: Object.freeze({
        ...restored.data,
        recoveryCycles: projection.data.recoveryCycles,
        recoveryCycleEvaluations: projection.data.recoveryCycleEvaluations,
        orderSubmissionOutcomes: projection.data.orderSubmissionOutcomes,
        orderCancellationOutcomes: projection.data.orderCancellationOutcomes,
        source: "DURABLE_FACTS",
        candidateOnly: true,
        restorationEnabled: false,
        requiresExchangeReconciliation: true,
        historyCoverageComplete: false,
        lastCommittedSequence: read.data.lastCommittedSequence,
        lastCommittedDigest: read.data.lastCommittedDigest,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
