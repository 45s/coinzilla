import { assertDecimalString } from "@coinzilla/utils"

function requireNonEmptyString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Spot withdrawal ${field} must be a non-empty string`)
  }
  return value
}

function normalizeIdentifier({ value, field }) {
  if (typeof value === "string" && value.trim()) {
    return value
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  throw new TypeError(`Bitunix Spot withdrawal ${field} must be a non-empty string or safe integer`)
}

function validateWithdrawalTimestamp({ value }) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return value
  }
  throw new TypeError("Bitunix Spot withdrawal ctime must be a non-negative integer timestamp")
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

function readOptionalIdentifier({ record, field }) {
  if (!Object.hasOwn(record, field)) {
    return undefined
  }
  if (record[field] === null) {
    return null
  }
  return normalizeIdentifier({
    value: record[field],
    field,
  })
}

function readOptionalDecimal({ record, field }) {
  if (!Object.hasOwn(record, field)) {
    return undefined
  }
  if (record[field] === null) {
    return null
  }
  assertDecimalString({
    value: record[field],
    field: `Bitunix Spot withdrawal ${field}`,
  })
  return record[field]
}

function readDestinationAddress({ record }) {
  const address = readOptionalString({
    record,
    field: "address",
  })
  const toAddress = readOptionalString({
    record,
    field: "toAddress",
  })
  if (address !== undefined && toAddress !== undefined && address !== toAddress) {
    throw new TypeError("Bitunix Spot withdrawal address fields disagree")
  }
  const resolvedAddress = toAddress === undefined ? address : toAddress
  return {
    ...(address === undefined ? {} : { address }),
    ...(resolvedAddress === undefined ? {} : { toAddress: resolvedAddress }),
  }
}

function adaptWithdrawalRecord({ record }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Bitunix Spot withdrawal row must be an object")
  }
  const id = normalizeIdentifier({
    value: record.id,
    field: "id",
  })
  const type = requireNonEmptyString({
    value: record.type,
    field: "type",
  })
  const coin = requireNonEmptyString({
    value: record.coin,
    field: "coin",
  })
  const amount = record.amount
  assertDecimalString({
    value: amount,
    field: "Bitunix Spot withdrawal amount",
  })
  const status = requireNonEmptyString({
    value: record.status,
    field: "status",
  })
  const ctime = validateWithdrawalTimestamp({
    value: record.ctime,
  })
  const outBizId = readOptionalString({
    record,
    field: "outBizId",
  })
  const network = readOptionalString({
    record,
    field: "network",
  })
  const transactionHash = readOptionalString({
    record,
    field: "transactionHash",
  })
  const feeCoin = readOptionalString({
    record,
    field: "feeCoin",
  })
  const fee = readOptionalDecimal({
    record,
    field: "fee",
  })
  const memo = readOptionalString({
    record,
    field: "memo",
  })
  const toType = readOptionalString({
    record,
    field: "toType",
  })
  const toUid = readOptionalIdentifier({
    record,
    field: "toUid",
  })
  const toPhoneCountryCode = readOptionalString({
    record,
    field: "toPhoneCountryCode",
  })
  const toPhoneNumber = readOptionalString({
    record,
    field: "toPhoneNumber",
  })
  const toEmail = readOptionalString({
    record,
    field: "toEmail",
  })
  const remark = readOptionalString({
    record,
    field: "remark",
  })
  const destination = readDestinationAddress({ record })

  return Object.freeze({
    id,
    ...(outBizId === undefined ? {} : { outBizId }),
    type,
    coin,
    amount,
    status,
    ctime,
    ...(network === undefined ? {} : { network }),
    ...destination,
    ...(transactionHash === undefined ? {} : { transactionHash }),
    ...(feeCoin === undefined ? {} : { feeCoin }),
    ...(fee === undefined ? {} : { fee }),
    ...(memo === undefined ? {} : { memo }),
    ...(toType === undefined ? {} : { toType }),
    ...(toUid === undefined ? {} : { toUid }),
    ...(toPhoneCountryCode === undefined ? {} : { toPhoneCountryCode }),
    ...(toPhoneNumber === undefined ? {} : { toPhoneNumber }),
    ...(toEmail === undefined ? {} : { toEmail }),
    ...(remark === undefined ? {} : { remark }),
  })
}

/**
 * Validate and preserve one documented Bitunix Spot withdrawal-history response page.
 *
 * @param {{value: unknown}} input
 * @returns {ReadonlyArray<{id: string, outBizId?: string|null, type: string, coin: string, amount: string, status: string, ctime: number|string, network?: string|null, address?: string|null, toAddress?: string|null, transactionHash?: string|null, feeCoin?: string|null, fee?: string|null, memo?: string|null, toType?: string|null, toUid?: string|null, toPhoneCountryCode?: string|null, toPhoneNumber?: string|null, toEmail?: string|null, remark?: string|null}>}
 */
export function adaptWithdrawalHistory({ value }) {
  let records
  if (Array.isArray(value)) {
    records = value
  } else if (value !== null && typeof value === "object") {
    records = [value]
  } else {
    throw new TypeError("Bitunix Spot withdrawal response must be an object or array")
  }
  return Object.freeze(records.map((record) => adaptWithdrawalRecord({ record })))
}
