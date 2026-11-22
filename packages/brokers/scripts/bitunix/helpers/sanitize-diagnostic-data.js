const REDACTED = "[REDACTED]"
const MAX_DEPTH = 6
const MAX_ITEMS = 50
const SENSITIVE_FIELDS = Object.freeze([
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
  "amount",
  "fee",
  "address",
  "fromaddress",
  "toaddress",
  "withdrawaddress",
  "walletaddress",
  "wallet",
  "memo",
  "transactionhash",
  "txid",
  "withdrawalid",
  "depositid",
  "outbizid",
  "withdrawaddress",
  "privatekey",
  "password",
  "authorization",
  "bearer",
  "sessionid",
  "touid",
  "tophonenum",
  "tophone",
  "toemail",
  "email",
  "phone",
  "remark",
  "message",
  "msg",
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
    if (SENSITIVE_FIELDS.includes(normalizeFieldName({ value: key }))) {
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
  for (const field of ["code", "context", "kind", "status", "exchangeCode", "method", "path", "requestId"]) {
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
