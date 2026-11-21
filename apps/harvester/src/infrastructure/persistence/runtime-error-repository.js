import { mapRuntimeErrorEntryToRow } from "./runtime-error-row-mapping.js"

const RUNTIME_ERROR_COLUMNS = Object.freeze([
  "id",
  "runtime_session_id",
  "occurred_at",
  "severity",
  "error_name",
  "error_code",
  "message",
  "component",
  "operation",
  "provider_type",
  "provider_instance_id",
  "account_id",
  "environment",
  "symbol",
  "strategy_id",
  "broker_order_id",
  "client_order_id",
  "execution_id",
  "failure_category",
  "failure_stage",
  "details_json",
])

/**
 * Persist searchable summaries of shared-Logger ERROR entries.
 *
 * @param {{database: object, runtimeSessionId: string}} options
 * @returns {object}
 */
export function createRuntimeErrorRepository({ database, runtimeSessionId } = {}) {
  if (typeof database?.prepare !== "function") {
    throw new TypeError("Runtime error repository requires a connected SQLite database")
  }
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.length === 0) {
    throw new TypeError("Runtime error repository requires the existing runtime session ID")
  }
  const statement = database.prepare(
    `INSERT INTO runtime_errors (${RUNTIME_ERROR_COLUMNS.join(", ")})
     VALUES (${RUNTIME_ERROR_COLUMNS.map(() => "?").join(", ")})`,
  )
  return Object.freeze({
    create({ entry } = {}) {
      const row = mapRuntimeErrorEntryToRow({
        entry,
        runtimeSessionId,
      })
      statement.run(...RUNTIME_ERROR_COLUMNS.map((column) => row[column]))
      return row
    },
  })
}
