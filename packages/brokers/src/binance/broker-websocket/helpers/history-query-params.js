const MAX_PAGE_SIZE = 1000
const MAX_TIME_WINDOW = 24 * 60 * 60 * 1000

function normalizeNonNegativeInteger({ value, name }) {
  if (value === undefined || value === null) return undefined

  const normalized = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }

  return normalized
}

function validateLimit({ limit, defaultLimit }) {
  const normalized = limit ?? defaultLimit
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_PAGE_SIZE) {
    throw new TypeError(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`)
  }
  return normalized
}

function validateTimeWindow({ startTime, endTime }) {
  if (startTime !== undefined && endTime !== undefined) {
    if (endTime < startTime) {
      throw new RangeError("endTime must be greater than or equal to startTime")
    }
    if (endTime - startTime > MAX_TIME_WINDOW) {
      throw new RangeError("startTime and endTime cannot span more than 24 hours")
    }
  }
}

function validateSymbol({ symbol }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("symbol is required")
  }
  return symbol.trim().toUpperCase()
}

export function createMyTradesParams({
  symbol,
  orderId,
  fromId,
  startTime,
  endTime,
  limit,
} = {}) {
  const normalizedSymbol = validateSymbol({ symbol })
  const normalizedOrderId = normalizeNonNegativeInteger({ value: orderId, name: "orderId" })
  const normalizedFromId = normalizeNonNegativeInteger({ value: fromId, name: "fromId" })
  const normalizedStartTime = normalizeNonNegativeInteger({ value: startTime, name: "startTime" })
  const normalizedEndTime = normalizeNonNegativeInteger({ value: endTime, name: "endTime" })

  validateTimeWindow({
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
  })

  if ((normalizedOrderId !== undefined || normalizedFromId !== undefined) &&
      (normalizedStartTime !== undefined || normalizedEndTime !== undefined)) {
    throw new TypeError("orderId/fromId cannot be combined with startTime or endTime")
  }

  return {
    symbol: normalizedSymbol,
    limit: validateLimit({ limit, defaultLimit: 1000 }),
    ...(normalizedOrderId !== undefined ? { orderId: normalizedOrderId } : {}),
    ...(normalizedFromId !== undefined ? { fromId: normalizedFromId } : {}),
    ...(normalizedStartTime !== undefined ? { startTime: normalizedStartTime } : {}),
    ...(normalizedEndTime !== undefined ? { endTime: normalizedEndTime } : {}),
  }
}

export function createOrderHistoryParams({
  symbol,
  orderId,
  startTime,
  endTime,
  limit,
} = {}) {
  const normalizedSymbol = validateSymbol({ symbol })
  const normalizedOrderId = normalizeNonNegativeInteger({ value: orderId, name: "orderId" })
  const normalizedStartTime = normalizeNonNegativeInteger({ value: startTime, name: "startTime" })
  const normalizedEndTime = normalizeNonNegativeInteger({ value: endTime, name: "endTime" })

  validateTimeWindow({
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
  })

  if (normalizedOrderId !== undefined &&
      (normalizedStartTime !== undefined || normalizedEndTime !== undefined)) {
    throw new TypeError("orderId cannot be combined with startTime or endTime")
  }

  return {
    symbol: normalizedSymbol,
    limit: validateLimit({ limit, defaultLimit: 100 }),
    ...(normalizedOrderId !== undefined ? { orderId: normalizedOrderId } : {}),
    ...(normalizedStartTime !== undefined ? { startTime: normalizedStartTime } : {}),
    ...(normalizedEndTime !== undefined ? { endTime: normalizedEndTime } : {}),
  }
}
