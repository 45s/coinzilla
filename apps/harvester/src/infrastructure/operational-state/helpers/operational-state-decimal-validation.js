export function isCanonicalDecimalString({ value }) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
}

export function isPositiveCanonicalDecimalString({ value }) {
  return isCanonicalDecimalString({ value }) && /[1-9]/.test(value)
}

export function isSignedCanonicalDecimalString({ value }) {
  return typeof value === "string" && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
}