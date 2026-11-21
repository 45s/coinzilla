const REQUIRED_HEALTH_OPERATIONS = Object.freeze([
  "diagnostic safety confirmation",
  "diagnostic configuration",
  "REST private account balances",
  "WebSocket connection",
  "ping",
  "user.account",
  "user.info",
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

export function createPublishedReport({ report }) {
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
      requiredOperations: report.healthCheck.requiredOperations,
      missingRequiredOperations: report.healthCheck.missingRequiredOperations,
      healthy: report.healthCheck.healthy,
    },
    results: report.results.map((result) => ({
      operation: result.operation,
      status: result.status,
      durationMs: result.durationMs ?? null,
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

export function evaluateHealthCheck({ report }) {
  const passedOperations = new Set(
    report.results
      .filter((result) => result.status === "passed")
      .map((result) => result.operation),
  )
  const missingRequiredOperations = REQUIRED_HEALTH_OPERATIONS.filter((operation) =>
    !passedOperations.has(operation))
  const failedDiagnosticOperations = report.results.filter((result) =>
    result.operation !== "operator order attempt" && result.status === "failed")
  return {
    requiredOperations: REQUIRED_HEALTH_OPERATIONS,
    missingRequiredOperations,
    healthy: failedDiagnosticOperations.length === 0 && missingRequiredOperations.length === 0,
  }
}

