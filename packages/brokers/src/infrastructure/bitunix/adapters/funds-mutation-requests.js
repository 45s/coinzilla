import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { createBitunixInt64JsonNumber } from "../api/json-serializer.js"
const RECIPIENT_FIELDS = Object.freeze([
  "toUid",
  "toPhoneCountryCode",
  "toPhoneNumber",
  "toEmail",
])

function requireNonEmptyString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Spot ${field} must be a non-empty string`)
  }
  return value
}

function requirePositiveAmount({ value }) {
  assertDecimalString({
    value,
    field: "amount",
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError("Bitunix Spot funds mutation amount must be greater than zero")
  }
  return value
}

function requireOptionalString({ value, field, maxLength }) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== "string") {
    throw new TypeError(`Bitunix Spot ${field} must be a string when supplied`)
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new RangeError(`Bitunix Spot ${field} must not exceed ${maxLength} characters`)
  }
  return value
}

function requireUid({ value }) {
  return createBitunixInt64JsonNumber({
    value,
  })
}

function rejectUnusedRecipientFields({ input, allowed }) {
  for (const field of RECIPIENT_FIELDS) {
    if (!allowed.includes(field) && input[field] !== undefined && input[field] !== null) {
      throw new TypeError(`Bitunix Spot ${field} is not valid for the selected toType`)
    }
  }
}

/**
 * Build the exact request body for Bitunix Spot withdrawal submission.
 * Decimal amounts remain strings; the exchange requires a pre-approved withdrawal address.
 *
 * @param {{input: object}} options
 * @returns {object}
 */
export function createWithdrawalRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot withdrawal input must be an object")
  }
  const body = {
    coin: requireNonEmptyString({
      value: input.coin,
      field: "coin",
    }),
    network: requireNonEmptyString({
      value: input.network,
      field: "network",
    }),
    address: requireNonEmptyString({
      value: input.address,
      field: "address",
    }),
    amount: requirePositiveAmount({
      value: input.amount,
    }),
  }
  const memo = requireOptionalString({
    value: input.memo,
    field: "memo",
  })
  if (memo !== undefined) {
    body.memo = memo
  }
  return body
}

/**
 * Build the exact request body for Bitunix Spot withdrawal cancellation.
 *
 * @param {{input: object}} options
 * @returns {object}
 */
export function createCancelWithdrawalRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot withdrawal cancellation input must be an object")
  }
  return {
    withdrawId: requireNonEmptyString({
      value: input.withdrawId,
      field: "withdrawId",
    }),
  }
}

function createTransferRecipient({ input }) {
  if (input.toType === "uid") {
    rejectUnusedRecipientFields({
      input,
      allowed: ["toUid"],
    })
    return {
      toType: "uid",
      toUid: requireUid({
        value: input.toUid,
      }),
    }
  }
  if (input.toType === "phone") {
    rejectUnusedRecipientFields({
      input,
      allowed: ["toPhoneCountryCode", "toPhoneNumber"],
    })
    return {
      toType: "phone",
      toPhoneCountryCode: requireNonEmptyString({
        value: input.toPhoneCountryCode,
        field: "toPhoneCountryCode",
      }),
      toPhoneNumber: requireNonEmptyString({
        value: input.toPhoneNumber,
        field: "toPhoneNumber",
      }),
    }
  }
  if (input.toType === "email") {
    rejectUnusedRecipientFields({
      input,
      allowed: ["toEmail"],
    })
    return {
      toType: "email",
      toEmail: requireNonEmptyString({
        value: input.toEmail,
        field: "toEmail",
      }),
    }
  }
  throw new TypeError('Bitunix Spot internal transfer toType must be "uid", "phone", or "email"')
}

/**
 * Build the exact request body for Bitunix Spot internal user-to-user transfer.
 * UID routing preserves positive signed int64 values as exact JSON integer tokens; phone/email routes remain available.
 *
 * @param {{input: object}} options
 * @returns {object}
 */
export function createInternalTransferRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot internal transfer input must be an object")
  }
  const body = {
    coin: requireNonEmptyString({
      value: input.coin,
      field: "coin",
    }),
    amount: requirePositiveAmount({
      value: input.amount,
    }),
    ...createTransferRecipient({ input }),
  }

  const outBizId = requireOptionalString({
    value: input.outBizId,
    field: "outBizId",
    maxLength: 32,
  })
  if (outBizId !== undefined) {
    if (!outBizId.trim()) {
      throw new TypeError("Bitunix Spot outBizId must not be empty")
    }
    body.outBizId = outBizId
  }
  const remark = requireOptionalString({
    value: input.remark,
    field: "remark",
    maxLength: 256,
  })
  if (remark !== undefined) {
    body.remark = remark
  }
  return body
}

/**
 * Build the exact request body for Bitunix Spot internal transfer cancellation.
 *
 * @param {{input: object}} options
 * @returns {object}
 */
export function createCancelInternalTransferRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot internal transfer cancellation input must be an object")
  }
  return {
    insideTransferId: requireNonEmptyString({
      value: input.insideTransferId,
      field: "insideTransferId",
    }),
  }
}

/**
 * Build the exact request body for Bitunix Spot Spot/Futures account transfer.
 *
 * @param {{input: object}} options
 * @returns {object}
 */
export function createFundsTransferRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot funds transfer input must be an object")
  }
  if (input.type !== "spot_futures" && input.type !== "futures_spot") {
    throw new TypeError('Bitunix Spot funds transfer type must be "spot_futures" or "futures_spot"')
  }
  return {
    type: input.type,
    coin: requireNonEmptyString({
      value: input.coin,
      field: "coin",
    }),
    amount: requirePositiveAmount({
      value: input.amount,
    }),
  }
}

/**
 * Normalize a successful Bitunix funds mutation ID. Some documented endpoints
 * return the ID directly while their response tables describe an ID object.
 *
 * @param {{data: unknown, field: string}} input
 * @returns {Readonly<object>}
 */
export function normalizeFundsMutationId({ data, field }) {
  const value = typeof data === "string" ? data : data?.[field]
  const id = requireNonEmptyString({
    value,
    field,
  })
  return Object.freeze({
    [field]: id,
    requestAccepted: true,
  })
}

/**
 * Validate a successful cancellation acknowledgement, whose documented data is null.
 *
 * @param {{data: unknown, field: string, id: string}} input
 * @returns {Readonly<object>}
 */
export function normalizeFundsMutationAcknowledgement({ data, field, id }) {
  if (data !== null && data !== undefined) {
    throw new TypeError("Bitunix Spot funds cancellation response data must be null")
  }
  return Object.freeze({
    [field]: id,
    requestAccepted: true,
  })
}
