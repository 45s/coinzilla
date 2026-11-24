import { assertDecimalString, ensure, handleErr, toResult } from "@coinzilla/utils"

function normalizeSymbol(value) {
  return ensure.nonEmptyString({
    value,
    name: "symbol",
  }).trim().toUpperCase()
}

function normalizeTimestamp(value, name) {
  const timestamp = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError(`${name} must be a positive safe-integer millisecond timestamp`)
  }
  return timestamp
}

export async function getFuturesFundingRateHistory({ broker, input = {} }) {
  try {
    const symbol = normalizeSymbol(input.symbol)
    const queryParams = {
      symbol,
    }
    if (input.startTime !== undefined) {
      queryParams.startTime = normalizeTimestamp(input.startTime, "startTime")
    }
    if (input.endTime !== undefined) {
      queryParams.endTime = normalizeTimestamp(input.endTime, "endTime")
    }
    if (
      queryParams.startTime !== undefined &&
      queryParams.endTime !== undefined &&
      queryParams.startTime > queryParams.endTime
    ) {
      throw new TypeError("startTime must not be later than endTime")
    }
    if (input.limit !== undefined) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200) {
        throw new TypeError("limit must be an integer between 1 and the documented maximum of 200")
      }
      queryParams.limit = input.limit
    }
    const response = await broker.restClient.request({
      method: "GET",
      path: "/api/v1/futures/market/get_funding_rate_history",
      queryParams,
      authenticated: false,
    })
    if (!Array.isArray(response.data)) {
      throw new TypeError("Bitunix Futures funding-history response data must be an array")
    }
    const history = response.data.map((row) => {
      ensure.plainObject({
        value: row,
        name: "Futures funding-history row",
      })
      assertDecimalString({
        value: row.fundingRate,
        name: "fundingRate",
      })
      assertDecimalString({
        value: row.markPrice,
        name: "markPrice",
      })
      return Object.freeze({
        fundingRate: row.fundingRate,
        fundingTime: normalizeTimestamp(row.fundingTime, "fundingTime"),
        markPrice: row.markPrice,
      })
    })
    return toResult({
      data: Object.freeze(history),
    })
  } catch (error) {
    handleErr({
      where: "getFuturesFundingRateHistory()",
      error,
    })
    return toResult({
      errors: [error],
    })
  }
}
