import { redactSensitiveLogField } from './redact-sensitive-log-field.js'

const CIRCULAR_VALUE = '[Circular]'
const UNREADABLE_VALUE = '[Unreadable property]'

function readProperty({ value, key }) {
  try {
    return value[key]
  } catch {
    return UNREADABLE_VALUE
  }
}

function normalizeError({ error, seen, normalize }) {
  const name = readProperty({ value: error, key: 'name' })
  const message = readProperty({ value: error, key: 'message' })
  const stack = readProperty({ value: error, key: 'stack' })
  const normalized = {
    name: typeof name === 'string' ? name : 'Error',
    message: typeof message === 'string' ? message : String(message ?? ''),
  }

  if (typeof stack === 'string') {
    normalized.stack = stack
  }

  const cause = readProperty({ value: error, key: 'cause' })
  if (cause !== undefined) {
    normalized.cause = normalize({ value: cause, seen })
  }

  const errors = readProperty({ value: error, key: 'errors' })
  if (Array.isArray(errors)) {
    normalized.errors = normalize({ value: errors, seen })
  }

  return normalized
}

function normalizeLogValue({ value, seen = new WeakSet() }) {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return CIRCULAR_VALUE
  }

  seen.add(value)

  let isError = false
  try {
    isError = value instanceof Error
  } catch {
    return UNREADABLE_VALUE
  }

  if (isError) {
    return normalizeError({
      error: value,
      seen,
      normalize: ({ value: nestedValue, seen: nestedSeen }) =>
        normalizeLogValue({ value: nestedValue, seen: nestedSeen }),
    })
  }

  if (value instanceof Date) {
    try {
      return value.toISOString()
    } catch {
      return UNREADABLE_VALUE
    }
  }

  if (Array.isArray(value)) {
    const normalized = []
    for (let index = 0; index < value.length; index += 1) {
      let item
      try {
        item = value[index]
      } catch {
        item = UNREADABLE_VALUE
      }
      normalized.push(normalizeLogValue({ value: item, seen }))
    }
    return normalized
  }

  let keys
  try {
    keys = Object.keys(value)
  } catch {
    return UNREADABLE_VALUE
  }

  const normalized = {}
  for (const key of keys) {
    if (redactSensitiveLogField(key, undefined) === '[REDACTED]') {
      normalized[key] = '[REDACTED]'
      continue
    }

    let propertyValue
    try {
      propertyValue = value[key]
    } catch {
      normalized[key] = UNREADABLE_VALUE
      continue
    }

    normalized[key] = normalizeLogValue({ value: propertyValue, seen })
  }

  return normalized
}

/**
 * Convert log data to a printable value without allowing hostile objects to
 * make the logging path throw. Native errors are normalized to JSON-compatible
 * objects before serialization so their non-enumerable diagnostics survive.
 */
export function formatLogContent(data) {
  if (['string', 'number', 'boolean'].some((type) => typeof data === type)) {
    return data
  }

  if (data === undefined || typeof data === 'symbol' || typeof data === 'function') {
    return undefined
  }

  try {
    const normalized = normalizeLogValue({ value: data })
    return JSON.stringify(normalized, redactSensitiveLogField, 2)
  } catch {
    try {
      return String(data)
    } catch {
      return '[Unserializable log data]'
    }
  }
}
