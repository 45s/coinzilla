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

function getOperatorAttemptStatus({ operatorResult, probeMode }) {
  if (operatorResult.declined === true || operatorResult.skipped === true) {
    return "skipped"
  }
  if (operatorResult.ok === true && operatorResult.mutationOutcome === "CONFIRMED") {
    return "passed"
  }
  if (probeMode && operatorResult.mutationOutcome === "REJECTED") {
    return "passed"
  }
  return "failed"
}

function createOperatorAttemptResult({ operatorResult, durationMs, probeMode, secrets }) {
  const sourceError = operatorResult.errors?.[0]
  const hasError = Boolean(sourceError || operatorResult.skipCode)
  return createDiagnosticResult({
    operation: probeMode ? "operator order probe" : "operator order attempt",
    status: getOperatorAttemptStatus({
      operatorResult,
      probeMode,
    }),
    durationMs,
    error: hasError
      ? createOperatorAttemptError({
        result: operatorResult,
        codeOverride: operatorResult.skipCode,
      })
      : null,
    secrets,
  })
}

function createOptionalOperatorFields({ probeId, mutationOutcome }) {
  const fields = {}
  if (typeof probeId === "string" && probeId) {
    fields.probeId = probeId
  }
  if (typeof mutationOutcome === "string") {
    fields.mutationOutcome = mutationOutcome
  }
  return fields
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
  const status = getOperatorAttemptStatus({
    operatorResult,
    probeMode,
  })
  const result = createOperatorAttemptResult({
    operatorResult,
    durationMs,
    probeMode,
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
      ...createOptionalOperatorFields({
        probeId,
        mutationOutcome: operatorResult.mutationOutcome,
      }),
    }],
  }
}
