import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

const OPTIONAL_DECIMAL_FIELDS = Object.freeze([
  "withdrawMin",
  "withdrawMax",
  "depositMin",
])

function requireRecord({ value, field }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Bitunix Spot token-network ${field} must be an object`)
  }
  return value
}

function validateOptionalDecimals({ record, scope }) {
  for (const field of OPTIONAL_DECIMAL_FIELDS) {
    if (!Object.hasOwn(record, field) || record[field] === null) {
      continue
    }
    assertDecimalString({
      value: record[field],
      field: `Bitunix Spot ${scope} ${field}`,
    })
    if (compareDecimal({
      left: record[field],
      right: "0",
    }) < 0) {
      throw new RangeError(`Bitunix Spot ${scope} ${field} must be non-negative`)
    }
  }
}

function adaptNetwork({ value }) {
  const network = requireRecord({
    value,
    field: "network row",
  })
  validateOptionalDecimals({
    record: network,
    scope: "network",
  })
  return Object.freeze({ ...network })
}

function adaptToken({ value }) {
  const token = requireRecord({
    value,
    field: "token row",
  })
  if (typeof token.name !== "string" || !token.name.trim()) {
    throw new TypeError("Bitunix Spot token-network token name must be a non-empty string")
  }
  validateOptionalDecimals({
    record: token,
    scope: "token",
  })

  if (!Object.hasOwn(token, "networks")) {
    return Object.freeze({ ...token })
  }
  if (token.networks === null) {
    return Object.freeze({ ...token })
  }
  if (!Array.isArray(token.networks)) {
    throw new TypeError("Bitunix Spot token networks must be an array or null")
  }

  return Object.freeze({
    ...token,
    networks: Object.freeze(token.networks.map((network) => adaptNetwork({
      value: network,
    }))),
  })
}

/**
 * Validate and preserve the public Bitunix Spot token/network metadata catalog.
 * Source fields and decimal strings remain unchanged; optional/null fields are not invented.
 *
 * @param {{value: unknown}} input
 * @returns {ReadonlyArray<Record<string, unknown>>}
 */
export function adaptTokenNetworks({ value }) {
  if (!Array.isArray(value)) {
    throw new TypeError("Bitunix Spot token-network response must be an array")
  }
  return Object.freeze(value.map((token) => adaptToken({
    value: token,
  })))
}
