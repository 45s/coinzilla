import { toResult } from "@coinzilla/utils"

const TRADING_EVENT_NAMES = new Set([
  "harvester.started",
  "order.submission_requested",
  "order.submitted",
  "order.submission_failed",
  "order.cancel_requested",
  "order.cancelled",
  "order.cancel_failed",
  "execution.fill_applied",
  "recovery.cycle_completed",
  "account.snapshot_captured",
  "account.open_orders_captured",
])

/**
 * Summarize prior Harvester execution history without reconstructing trading state.
 * Any prior order or fill history requires full replay and canonical exchange reconciliation
 * before a trading-enabled restart can be considered safe.
 * @param {{ records: Array<object> }} input
 */
export function summarizeHarvesterJournalHistory({ records } = {}) {
  if (!Array.isArray(records)) {
    return toResult({ error: new TypeError("Harvester Journal recovery records must be an array") })
  }

  const counts = Object.fromEntries([...TRADING_EVENT_NAMES].map((name) => [name, 0]))
  for (const record of records) {
    const payload = record?.payload
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue
    if (typeof payload.name !== "string" || !TRADING_EVENT_NAMES.has(payload.name)) continue
    if (payload.name === "harvester.started" && payload.data?.tradingEnabled !== true) continue
    counts[payload.name] += 1
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  return toResult({
    hasPriorTradingHistory: total > 0,
    totalTradingEvents: total,
    counts,
  })
}
