import { assertDecimalString } from "@coinzilla/utils"

function requireNonEmptyString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Spot matching-order ${field} must be a non-empty string`)
  }
  return value
}

function requireIso8601String({ value }) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError("Bitunix Spot matching-order ctime must be a timezone-qualified ISO-8601 string")
  }
  return value
}

function adaptMatchingOrder({ record }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Bitunix Spot matching-order data must be an object")
  }
  const id = requireNonEmptyString({
    value: record.id,
    field: "id",
  })
  const { volume } = record
  assertDecimalString({
    value: volume,
    field: "Bitunix Spot matching-order volume",
  })
  const { price } = record
  assertDecimalString({
    value: price,
    field: "Bitunix Spot matching-order price",
  })
  const { fee } = record
  assertDecimalString({
    value: fee,
    field: "Bitunix Spot matching-order fee",
  })
  const feeCoin = requireNonEmptyString({
    value: record.feeCoin,
    field: "feeCoin",
  })
  const role = requireNonEmptyString({
    value: record.role,
    field: "role",
  })
  const ctime = requireIso8601String({
    value: record.ctime,
  })
  return Object.freeze({
    volume,
    price,
    fee,
    feeCoin,
    role,
    ctime,
    id,
  })
}

/**
 * Preserve the exchange-native matching-order detail without interpreting
 * volume units or treating its ID as a canonical execution identifier.
 *
 * @param {{value: unknown}} input
 * @returns {Readonly<{volume: string, price: string, fee: string, feeCoin: string, role: string, ctime: string, id: string}>|null}
 */
export function adaptMatchingOrderDetails({ value }) {
  if (value === null) {
    return null
  }
  return adaptMatchingOrder({ record: value })
}
