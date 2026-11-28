/**
 * Operator-facing Harvester error catalog.
 *
 * Keep codes stable: they are log/search contracts and are referenced by tests
 * and runbooks. Runtime messages/cause chains provide the concrete occurrence.
 */
export const HARVESTER_ERROR_CATALOG = Object.freeze({
  HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED: Object.freeze({
    errorCode: "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    title: "Relational order history unavailable",
    subsystem: "persistence",
    failureStage: "RELATIONAL_PERSISTENCE_PREPARATION",
    severity: "WARN",
    stopBehavior: "TRADING_CONTINUES_WITH_LEGACY_HISTORY",
    meaning: "The optional relational trading-history projection could not be prepared.",
    operatorAction: "Full cause: session DEBUG; do not reset DB.",
  }),
  HARVESTER_STARTUP_FAILED: Object.freeze({
    errorCode: "HARVESTER_STARTUP_FAILED",
    title: "Harvester startup failed",
    subsystem: "process",
    failureStage: "PROCESS_STARTUP",
    severity: "ERROR",
    stopBehavior: "PROCESS_STOPS",
    meaning: "A required startup operation failed; the originating error remains the primary cause.",
    operatorAction: "See session DEBUG for the full cause chain.",
  }),
})

/**
 * Resolve stable operator guidance without replacing the concrete failure.
 *
 * @param {{ errorCode?: string, stage?: string, errorMessage?: string }} input
 */
export function resolveHarvesterErrorDiagnostic({
  errorCode,
  stage,
  errorMessage,
} = {}) {
  const entry = HARVESTER_ERROR_CATALOG[errorCode]
  if (!entry) {
    return null
  }
  return Object.freeze({
    ...entry,
    diagnosticId: entry.errorCode,
    stage: stage ?? entry.failureStage,
    cause: typeof errorMessage === "string" && errorMessage.length > 0
      ? errorMessage
      : entry.meaning,
  })
}
