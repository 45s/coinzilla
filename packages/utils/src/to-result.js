/**
 * Normalize an object containing an optional error or errors field.
 * An explicit `errors` value takes precedence over `error`; non-array values
 * become a one-element errors array. Other input properties are preserved.
 *
 * @template {Record<string, unknown>} T
 * @param {T & { error?: unknown, errors?: unknown }} [input]
 * @returns {Omit<T, 'error'|'errors'> & ({ ok: true } | { ok: false, errors: unknown[] })}
 */
export function toResult(input = {}) {
  const { error, errors: inputErrors, ...rest } = input

  const errors = inputErrors ?? (error == null ? [] : [error])

  const normalizedErrors = Array.isArray(errors) ? errors : [errors]

  return {
    ...rest,
    ok: normalizedErrors.length === 0,
    ...(normalizedErrors.length > 0 && {
      errors: normalizedErrors,
    }),
  }
}
