import { relative, resolve, sep } from "node:path"

export const REQUIRED_HEALTH_OPERATIONS = Object.freeze([
  "diagnostic safety confirmation",
  "diagnostic configuration",
  "REST private account balances",
  "WebSocket connection",
  "ping",
  "user.account",
  "user.info",
])
export function createTimestamp({ timestamp }) {
  return new Date(timestamp).toISOString().replaceAll(/[-:.]/g, "")
}

export function createReportPaths({ repositoryRoot, timestamp }) {
  const filename = `bitunix-health-${timestamp}.json`
  return {
    local: resolve(repositoryRoot, "packages/brokers/.diagnostics", filename),
    published: resolve(repositoryRoot, "packages/brokers/diagnostics/reports", filename),
  }
}

export function getRelativePath({ repositoryRoot, path }) {
  return relative(repositoryRoot, path).split(sep).join("/")
}

export function getSecrets({ env }) {
  return [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean)
}

export function validatePrivateCredentials({ env }) {
  const missing = ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"].filter((name) =>
    typeof env[name] !== "string" || !env[name].trim())
  if (missing.length > 0) {
    throw new Error(`Bitunix health check requires both read-only credentials; missing: ${missing.join(", ")}`)
  }
}

export function createGitEnvironment({ env } = {}) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) =>
      name !== "BITUNIX_API_KEY" && name !== "BITUNIX_API_SECRET"),
  )
}

export function validateDiagnosticReport({ report }) {
  if (!report || typeof report !== "object" || !Array.isArray(report.results) || !report.summary) {
    throw new TypeError("Bitunix diagnostics returned an invalid report; refusing to publish it")
  }
  if (!Number.isInteger(report.summary.failed) || report.summary.failed < 0) {
    throw new TypeError("Bitunix diagnostics report has an invalid failed-check count")
  }
}

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
  return {
    requiredOperations: REQUIRED_HEALTH_OPERATIONS,
    missingRequiredOperations,
    healthy: report.summary.failed === 0 && missingRequiredOperations.length === 0,
  }
}

export function throwWorkflowErrors({ operationError, cleanupError }) {
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "Bitunix diagnostics failed and the checkout could not be returned to develop",
    )
  }
  if (operationError) {
    throw operationError
  }
  if (cleanupError) {
    throw cleanupError
  }
}
