import { assertDecimalString } from "@coinzilla/utils"

function requireNonEmptyString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Spot deposit ${field} must be a non-empty string`)
  }
  return value
}

function normalizeDepositId({ value }) {
  if (typeof value === "string" && value.trim()) {
    return value
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  throw new TypeError("Bitunix Spot deposit ID must be a non-empty string or safe integer")
}

function validateDepositTimestamp({ value }) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return value
  }
  throw new TypeError("Bitunix Spot deposit ctime must be a non-negative integer timestamp")
}

function readOptionalString({ record, field }) {
  if (!Object.hasOwn(record, field)) {
    return undefined
  }
  if (record[field] === null) {
    return null
  }
  return requireNonEmptyString({
    value: record[field],
    field,
  })
}

function adaptDepositRecord({ record }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Bitunix Spot deposit row must be an object")
  }

  const id = normalizeDepositId({ value: record.id })
  const coin = requireNonEmptyString({
    value: record.coin,
    field: "coin",
  })
  const type = requireNonEmptyString({
    value: record.type,
    field: "type",
  })
  const fromAddress = requireNonEmptyString({
    value: record.fromAddress,
    field: "fromAddress",
  })
  const toAddress = requireNonEmptyString({
    value: record.toAddress,
    field: "toAddress",
  })
  const status = requireNonEmptyString({
    value: record.status,
    field: "status",
  })
  assertDecimalString({
    value: record.amount,
    field: "Bitunix Spot deposit amount",
  })
  const ctime = validateDepositTimestamp({ value: record.ctime })
  const transactionHash = readOptionalString({
    record,
    field: "transactionHash",
  })
  const network = readOptionalString({
    record,
    field: "network",
  })

  return Object.freeze({
    id,
    ...(transactionHash === undefined ? {} : { transactionHash }),
    coin,
    ...(network === undefined ? {} : { network }),
    type,
    fromAddress,
    toAddress,
    amount: record.amount,
    status,
    ctime,
  })
}

/**
 * Validate and preserve one documented Bitunix Spot deposit-record response page.
 *
 * @param {{value: unknown}} input
 * @returns {ReadonlyArray<{id: string, transactionHash?: string|null, coin: string, network?: string|null, type: string, fromAddress: string, toAddress: string, amount: string, status: string, ctime: number|string}>}
 */
export function adaptDeposits({ value }) {
  let records
  if (Array.isArray(value)) {
    records = value
  } else if (value !== null && typeof value === "object") {
    records = [value]
  } else {
    throw new TypeError("Bitunix Spot deposits response must be an object or array")
  }
  return Object.freeze(records.map((record) => adaptDepositRecord({ record })))
}
