const MAX_TAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000
const TAX_FILING_RECORD_FIELDS = Object.freeze([
  "date",
  "labelEn",
  "account",
  "outgoingAsset",
  "outgoingAmount",
  "incomingAsset",
  "incomingAmount",
  "feeAsset",
  "feeAmount",
  "typeId",
  "txId",
  "fromAddress",
  "toAddress",
  "network",
  "referenceId",
  "comment",
])

function requireRecord({ value, field }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Bitunix Spot tax-filing ${field} must be an object`)
  }
  return value
}

function parseUtcTimestamp({ value, field }) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(value)) {
    throw new TypeError(`Bitunix Spot tax-filing ${field} must be a UTC ISO-8601 timestamp`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new TypeError(`Bitunix Spot tax-filing ${field} must be a valid UTC ISO-8601 timestamp`)
  }
  return timestamp
}

function addTaxDataTypeCodes({ input, body }) {
  if (!Object.hasOwn(input, "dataTypeCodes")) {
    return
  }
  if (!Array.isArray(input.dataTypeCodes) ||
      input.dataTypeCodes.some((code) => typeof code !== "string" || !code.trim())) {
    throw new TypeError("Bitunix Spot tax-filing dataTypeCodes must be an array of non-empty strings")
  }
  body.dataTypeCodes = [...input.dataTypeCodes]
}

/**
 * Validate and construct one documented Bitunix Spot tax-filing page request.
 * The exchange limits each query range to 365 days and each page to 1000 records.
 *
 * @param {{input: object}} options
 * @returns {{body: object, page: number, pageSize: number}}
 */
export function createTaxFilingQuery({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot tax-filing query must be an object")
  }

  const startTimestamp = parseUtcTimestamp({
    value: input.startTime,
    field: "startTime",
  })
  const endTimestamp = parseUtcTimestamp({
    value: input.endTime,
    field: "endTime",
  })
  if (startTimestamp > endTimestamp) {
    throw new RangeError("Bitunix Spot tax-filing startTime must not be after endTime")
  }
  if (endTimestamp - startTimestamp > MAX_TAX_RANGE_MS) {
    throw new RangeError("Bitunix Spot tax-filing time range must not exceed 365 days")
  }

  const page = input.page === undefined ? 1 : input.page
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Bitunix Spot tax-filing page must be a positive safe integer")
  }
  const pageSize = input.pageSize === undefined ? 1000 : input.pageSize
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new RangeError("Bitunix Spot tax-filing pageSize must be an integer between 1 and 1000")
  }

  const body = {
    startTime: input.startTime,
    endTime: input.endTime,
  }
  addTaxDataTypeCodes({ input, body })
  body.page = page
  body.pageSize = pageSize

  return {
    body,
    page,
    pageSize,
  }
}

function requireNonNegativeSafeInteger({ value, field }) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Bitunix Spot tax-filing ${field} must be a non-negative safe integer`)
  }
  return value
}

function adaptTaxFilingRecord({ value }) {
  const record = requireRecord({
    value,
    field: "record",
  })
  for (const field of TAX_FILING_RECORD_FIELDS) {
    if (typeof record[field] !== "string") {
      throw new TypeError(`Bitunix Spot tax-filing record ${field} must be a string`)
    }
  }
  return Object.freeze({ ...record })
}

/**
 * Validate one Bitunix Spot tax-filing page without converting financial strings.
 *
 * @param {{value: unknown, page: number, pageSize: number}} input
 * @returns {Readonly<object>}
 */
export function adaptTaxFilingPage({ value, page, pageSize }) {
  const data = requireRecord({
    value,
    field: "page",
  })
  if (!Array.isArray(data.records)) {
    throw new TypeError("Bitunix Spot tax-filing records must be an array")
  }

  const total = requireNonNegativeSafeInteger({
    value: data.total,
    field: "total",
  })
  const current = requireNonNegativeSafeInteger({
    value: data.current,
    field: "current",
  })
  const size = requireNonNegativeSafeInteger({
    value: data.size,
    field: "size",
  })
  const pages = requireNonNegativeSafeInteger({
    value: data.pages,
    field: "pages",
  })

  if (current !== page) {
    throw new TypeError("Bitunix Spot tax-filing response page does not match the requested page")
  }
  if (size > pageSize || data.records.length > size || total < data.records.length) {
    throw new TypeError("Bitunix Spot tax-filing pagination metadata is inconsistent")
  }
  if (total > 0 && pages === 0) {
    throw new TypeError("Bitunix Spot tax-filing pages must be positive when total is non-zero")
  }

  return Object.freeze({
    ...data,
    records: Object.freeze(data.records.map((record) => adaptTaxFilingRecord({
      value: record,
    }))),
    total,
    current,
    size,
    pages,
  })
}
