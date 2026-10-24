export function toResult(input = {}) {
  const { error, ...rest } = input

  return {
    ...rest,
    ok: error == null,
    ...(error != null && { error }),
  }
}
