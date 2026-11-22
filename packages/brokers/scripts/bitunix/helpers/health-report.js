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
      result.operation !== "operator order attempt")
    .map((result) => result.operation)
  return {
    scope: "operator-order-preflight",
    requiredOperations: REQUIRED_HEALTH_OPERATIONS,
    missingRequiredOperations,
    nonBlockingFailedOperations,
    healthy: missingRequiredOperations.length === 0,
  }
}

