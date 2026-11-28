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
    operatorAction: "Inspect DEBUG cause chain; do not retry blindly.",
  }),
  HARVESTER_MARKET_UNVALIDATED_EXCHANGE_CONSTRAINTS: Object.freeze({
    errorCode: "HARVESTER_MARKET_UNVALIDATED_EXCHANGE_CONSTRAINTS",
    title: "Market blocked by unvalidated exchange constraints",
    subsystem: "market-readiness",
    failureStage: "MARKET_READINESS_VALIDATION",
    severity: "ERROR",
    stopBehavior: "AFFECTED_MARKET_BLOCKED",
    meaning: "The market has applicable exchange constraints without a validated domain evaluator.",
    operatorAction: "Implement evaluators before enabling market.",
  }),
  HARVESTER_PROVIDER_IDENTITY_INVALID: Object.freeze({
    errorCode: "HARVESTER_PROVIDER_IDENTITY_INVALID",
    title: "Provider identity configuration is invalid",
    subsystem: "provider-configuration",
    failureStage: "PROVIDER_IDENTITY_VALIDATION",
    severity: "ERROR",
    stopBehavior: "PROCESS_STOPS",
    meaning: "An explicit provider or trading-environment identity is missing or invalid.",
    operatorAction: "Correct provider identity configuration; do not infer environment.",
  }),
  HARVESTER_PROVIDER_REGISTRY_INVALID: Object.freeze({
    errorCode: "HARVESTER_PROVIDER_REGISTRY_INVALID",
    title: "Provider registry is invalid",
    subsystem: "provider-registry",
    failureStage: "PROVIDER_REGISTRY_COMPOSITION",
    severity: "ERROR",
    stopBehavior: "PROCESS_STOPS",
    meaning: "Configured provider instances are missing, duplicated or inconsistent.",
    operatorAction: "Correct provider-instance definitions before startup.",
  }),
  HARVESTER_PROCESS_LOCK_EXISTS: Object.freeze({
    errorCode: "HARVESTER_PROCESS_LOCK_EXISTS",
    title: "Harvester process ownership lock already exists",
    subsystem: "process-ownership",
    failureStage: "PROCESS_LOCK_ACQUISITION",
    severity: "ERROR",
    stopBehavior: "PROCESS_STOPS",
    meaning: "Another process owns the same provider/account execution scope.",
    operatorAction: "Verify the lock owner; never delete an active lock.",
  }),
  JOURNAL_DIRECTORY_LOCKED: Object.freeze({
    errorCode: "JOURNAL_DIRECTORY_LOCKED",
    title: "Journal directory is locked",
    subsystem: "journal",
    failureStage: "JOURNAL_WRITER_ACQUISITION",
    severity: "WARN",
    stopBehavior: "CONTINUE_WITHOUT_OPTIONAL_JOURNAL",
    meaning: "The optional Journal writer could not acquire exclusive directory ownership.",
    operatorAction: "Verify no active writer before removing only the stale lock.",
  }),
  HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED: Object.freeze({
    errorCode: "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED",
    title: "Account history synchronization is incomplete",
    subsystem: "history-synchronization",
    failureStage: "ACCOUNT_HISTORY_SYNCHRONIZATION",
    severity: "WARN",
    stopBehavior: "CONTINUE_DEGRADED_WITH_HISTORY_GAP",
    meaning: "One or more exchange history pages failed; affected cursors remain unadvanced.",
    operatorAction: "Resolve the recorded page failure; never advance cursors manually.",
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
