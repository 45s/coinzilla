import { createDiagnosticResult } from "./diagnostic-values.js"

function createOperatorAttemptError({ result, codeOverride }) {
  const sourceError = result.errors?.[0]
  const error = new Error("Bitunix operator order attempt did not complete successfully")
  error.name = typeof sourceError?.name === "string"
    ? sourceError.name
    : "BitunixOperatorOrderError"
  error.code = codeOverride ?? (typeof sourceError?.code === "string"
    ? sourceError.code
    : result.mutationOutcome ?? "ORDER_ATTEMPT_FAILED")
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
  let status = "failed"
  if (operatorResult.declined === true || operatorResult.skipped === true) {
    status = "skipped"
  } else if (operatorResult.ok === true && operatorResult.mutationOutcome === "CONFIRMED") {
    status = "passed"
  }
  const result = createDiagnosticResult({
    operation: "operator order attempt",
    status,
    durationMs,
    error: status === "failed" || operatorResult.skipCode
      ? createOperatorAttemptError({
        result: operatorResult,
        codeOverride: operatorResult.skipCode,
      })
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
