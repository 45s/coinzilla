import {
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue,
  summarizePrivatePayload,
} from "./sanitize-diagnostic-data.js"

function summarizeResponse({ response, privateResponse, includePublicPayload, secrets }) {
  if (privateResponse) {
    return summarizePrivatePayload(response)
  }
  if (includePublicPayload) {
    return sanitizeDiagnosticValue({
      value: response,
      secrets,
    })
  }
  return summarizePrivatePayload(response)
}

export function createDiagnosticResult({
  operation,
  status,
  durationMs,
  request = null,
  response = null,
  error = null,
  privateResponse = false,
  includePublicPayload = false,
  secrets = [],
}) {
  const result = {
    operation,
    status,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null,
  }
  if (request !== null) {
    result.request = sanitizeDiagnosticValue({
      value: request,
      secrets,
    })
  }
  if (response !== null) {
    result.response = summarizeResponse({
      response,
      privateResponse,
      includePublicPayload,
      secrets,
    })
  }
  if (error !== null) {
    result.error = sanitizeDiagnosticError({
      error,
      secrets,
    })
  }
  return result
}

export function createDiagnosticReport({ startedAt, finishedAt, runtime, results, events = [], schemaObservations = [] }) {
  const counts = {}
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1
  }
  return {
    schemaVersion: 1,
    startedAt,
    finishedAt,
    runtime,
    summary: {
      total: results.length,
      passed: counts.passed ?? 0,
      failed: counts.failed ?? 0,
      skipped: counts.skipped ?? 0,
    },
    results,
    events,
    schemaObservations,
  }
}
