import { randomUUID } from "node:crypto"

const MAX_MESSAGE_LENGTH = 1_000
const MAX_DETAIL_STRING_LENGTH = 500
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|secret|token|signature|authorization|password)\b\s*[:=]\s*["']?[^,\s"'&]+/gi
const HISTORY_DIAGNOSTIC_FIELDS = Object.freeze([
  "historyScope",
  "marketsAttempted",
  "marketsQueried",
  "currentMarket",
  "orderPagesChecked",
  "fillPagesChecked",
  "ordersObserved",
  "ordersPersisted",
  "fillsObserved",
  "fillsPersisted",
  "requestCount",
  "failureCount",
  "historyPagesComplete",
  "marketHistoryPagesComplete",
  "marketUniverseComplete",
  "retentionCoverageConfirmed",
  "complete",
])

function redactMessage(value, maximumLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== "string") {
    return null
  }
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .slice(0, maximumLength)
}

function mapHistoryFailure(failure) {
  if (!failure || typeof failure !== "object" || Array.isArray(failure)) {
    return null
  }
  return {
    ...(typeof failure.market === "string" ? { market: redactMessage(failure.market, 100) } : {}),
    ...(typeof failure.message === "string" ? { message: redactMessage(failure.message, MAX_DETAIL_STRING_LENGTH) } : {}),
  }
}

function mapHistoryDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return null
  }
  const safe = {}
  for (const field of HISTORY_DIAGNOSTIC_FIELDS) {
    const value = diagnostics[field]
    if (typeof value === "string") {
      safe[field] = redactMessage(value, MAX_DETAIL_STRING_LENGTH)
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[field] = value
    } else if (typeof value === "boolean") {
      safe[field] = value
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      safe[field] = value.slice(0, 100).map((item) => redactMessage(item, 100))
    }
  }
  if (Array.isArray(diagnostics.failures)) {
    safe.failures = diagnostics.failures.slice(0, 100).map(mapHistoryFailure).filter(Boolean)
  }
  return Object.keys(safe).length > 0 ? safe : null
}

/**
 * Convert a shared Logger ERROR entry into a safe, searchable relational row.
 *
 * @param {{entry: object, runtimeSessionId: string}} input
 * @returns {object}
 */
export function mapRuntimeErrorEntryToRow({ entry, runtimeSessionId } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("Runtime error entry must be an object")
  }
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.length === 0) {
    throw new TypeError("Runtime error row requires the existing runtime session ID")
  }
  const data = entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
    ? entry.data
    : {}
  const error = data.error && typeof data.error === "object" ? data.error : {}
  const details = mapHistoryDiagnostics(data.historyDiagnostics)
  const message = redactMessage(data.errorMessage ?? data.message ?? error.message) ?? "Runtime error record"
  return Object.freeze({
    id: randomUUID(),
    runtime_session_id: runtimeSessionId,
    occurred_at: String(entry.timestamp ?? new Date().toISOString()),
    severity: "error",
    error_name: redactMessage(data.errorName ?? error.name, 200),
    error_code: redactMessage(data.errorCode ?? error.code, 200),
    message,
    component: redactMessage(data.component, 200),
    operation: redactMessage(data.operation, 200),
    provider_type: redactMessage(data.providerType, 100),
    provider_instance_id: redactMessage(data.providerInstanceId, 200),
    account_id: redactMessage(data.accountId, 200),
    environment: redactMessage(data.environment, 32),
    symbol: redactMessage(data.symbol, 100),
    strategy_id: redactMessage(data.strategyId, 200),
    broker_order_id: redactMessage(data.brokerOrderId, 200),
    client_order_id: redactMessage(data.clientOrderId, 200),
    execution_id: redactMessage(data.executionId, 200),
    failure_category: redactMessage(data.failureCategory, 100),
    failure_stage: redactMessage(data.failureStage, 100),
    details_json: details ? JSON.stringify({ historyDiagnostics: details }) : null,
  })
}
