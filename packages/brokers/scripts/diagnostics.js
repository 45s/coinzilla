const REDACTED = "[REDACTED]"
const MAX_DEPTH = 6
const MAX_ITEMS = 50
const SENSITIVE_FIELDS = new Set([
  "apikey",
  "apisecret",
  "secret",
  "secretkey",
  "sign",
  "signature",
  "nonce",
  "token",
  "accesstoken",
  "refreshtoken",
  "uid",
  "userid",
  "accountid",
  "balance",
  "balancelocked",
  "address",
  "memo",
  "transactionhash",
  "outbizid",
  "withdrawaddress",
  "privatekey",
  "password",
  "authorization",
  "bearer",
  "sessionid",
  "touid",
])

function normalizeFieldName({ value }) {
  return value.replaceAll(/[-_]/g, "").toLowerCase()
}

function redactKnownSecrets({ value, secrets }) {
  let sanitized = value
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      sanitized = sanitized.replaceAll(secret, REDACTED)
    }
  }
  return sanitized
}

function sanitizeArray({ value, depth, secrets }) {
  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]"
  }
  return value.slice(0, MAX_ITEMS).map((item) => sanitizeValue({
    value: item,
    depth: depth + 1,
    secrets,
  }))
}

function sanitizeObject({ value, depth, secrets }) {
  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]"
  }
  const entries = Object.entries(value).slice(0, MAX_ITEMS)
  return Object.fromEntries(entries.map(([key, entryValue]) => {
    if (SENSITIVE_FIELDS.has(normalizeFieldName({ value: key }))) {
      return [key, REDACTED]
    }
    return [key, sanitizeValue({
      value: entryValue,
      depth: depth + 1,
      secrets,
    })]
  }))
}

function sanitizeValue({ value, depth, secrets }) {
  if (typeof value === "string") {
    return redactKnownSecrets({
      value: value.slice(0, 2_000),
      secrets,
    })
  }
  if (Array.isArray(value)) {
    return sanitizeArray({
      value,
      depth,
      secrets,
    })
  }
  if (value && typeof value === "object") {
    return sanitizeObject({
      value,
      depth,
      secrets,
    })
  }
  if (typeof value === "bigint") {
    return value.toString()
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value)
  }
  return value
}

function getPayloadFields({ value }) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return []
      }
      return Object.keys(entry)
    }))].sort().slice(0, MAX_ITEMS)
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().slice(0, MAX_ITEMS)
  }
  return []
}

export function sanitizeDiagnosticValue({ value, secrets = [] } = {}) {
  return sanitizeValue({
    value,
    depth: 0,
    secrets,
  })
}

export function summarizePrivatePayload(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      itemCount: value.length,
      fields: getPayloadFields({ value }),
    }
  }
  if (value && typeof value === "object") {
    return {
      type: "object",
      fields: getPayloadFields({ value }),
    }
  }
  return {
    type: value === null ? "null" : typeof value,
  }
}

export function sanitizeDiagnosticError({ error, secrets = [] } = {}) {
  const source = error instanceof Error ? error : new Error(String(error))
  const result = {
    name: source.name,
    // Free-form errors can echo private account data or credentials. Never persist them.
    message: "[error message withheld]",
  }
  for (const field of ["code", "kind", "status", "exchangeCode", "method", "path", "requestId"]) {
    if (source[field] !== undefined && source[field] !== null) {
      result[field] = sanitizeDiagnosticValue({
        value: source[field],
        secrets,
      })
    }
  }
  if (source.cause instanceof Error) {
    result.cause = {
      name: source.cause.name,
      message: "[nested error message withheld]",
    }
  }
  return result
}

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


function getDiagnosticValueType({ value }) {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return "array"
  }
  return typeof value
}

function getDiagnosticRows({ value }) {
  if (Array.isArray(value)) {
    return value
  }
  if (value !== null && typeof value === "object") {
    return [value]
  }
  return []
}

function normalizeExpectedTypes({ expected }) {
  return Array.isArray(expected) ? expected : [expected]
}

function getMissingRequiredFields({ row, requiredFields }) {
  return requiredFields.filter((field) => !Object.hasOwn(row, field)).sort()
}

function getUnexpectedFieldTypes({ row, index, expectedFieldTypes }) {
  const mismatches = []
  for (const [field, expected] of Object.entries(expectedFieldTypes)) {
    if (!Object.hasOwn(row, field)) {
      continue
    }
    const expectedTypes = normalizeExpectedTypes({ expected }).slice().sort()
    const actual = getDiagnosticValueType({ value: row[field] })
    if (!expectedTypes.includes(actual)) {
      mismatches.push({
        index,
        field,
        expected: expectedTypes,
        actual,
      })
    }
  }
  return mismatches
}

function inspectDiagnosticRow({
  row,
  index,
  requiredFields,
  expectedFieldTypes,
}) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return {
      fields: [],
      missingRequiredFields: [],
      unexpectedFieldTypes: [],
      invalidRowIndexes: [index],
    }
  }

  const missingFields = getMissingRequiredFields({
    row,
    requiredFields,
  })
  const missingRequiredFields = []
  if (missingFields.length > 0) {
    missingRequiredFields.push({
      index,
      fields: missingFields,
    })
  }
  return {
    fields: Object.keys(row),
    missingRequiredFields,
    unexpectedFieldTypes: getUnexpectedFieldTypes({
      row,
      index,
      expectedFieldTypes,
    }),
    invalidRowIndexes: [],
  }
}

/**
 * Inspect only response shape and field types. Never return field values.
 *
 * @param {{
 *   value: unknown,
 *   expectedFields?: string[],
 *   requiredFields?: string[],
 *   expectedFieldTypes?: Record<string, string|string[]>,
 *   expectedValueTypes?: string[],
 * }} input
 * @returns {{
 *   valueType: string,
 *   itemCount: number|null,
 *   observedFields: string[],
 *   unexpectedFields: string[],
 *   missingRequiredFields: Array<{index: number, fields: string[]}>,
 *   unexpectedFieldTypes: Array<{index: number, field: string, expected: string[], actual: string}>,
 *   invalidRowIndexes: number[],
 * }}
 */
export function inspectDiagnosticSchema({
  value,
  expectedFields = [],
  requiredFields = [],
  expectedFieldTypes = {},
  expectedValueTypes = [],
} = {}) {
  const rows = getDiagnosticRows({ value })
  const observedFields = new Set()
  const missingRequiredFields = []
  const unexpectedFieldTypes = []
  const invalidRowIndexes = []

  for (const [index, row] of rows.entries()) {
    const inspected = inspectDiagnosticRow({
      row,
      index,
      requiredFields,
      expectedFieldTypes,
    })
    for (const field of inspected.fields) {
      observedFields.add(field)
    }
    missingRequiredFields.push(...inspected.missingRequiredFields)
    unexpectedFieldTypes.push(...inspected.unexpectedFieldTypes)
    invalidRowIndexes.push(...inspected.invalidRowIndexes)
  }

  const sortedObservedFields = [...observedFields].sort()
  const allowedFields = new Set(expectedFields)
  const unexpectedFields = sortedObservedFields.filter((field) => !allowedFields.has(field))

  const inspection = {
    valueType: getDiagnosticValueType({ value }),
    itemCount: Array.isArray(value) ? value.length : null,
    observedFields: sortedObservedFields,
    unexpectedFields,
    missingRequiredFields,
    unexpectedFieldTypes,
    invalidRowIndexes,
  }
  if (expectedValueTypes.length > 0) {
    const expected = expectedValueTypes.slice().sort()
    if (!expected.includes(inspection.valueType)) {
      inspection.unexpectedValueType = {
        expected,
        actual: inspection.valueType,
      }
    }
  }
  return inspection
}
