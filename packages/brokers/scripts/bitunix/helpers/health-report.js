const REQUIRED_HEALTH_OPERATIONS = Object.freeze([
  "diagnostic safety confirmation",
  "diagnostic configuration",
])

export function withholdFreeFormErrorMessages({ value }) {
  if (Array.isArray(value)) {
    return value.map((item) => withholdFreeFormErrorMessages({ value: item }))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const sanitized = Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    withholdFreeFormErrorMessages({ value: entryValue }),
  ]))
  if (typeof sanitized.name === "string" && typeof sanitized.message === "string") {
    sanitized.message = "[error message withheld]"
  }
  return sanitized
}

export function createSanitizedHealthReport({ report }) {
  // Public reports use an allowlist, not recursive redaction. No request or
  // response payload, arbitrary error text, account identifier, or amount is
  // eligible for publication.
  return {
    schemaVersion: report.schemaVersion,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    runtime: {
      node: report.runtime?.node ?? null,
      platform: report.runtime?.platform ?? null,
    },
    summary: {
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      skipped: report.summary.skipped,
    },
    healthCheck: {
      scope: report.healthCheck.scope,
      requiredOperations: report.healthCheck.requiredOperations,
      missingRequiredOperations: report.healthCheck.missingRequiredOperations,
      nonBlockingFailedOperations: report.healthCheck.nonBlockingFailedOperations,
      healthy: report.healthCheck.healthy,
    },
    results: report.results.map((result) => ({
      operation: result.operation,
      status: result.status,
      durationMs: result.durationMs ?? null,
      ...(typeof result.probeId === "string" ? { probeId: result.probeId } : {}),
      ...(typeof result.mutationOutcome === "string" ? { mutationOutcome: result.mutationOutcome } : {}),
      ...(result.error ? {
        error: Object.fromEntries(
          ["name", "code", "kind", "status", "exchangeCode"]
            .filter((field) => result.error[field] !== undefined && result.error[field] !== null)
            .map((field) => [field, result.error[field]]),
        ),
      } : {}),
    })),
  }
}

export function evaluateReadOnlyHealthCheck({ report }) {
  const passedOperations = new Set(
    report.results
      .filter((result) => result.status === "passed")
      .map((result) => result.operation),
  )
  const missingRequiredOperations = REQUIRED_HEALTH_OPERATIONS.filter((operation) =>
    !passedOperations.has(operation))
  const nonBlockingFailedOperations = report.results
    .filter((result) => result.status === "failed" &&
      !REQUIRED_HEALTH_OPERATIONS.includes(result.operation) &&
      result.operation !== "operator order attempt" &&
      result.operation !== "operator order probe")
    .map((result) => result.operation)
  return {
    scope: "operator-order-preflight",
    requiredOperations: REQUIRED_HEALTH_OPERATIONS,
    missingRequiredOperations,
    nonBlockingFailedOperations,
    healthy: missingRequiredOperations.length === 0,
  }
}

/**
 * Evaluate the dedicated preflight and dispatch outcome for a single LIVE probe.
 * A deterministic exchange rejection is a successful observation; an unknown
 * or not-sent outcome is not.
 *
 * @param {{report: object}} input
 * @returns {object} Operator-probe health gate.
 */
export function evaluateOperatorOrderProbeHealthCheck({ report }) {
  const probeResult = report.results.find((result) =>
    result.operation === "operator order probe")
  const completed = probeResult?.mutationOutcome === "REJECTED" ||
    probeResult?.mutationOutcome === "CONFIRMED"
  const declined = probeResult?.mutationOutcome === "NOT_SENT" &&
    probeResult.status === "skipped"
  const healthy = completed || declined
  return {
    scope: "operator-order-probe",
    requiredOperations: ["operator order probe"],
    missingRequiredOperations: healthy ? [] : ["operator order probe"],
    nonBlockingFailedOperations: [],
    healthy,
  }
}
