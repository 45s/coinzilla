const HISTORY_STATUS_CODES = Object.freeze({
  OPEN: "1",
  FILLED: "2",
  PARTIALLY_FILLED: "3",
  CANCELED: "4",
  PARTIALLY_FILLED_CANCELED: "7",
})
const HISTORY_SIDE_CODES = Object.freeze({
  SELL: "1",
  BUY: "2",
})
const HISTORY_TYPE_CODES = Object.freeze({
  LIMIT: "1",
  MARKET: "2",
})

function validateHistoryTimeRange({ startTime, endTime }) {
  for (const [field, value] of [["startTime", startTime], ["endTime", endTime]]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`Bitunix Spot ${field} must be a non-negative safe integer`)
    }
  }
  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    throw new RangeError("Bitunix Spot startTime must not be after endTime")
  }
}

function applyHistoryFilters({ body, status, side, type }) {
  for (const [field, value, codes] of [
    ["status", status, HISTORY_STATUS_CODES],
    ["side", side, HISTORY_SIDE_CODES],
    ["type", type, HISTORY_TYPE_CODES],
  ]) {
    if (value === undefined) {
      continue
    }
    if (typeof value !== "string" || !Object.hasOwn(codes, value)) {
      throw new TypeError(`Bitunix Spot order history ${field} filter is unsupported`)
    }
    body[field] = codes[value]
  }
}

function addDepositStringFilters({ input, body }) {
  for (const field of ["id", "coin", "transactionHash"]) {
    if (input[field] === undefined) {
      continue
    }
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new TypeError(`Bitunix Spot deposit ${field} filter must be a non-empty string`)
    }
    body[field] = input[field]
  }
}

function addDepositTypeFilter({ input, body }) {
  if (input.transactionHash !== undefined && input.type !== "deposit") {
    throw new TypeError("Bitunix Spot transactionHash filter requires type=deposit")
  }
  if (input.type === undefined) {
    return
  }
  if (input.type !== "deposit" && input.type !== "inside_transfer_in") {
    throw new TypeError("Bitunix Spot deposit type filter is unsupported")
  }
  body.type = input.type
}

function addTimeFilters({ input, body }) {
  validateHistoryTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
  })
  if (input.startTime !== undefined) {
    body.startTime = input.startTime
  }
  if (input.endTime !== undefined) {
    body.endTime = input.endTime
  }
}

function addDepositLimitFilter({ input, body }) {
  if (input.limit === undefined) {
    return
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("Bitunix Spot deposit limit must be an integer between 1 and 100")
  }
  body.limit = input.limit
}

function addWithdrawalStringFilters({ input, body }) {
  for (const field of ["id", "outBizId", "coin", "transactionHash", "remark"]) {
    if (input[field] === undefined) {
      continue
    }
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new TypeError(`Bitunix Spot withdrawal ${field} filter must be a non-empty string`)
    }
    body[field] = input[field]
  }
}

function addWithdrawalTypeFilter({ input, body }) {
  if (input.transactionHash !== undefined && input.type !== "withdraw") {
    throw new TypeError("Bitunix Spot withdrawal transactionHash filter requires type=withdraw")
  }
  if (input.type === undefined) {
    return
  }
  if (input.type !== "withdraw" && input.type !== "inside_transfer_out") {
    throw new TypeError("Bitunix Spot withdrawal type filter is unsupported")
  }
  body.type = input.type
}

function addWithdrawalLimitFilter({ input, body }) {
  if (input.limit === undefined) {
    return
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("Bitunix Spot withdrawal limit must be an integer between 1 and 100")
  }
  body.limit = input.limit
}

/**
 * Build the exchange request body for a filtered Bitunix Spot deposit-history page.
 *
 * @param {{ input: object }} options
 * @returns {{ body: object }}
 */
export function createDepositRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot getDeposits() input must be an object")
  }
  const body = {}
  addDepositStringFilters({
    input,
    body,
  })
  addDepositTypeFilter({
    input,
    body,
  })
  addTimeFilters({
    input,
    body,
  })
  addDepositLimitFilter({
    input,
    body,
  })
  return { body }
}

/**
 * Build the exchange request body for a filtered Bitunix Spot withdrawal-history page.
 *
 * @param {{ input: object }} options
 * @returns {{ body: object }}
 */
export function createWithdrawalHistoryRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot getWithdrawalHistory() input must be an object")
  }
  const body = {}
  addWithdrawalStringFilters({
    input,
    body,
  })
  addWithdrawalTypeFilter({
    input,
    body,
  })
  addTimeFilters({
    input,
    body,
  })
  addWithdrawalLimitFilter({
    input,
    body,
  })
  return { body }
}

function normalizeReturnedHistoryPage({ pageNum, requestedPage }) {
  // The live REST history endpoint can omit this redundant response echo.
  // Page 1 remains unambiguous; later pages still require an explicit match.
  if (pageNum === undefined && requestedPage === 1) {
    return
  }
  const normalizedPageNum = typeof pageNum === "string" ? pageNum.trim() : pageNum
  const pageNumIsNumber = typeof normalizedPageNum === "number" && Number.isSafeInteger(normalizedPageNum)
  const pageNumIsString = typeof normalizedPageNum === "string" &&
    /^[0-9]+(?:\.0+)?$/.test(normalizedPageNum)
  if (!pageNumIsNumber && !pageNumIsString) {
    throw new TypeError("Bitunix Spot order history pageNum must be a positive integer string or number")
  }

  const returnedPage = Number(normalizedPageNum)
  if (!Number.isSafeInteger(returnedPage) || returnedPage < 1) {
    throw new TypeError("Bitunix Spot order history pageNum must be a positive integer string or number")
  }
  if (returnedPage !== requestedPage) {
    throw new TypeError("Bitunix Spot order history returned pageNum does not match the requested page")
  }
}

function normalizeHistoryRows({ data, total }) {
  if (data === undefined && total !== 0) {
    throw new TypeError("Bitunix Spot order history data is required when total is positive")
  }
  const rows = data === undefined ? [] : data
  if (!Array.isArray(rows)) {
    throw new TypeError("Bitunix Spot order history response must be an array")
  }
  if (rows.length > total) {
    throw new TypeError("Bitunix Spot order history data row count exceeds total")
  }
  return rows
}

/**
 * Validate and normalize the documented one-page Bitunix Spot order-history envelope.
 *
 * @param {{ value: object, requestedPage: number }} options
 * @returns {Array<object>}
 */
export function normalizeOrderHistoryPage({ value, requestedPage }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Bitunix Spot order history response must be an object")
  }
  if (!Number.isSafeInteger(value.total) || value.total < 0) {
    throw new TypeError("Bitunix Spot order history total must be a non-negative safe integer")
  }
  normalizeReturnedHistoryPage({
    pageNum: value.pageNum,
    requestedPage,
  })
  return normalizeHistoryRows({
    data: value.data,
    total: value.total,
  })
}

/**
 * Build a symbol-scoped, single-page Bitunix Spot order-history request.
 *
 * @param {{ input: object, requireSymbol: (options: { symbol: string, operation: string }) => string }} options
 * @returns {{ body: object }}
 */
export function createHistoryRequest({ input, requireSymbol }) {
  const {
    symbol,
    orderId,
    startTime,
    endTime,
    limit,
    page = 1,
    status,
    side,
    type,
  } = input
  const normalizedSymbol = requireSymbol({
    symbol,
    operation: "getOrderHistory()",
  })
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Bitunix Spot order history page must be a positive safe integer")
  }
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError("Bitunix Spot order history limit must be a positive safe integer")
  }
  if (orderId !== undefined && orderId !== null) {
    throw new TypeError("Bitunix Spot order history does not support exact orderId filtering")
  }
  validateHistoryTimeRange({
    startTime,
    endTime,
  })

  const body = {
    symbol: normalizedSymbol,
    page,
  }
  if (limit !== undefined) {
    body.pageSize = limit
  }
  if (startTime !== undefined) {
    body.startTime = new Date(startTime).toISOString()
  }
  if (endTime !== undefined) {
    body.endTime = new Date(endTime).toISOString()
  }
  applyHistoryFilters({
    body,
    status,
    side,
    type,
  })
  return { body }
}
