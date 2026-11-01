const SENSITIVE_FIELD_PATTERN = /(?:password|passphrase|secret|token|authorization|cookie|credential|(?:api|private)[_-]?key)/i

/**
 * JSON.stringify replacer that removes common credential-bearing fields.
 * It does not inspect free-form strings; callers must not log secrets in text.
 */
export function redactSensitiveLogField(key, value) {
  if (typeof key === 'string' && SENSITIVE_FIELD_PATTERN.test(key)) {
    return '[REDACTED]'
  }

  return value
}
