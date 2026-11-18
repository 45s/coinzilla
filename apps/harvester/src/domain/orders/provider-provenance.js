const PROVIDER_IDENTITY_FIELDS = Object.freeze([
  "providerInstanceId",
  "providerType",
  "accountId",
])

export function hasProviderIdentity({ value } = {}) {
  return PROVIDER_IDENTITY_FIELDS.every((field) =>
    typeof value?.[field] === "string" && value[field].trim())
}

export function requireProviderIdentity({ value, context = "Order" } = {}) {
  for (const field of PROVIDER_IDENTITY_FIELDS) {
    if (typeof value?.[field] !== "string" || !value[field].trim()) {
      throw new TypeError(`${context} requires immutable ${field} provenance`)
    }
  }
  return {
    providerInstanceId: value.providerInstanceId,
    providerType: value.providerType,
    accountId: value.accountId,
  }
}

export function assertProviderIdentityMatches({
  expected,
  actual,
  allowMissingActual = false,
  context = "Provider identity",
} = {}) {
  const expectedIdentity = requireProviderIdentity({ value: expected, context })
  const actualHasAny = PROVIDER_IDENTITY_FIELDS.some((field) => actual?.[field] !== undefined)
  if (!actualHasAny && allowMissingActual) {
    return true
  }
  const actualIdentity = requireProviderIdentity({ value: actual, context })
  if (!PROVIDER_IDENTITY_FIELDS.every((field) =>
    actualIdentity[field] === expectedIdentity[field])) {
    throw new TypeError(`${context} does not match the original provider instance and account`)
  }
  return true
}
