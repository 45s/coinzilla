const SENSITIVE_FIELD_PATTERN = /(?:password|passphrase|secret|token|authorization|cookie|credential|(?:api|private)[_-]?key)/i

/**
 * JSON.stringify replacer that masks common credential-bearing property names.
 * It intentionally does not inspect free-form strings, messages, or stack text.
 *
 * @param {string} key Property name supplied by JSON.stringify.
 * @param {unknown} value Property value.
 * @returns {unknown} '[REDACTED]' for sensitive keys; otherwise the original value.
 */
export function redactSensitiveLogField(key, value) {
  if (typeof key === 'string' && SENSITIVE_FIELD_PATTERN.test(key)) {
    return '[REDACTED]'
  }

  return value
}
