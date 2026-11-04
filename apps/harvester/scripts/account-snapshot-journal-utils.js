import { toResult } from "@coinzilla/utils"
import { reconcileAccountSnapshotDeltas } from "../src/domain/account/reconcile-account-snapshot-deltas.js"

const SNAPSHOT_EVENT = "account.snapshot_captured"

/**
 * Reconcile OPENING/CLOSING snapshot event pairs independently per JSONL
 * session. Missing or duplicate endpoints are incomplete audits, never zeroes.
 */
export function reconcileJournalAccountSnapshotRecords({ records } = {}) {
  try {
    if (!Array.isArray(records)) throw new TypeError("Journal records must be an array")
    const sessions = new Map()
    for (const record of records) {
      const event = record?.payload
      if (event?.name !== SNAPSHOT_EVENT) continue
      const fileName = record?.position?.fileName
      if (typeof fileName !== "string" || !fileName.trim()) {
        throw new TypeError("Account snapshot Journal record requires a session file name")
      }
      if (!sessions.has(fileName)) sessions.set(fileName, { opening: [], closing: [] })
      const phase = event.data?.phase
      if (phase === "OPENING") sessions.get(fileName).opening.push(event.data)
      else if (phase === "CLOSING") sessions.get(fileName).closing.push(event.data)
      else throw new TypeError("Account snapshot Journal event has an invalid phase")
    }
    if (sessions.size === 0) throw new Error("No account.snapshot_captured events were found in Journal sessions")
    const reports = []
    const errors = []
    for (const [session, pair] of [...sessions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const blockers = []
      if (pair.opening.length !== 1) blockers.push("OPENING_SNAPSHOT_COUNT:" + pair.opening.length)
      if (pair.closing.length !== 1) blockers.push("CLOSING_SNAPSHOT_COUNT:" + pair.closing.length)
      if (blockers.length > 0) {
        reports.push({ session, auditStatus: "INCOMPLETE", blockers, assetDeltas: [] })
        errors.push(new Error(session + " has an incomplete account snapshot pair: " + blockers.join(", ")))
        continue
      }
      const result = reconcileAccountSnapshotDeltas({
        openingSnapshot: pair.opening[0],
        closingSnapshot: pair.closing[0],
      })
      if (!result.ok) {
        const details = result.errors?.map((error) => error?.message ?? String(error)).join("; ")
        reports.push({ session, auditStatus: "INCOMPLETE", blockers: [details ?? "SNAPSHOT_RECONCILIATION_FAILED"], assetDeltas: [] })
        errors.push(...(result.errors ?? [new Error("Snapshot reconciliation failed for " + session)]))
        continue
      }
      reports.push({ session, ...result.data })
      if (result.data.auditStatus !== "COMPLETE") {
        errors.push(new Error(session + " closing account snapshot is marked INCOMPLETE"))
      }
    }
    return toResult({
      data: {
        sessionCount: reports.length,
        reports,
        profitAssessment: "NOT_DETERMINABLE_FROM_BALANCE_DELTAS_ALONE",
      },
      ...(errors.length > 0 ? { errors } : {}),
    })
  } catch (error) {
    return toResult({ error })
  }
}
