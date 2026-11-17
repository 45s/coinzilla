import { addDecimal, assertDecimalString, toResult } from "@coinzilla/utils"
import { reconcileAccountSnapshotDeltas } from "../src/domain/account/reconcile-account-snapshot-deltas.js"

const SNAPSHOT_EVENT = "account.snapshot_captured"
const RECOVERY_CYCLE_EVENT = "recovery.cycle_completed"

function addRecordToSession({
      sessions,
      record,
    }) {
  const event = record?.payload
  if (![SNAPSHOT_EVENT, RECOVERY_CYCLE_EVENT].includes(event?.name)) {
    return
  }

  const fileName = record?.position?.fileName
  if (typeof fileName !== "string" || !fileName.trim()) {
    throw new TypeError("Account audit Journal record requires a session file name")
  }

  if (!sessions.has(fileName)) {
    sessions.set(fileName, {
      opening: [],
      closing: [],
      recoveryCycleProfits: [],
    })
  }

  const session = sessions.get(fileName)
  if (event.name === RECOVERY_CYCLE_EVENT) {
    const profit = event.data?.realizedNetProfit
    assertDecimalString({
      value: profit,
      field: "recovery.cycle_completed.realizedNetProfit",
    })
    session.recoveryCycleProfits.push(profit)
    return
  }

  const phase = event.data?.phase
  if (phase === "PREFLIGHT" || phase === "OPENING") {
    session.opening.push(event.data)
  } else if (phase === "CLOSING") {
    session.closing.push(event.data)
  } else {
    throw new TypeError("Account snapshot Journal event has an invalid phase")
  }
}

function collectSessions({ records }) {
  const sessions = new Map()
  for (const record of records) {
    addRecordToSession({
      sessions,
      record,
    })
  }
  if (sessions.size === 0) {
    throw new Error("No account.snapshot_captured events were found in Journal sessions")
  }
  return sessions
}

function createRecoverySummary({ recoveryCycleProfits }) {
  let cumulativeRecoveryNetProfit = "0"
  for (const profit of recoveryCycleProfits) {
    cumulativeRecoveryNetProfit = addDecimal({
      left: cumulativeRecoveryNetProfit,
      right: profit,
    })
  }
  return {
    recoveryCycleCount: recoveryCycleProfits.length,
    recoveryCycleProfits: [...recoveryCycleProfits],
    cumulativeRecoveryNetProfit,
  }
}

function createSessionReport({
        session,
        pair,
      }) {
  const blockers = []
  if (pair.opening.length !== 1) {
    blockers.push(`PREFLIGHT_SNAPSHOT_COUNT:${pair.opening.length}`)
  }
  if (pair.closing.length !== 1) {
    blockers.push(`CLOSING_SNAPSHOT_COUNT:${pair.closing.length}`)
  }

  const recoverySummary = createRecoverySummary({
    recoveryCycleProfits: pair.recoveryCycleProfits,
  })
  if (blockers.length > 0) {
    return {
      report: {
        session,
        auditStatus: "INCOMPLETE",
        blockers,
        assetDeltas: [],
        ...recoverySummary,
      },
      errors: [
        new Error(`${session} has an incomplete account snapshot pair: ${blockers.join(", ")}`),
      ],
    }
  }

  const result = reconcileAccountSnapshotDeltas({
    openingSnapshot: pair.opening[0],
    closingSnapshot: pair.closing[0],
  })
  if (!result.ok) {
    const details = result.errors?.map((error) => error?.message ?? String(error)).join("; ")
    return {
      report: {
        session,
        auditStatus: "INCOMPLETE",
        blockers: [details ?? "SNAPSHOT_RECONCILIATION_FAILED"],
        assetDeltas: [],
      },
      errors: result.errors ?? [
        new Error(`Snapshot reconciliation failed for ${session}`),
      ],
    }
  }

  const errors = result.data.auditStatus === "COMPLETE"
    ? []
    : [new Error(`${session} closing account snapshot is marked INCOMPLETE`)]
  return {
    report: {
      session,
      ...result.data,
      ...recoverySummary,
    },
    errors,
  }
}

/**
 * Reconcile PREFLIGHT/CLOSING snapshot event pairs independently per JSONL
 * session. Accept legacy OPENING records for historical sessions. Missing or
 * duplicate endpoints are incomplete audits, never zeroes.
 */
export function reconcileJournalAccountSnapshotRecords({ records } = {}) {
  try {
    if (!Array.isArray(records)) {
      throw new TypeError("Journal records must be an array")
    }

    const sessions = collectSessions({ records })
    const orderedEntries = [...sessions.entries()].sort((...entries) => {
      const [[left], [right]] = entries
      return left.localeCompare(right)
    })
    const reports = []
    const errors = []

    for (const [session, pair] of orderedEntries) {
      const result = createSessionReport({
        session,
        pair,
      })
      reports.push(result.report)
      errors.push(...result.errors)
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
