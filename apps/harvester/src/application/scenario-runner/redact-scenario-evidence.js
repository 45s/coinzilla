const SECRET_KEY_PATTERN = /api.?key|access.?key|private.?key|secret|password|passphrase|token|credential|authorization|bearer|cookie|session|jwt|signature/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b((?:x-)?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|secret|password|passphrase|credential|authorization|bearer|cookie|set-cookie|session(?:[_ -]?(?:id|token))?|jwt|signature))\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const AUTH_HEADER_PATTERN = /\b(authorization)\s*:\s*(?:bearer|basic)\s+[^\r\n,;]+/gi;
const COOKIE_HEADER_PATTERN = /\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi;
const BEARER_TOKEN_PATTERN = /\b(bearer)\s+[A-Za-z0-9._~+/-]+=*/gi;
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN (?:(?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY)-----[\s\S]*?-----END (?:(?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY)-----/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function redactString(value) {
  return value
    .replace(PEM_PRIVATE_KEY_PATTERN, "[REDACTED PRIVATE KEY]")
    .replace(AUTH_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(COOKIE_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .replace(BEARER_TOKEN_PATTERN, "$1 [REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED JWT]")
}

function createRedactor() {
  const ancestors = new WeakSet()
  return function redactValue(value) {
    if (typeof value === "string") {
      return redactString(value)
    }
    if (Array.isArray(value)) {
      if (ancestors.has(value)) {
        return "[CIRCULAR]"
      }
      ancestors.add(value)
      const redacted = value.map((item) => redactValue(item))
      ancestors.delete(value)
      return redacted
    }
    if (value && typeof value === "object") {
      if (ancestors.has(value)) {
        return "[CIRCULAR]"
      }
      ancestors.add(value)
      const redacted = Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(item),
      ]))
      ancestors.delete(value)
      return redacted
    }
    return value
  }
}

export function redactScenarioEvidence(value) {
  return createRedactor()(value)
}
