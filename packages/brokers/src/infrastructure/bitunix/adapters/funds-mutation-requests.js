import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

const MAX_SAFE_UID = Number.MAX_SAFE_INTEGER
const RECIPIENT_FIELDS = Object.freeze([
  "toUid",
  "toPhoneCountryCode",
  "toPhoneNumber",
  "toEmail",
])

function requireNonEmptyString({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(\`Bitunix Spot \${field} must be a non-empty string\`)
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
    throw new TypeError(\`Bitunix Spot \${field} must be a string when supplied\`)
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new RangeError(\`Bitunix Spot \${field} must not exceed \${maxLength} characters\`)
  }
  return value
}

function requireUid({ value }) {
  let uid
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    uid = value
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      uid = parsed
    }
  }
  if (uid === undefined) {
    throw new RangeError("Bitunix Spot toUid must be a positive safe integer; use phone/email routing for larger int64 UIDs")
  }
  return uid
}

function rejectUnusedRecipientFields({ input, allowed }) {
  for (const field of RECIPIENT_FIELDS) {
    if (!allowed.includes(field) && input[field] !== undefined && input[field] !== null) {
      throw new TypeError(\`Bitunix Spot \${field} is not valid for the selected toType\`)
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

/**
 * Build the exact request body for Bitunix Spot internal user-to-user transfer.
 * UID routing accepts only safely representable numeric IDs; phone/email routes support larger identity spaces.
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
    toType: input.toType,
  }

  if (input.toType === "uid") {
    rejectUnusedRecipientFields({
      input,
      allowed: ["toUid"],
    })
    body.toUid = requireUid({
      value: input.toUid,
    })
  } else if (input.toType === "phone") {
    rejectUnusedRecipientFields({
      input,
      allowed: ["toPhoneCountryCode", "toPhoneNumber"],
    })
    body.toPhoneCountryCode = requireNonEmptyString({
      value: input.toPhoneCountryCode,
      field: "toPhoneCountryCode",
    })
    body.toPhoneNumber = requireNonEmptyString({
      value: input.toPhoneNumber,
      field: "toPhoneNumber",
    })
  } else if (input.toType === "email") {
    rejectUnusedRecipientFields({
      input,
      allowed: ["toEmail"],
    })
    body.toEmail = requireNonEmptyString({
      value: input.toEmail,
      field: "toEmail",
    })
  } else {
    throw new TypeError('Bitunix Spot internal transfer toType must be "uid", "phone", or "email"')
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
