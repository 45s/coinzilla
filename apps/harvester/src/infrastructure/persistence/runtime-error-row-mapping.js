import { randomUUID } from "node:crypto"

const MAX_MESSAGE_LENGTH = 1_000
const MAX_DETAIL_STRING_LENGTH = 500
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|secret|token|signature|authorization|password)\b\s*[:=]\s*["']?[^,\s"'&]+/gi
const HISTORY_DIAGNOSTIC_FIELDS = Object.freeze([
  "historyScope",
  "marketsAttempted",
  "marketsQueried",
  "orderMarketsQueried",
  "fillMarketsQueried",
  "marketsFailed",
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
const ERROR_CONTEXT_FIELDS = Object.freeze([
  ["error_name", "errorName", "name", 200],
  ["error_code", "errorCode", "code", 200],
  ["component", "component", null, 200],
  ["operation", "operation", null, 200],
  ["provider_type", "providerType", null, 100],
  ["provider_instance_id", "providerInstanceId", null, 200],
  ["account_id", "accountId", null, 200],
  ["environment", "environment", null, 32],
  ["symbol", "symbol", null, 100],
  ["strategy_id", "strategyId", null, 200],
  ["broker_order_id", "brokerOrderId", null, 200],
  ["client_order_id", "clientOrderId", null, 200],
  ["execution_id", "executionId", null, 200],
  ["failure_category", "failureCategory", null, 100],
  ["failure_stage", "failureStage", null, 100],
])

function redactMessage({ value, maximumLength = MAX_MESSAGE_LENGTH } = {}) {
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
  const safe = {}
  const stringFields = [
    ["market", 100],
    ["historyType", 100],
    ["failureStage", 100],
    ["pageCursor", 200],
    ["brokerOrderId", 200],
    ["clientOrderId", 200],
    ["tradeId", 200],
    ["lastPersistedOrderId", 200],
    ["lastPersistedTradeId", 200],
    ["errorName", 200],
    ["errorCode", 200],
  ]
  for (const [field, maximumLength] of stringFields) {
    if (typeof failure[field] === "string") {
      safe[field] = redactMessage({
        value: failure[field],
        maximumLength,
      })
    }
  }
  if (Number.isSafeInteger(failure.recordIndex) && failure.recordIndex > 0) {
    safe.recordIndex = failure.recordIndex
  }
  return Object.keys(safe).length > 0 ? safe : null
}

function mapHistoryDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return null
  }
  const safe = {}
  for (const field of HISTORY_DIAGNOSTIC_FIELDS) {
    const value = diagnostics[field]
    if (typeof value === "string") {
      safe[field] = redactMessage({
        value,
        maximumLength: MAX_DETAIL_STRING_LENGTH,
      })
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[field] = value
    } else if (typeof value === "boolean") {
      safe[field] = value
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      safe[field] = value.slice(0, 100).map((item) => redactMessage({
        value: item,
        maximumLength: 100,
      }))
    }
  }
  if (Array.isArray(diagnostics.failures)) {
    safe.failures = diagnostics.failures.slice(0, 100).map(mapHistoryFailure).filter(Boolean)
  }
  return Object.keys(safe).length > 0 ? safe : null
}

function getRecordData(entry) {
  return entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
    ? entry.data
    : {}
}

function getNestedError(data) {
  return data.error && typeof data.error === "object" ? data.error : {}
}

function mapExplicitErrorContext({ data, error } = {}) {
  return Object.fromEntries(ERROR_CONTEXT_FIELDS.map(([column, dataField, errorField, maximumLength]) => [
    column,
    redactMessage({
      value: data[dataField] ?? (errorField ? error[errorField] : undefined),
      maximumLength,
    }),
  ]))
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
  const data = getRecordData(entry)
  const error = getNestedError(data)
  const details = mapHistoryDiagnostics(data.historyDiagnostics)
  const message = redactMessage({
    value: data.errorMessage ?? data.message ?? error.message,
  }) ?? "Runtime error record"
  return Object.freeze({
    id: randomUUID(),
    runtime_session_id: runtimeSessionId,
    occurred_at: String(entry.timestamp ?? new Date().toISOString()),
    severity: "error",
    ...mapExplicitErrorContext({
      data,
      error,
    }),
    message,
    details_json: details ? JSON.stringify({ historyDiagnostics: details }) : null,
  })
}
