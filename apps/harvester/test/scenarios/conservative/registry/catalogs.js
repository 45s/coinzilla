export const CONSERVATIVE_SCENARIO_CATEGORIES = Object.freeze([
  "strategy-decisions",
  "buy-lifecycle",
  "sell-lifecycle",
  "recovery-lifecycle",
  "partial-fills",
  "accounting-pnl",
  "fees-commission-assets",
  "balance-inventory",
  "precision-exchange-filters",
  "market-conditions",
  "exchange-failures",
  "event-reliability",
  "persistence-restart-recovery",
  "configuration",
  "safety-risk-controls",
  "runtime-coordinator-integration",
])

export const CONSERVATIVE_SCENARIO_PRIORITIES = Object.freeze(["P0", "P1", "P2", "P3"])

export const CONSERVATIVE_SCENARIO_STATUSES = Object.freeze([
  "VERIFIED",
  "PARTIAL",
  "MISSING",
  "BLOCKED",
  "SPECIFIED",
  "TEST-MAPPED",
  "UNSUPPORTED",
])
