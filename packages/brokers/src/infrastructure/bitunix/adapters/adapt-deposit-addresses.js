import { BitunixDepositAddressError } from "../errors/bitunix-deposit-address-error.js"

function invalidResponse({ message, field }) {
  return new BitunixDepositAddressError({
    message,
    field,
    kind: "response",
  })
}

function requireResponseString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidResponse({
      message: `Bitunix deposit-address response ${field} must be a non-empty string`,
      field,
    })
  }
  return value
}

function readMemo({ record }) {
  if (!Object.hasOwn(record, "memo")) {
    return undefined
  }
  if (record.memo === null) {
    return null
  }
  return requireResponseString({
    value: record.memo,
    field: "memo",
  })
}

function adaptDepositAddressRecord({ record, coin, network }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw invalidResponse({
      message: "Bitunix deposit-address response row must be an object",
      field: "record",
    })
  }
  const returnedCoin = requireResponseString({
    value: record.coin,
    field: "coin",
  })
  const returnedNetwork = requireResponseString({
    value: record.network,
    field: "network",
  })
  if (returnedCoin !== coin) {
    throw invalidResponse({
      message: "Bitunix deposit-address response coin does not match the request",
      field: "coin",
    })
  }
  if (returnedNetwork !== network) {
    throw invalidResponse({
      message: "Bitunix deposit-address response network does not match the request",
      field: "network",
    })
  }
  const address = requireResponseString({
    value: record.address,
    field: "address",
  })
  const memo = readMemo({ record })
  const result = {
    coin: returnedCoin,
    network: returnedNetwork,
    address,
  }
  if (memo !== undefined) {
    result.memo = memo
  }
  return Object.freeze(result)
}

/**
 * Validate and freeze the complete list before returning any address.
 *
 * @param {{value: unknown, coin: string, network: string}} input
 * @returns {ReadonlyArray<Readonly<{coin: string, network: string, address: string, memo?: string|null}>>}
 */
export function adaptDepositAddresses({ value, coin, network }) {
  if (!Array.isArray(value)) {
    throw invalidResponse({
      message: "Bitunix deposit-address response data must be an array",
      field: "data",
    })
  }
  const records = value.map((record) => adaptDepositAddressRecord({
    record,
    coin,
    network,
  }))
  return Object.freeze(records)
}
