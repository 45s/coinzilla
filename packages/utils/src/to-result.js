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
