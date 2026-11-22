import { createDiagnosticResult } from "./create-diagnostic-report.js"

function createOperatorAttemptError({ result, codeOverride }) {
  const sourceError = result.errors?.[0]
  const error = new Error("Bitunix operator order attempt did not complete successfully")
  error.name = typeof sourceError?.name === "string"
    ? sourceError.name
    : "OperatorOrderError"
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
 * @param {{report: object, operatorResult: object, durationMs: number, probeId?: string, probeMode?: boolean, secrets?: string[]}} input
 * @returns {object}
 */
export function appendOrderAttemptResult({
  report,
  operatorResult,
  durationMs,
  probeId,
  probeMode = false,
  secrets = [],
}) {
  let status = "failed"
  if (operatorResult.declined === true || operatorResult.skipped === true) {
    status = "skipped"
  } else if (operatorResult.ok === true && operatorResult.mutationOutcome === "CONFIRMED") {
    status = "passed"
  } else if (probeMode && operatorResult.mutationOutcome === "REJECTED") {
    status = "passed"
  }
  const sourceError = operatorResult.errors?.[0]
  const result = createDiagnosticResult({
    operation: probeMode ? "operator order probe" : "operator order attempt",
    status,
    durationMs,
    error: sourceError || operatorResult.skipCode
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
    results: [...report.results, {
      ...result,
      ...(typeof probeId === "string" && probeId ? { probeId } : {}),
      ...(typeof operatorResult.mutationOutcome === "string"
        ? { mutationOutcome: operatorResult.mutationOutcome }
        : {}),
    }],
  }
}
