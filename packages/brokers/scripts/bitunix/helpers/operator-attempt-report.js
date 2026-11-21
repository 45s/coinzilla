import { createDiagnosticResult } from "./diagnostic-values.js"

function createOperatorAttemptError({ result }) {
  const sourceError = result.errors?.[0]
  const error = new Error("Bitunix operator order attempt did not complete successfully")
  error.name = typeof sourceError?.name === "string"
    ? sourceError.name
    : "BitunixOperatorOrderError"
  error.code = typeof sourceError?.code === "string"
    ? sourceError.code
    : result.mutationOutcome ?? "ORDER_ATTEMPT_FAILED"
  for (const field of ["kind", "status", "exchangeCode"]) {
    if (sourceError?.[field] !== undefined && sourceError[field] !== null) {
      error[field] = sourceError[field]
    }
  }
  return error
}

/**
 * Append only a sanitized operator outcome to the diagnostic report.
 * Exchange order IDs, request/response payloads and free-form messages are never copied.
 *
 * @param {{report: object, operatorResult: object, durationMs: number, secrets?: string[]}} input
 * @returns {object}
 */
export function appendOperatorAttemptResult({
  report,
  operatorResult,
  durationMs,
  secrets = [],
}) {
  const status = operatorResult.declined
    ? "skipped"
    : operatorResult.ok === true && operatorResult.mutationOutcome === "CONFIRMED"
      ? "passed"
      : "failed"
  const result = createDiagnosticResult({
    operation: "operator order attempt",
    status,
    durationMs,
    error: status === "failed"
      ? createOperatorAttemptError({ result: operatorResult })
      : null,
    secrets,
  })
  return {
    ...report,
    summary: {
      total: report.summary.total + 1,
      passed: report.summary.passed + (status === "passed" ? 1 : 0),
      failed: report.summary.failed + (status === "failed" ? 1 : 0),
      skipped: report.summary.skipped + (status === "skipped" ? 1 : 0),
    },
    results: [...report.results, result],
  }
}
