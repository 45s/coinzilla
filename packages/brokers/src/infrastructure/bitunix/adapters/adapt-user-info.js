const MAX_BITUNIX_UID = 9223372036854775807n

function normalizeUid({ value }) {
  if (value === null) {
    return null
  }

  let uid
  if (typeof value === "string" && /^\d+$/.test(value)) {
    uid = value
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    uid = String(value)
  } else {
    throw new TypeError("Bitunix Spot user UID must be a non-negative int64 identifier or null")
  }

  if (BigInt(uid) > MAX_BITUNIX_UID) {
    throw new RangeError("Bitunix Spot user UID exceeds the signed int64 range")
  }
  return uid
}

/**
 * Validate Bitunix Spot REST user information and preserve int64 identity.
 * The optional response data and UID remain explicitly absent/null when supplied that way.
 *
 * @param {{value: unknown}} input
 * @returns {Readonly<Record<string, unknown>>|null}
 */
export function adaptUserInfo({ value }) {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Bitunix Spot user-info response must be an object or null")
  }
  if (!Object.hasOwn(value, "uid")) {
    return Object.freeze({ ...value })
  }
  return Object.freeze({
    ...value,
    uid: normalizeUid({
      value: value.uid,
    }),
  })
}
