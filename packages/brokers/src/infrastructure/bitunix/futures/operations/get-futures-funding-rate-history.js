import { assertDecimalString, ensure, handleErr, toResult } from "@coinzilla/utils"

function normalizeSymbol(value) {
  return ensure.nonEmptyString({
    value,
    name: "symbol",
  }).trim().toUpperCase()
}

function normalizeTimestamp({ value, name }) {
  const timestamp = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError(`${name} must be a positive safe-integer millisecond timestamp`)
  }
  return timestamp
}

function buildFundingHistoryQuery({ input }) {
  const queryParams = {
    symbol: normalizeSymbol(input.symbol),
  }
  if (input.startTime !== undefined) {
    queryParams.startTime = normalizeTimestamp({
      value: input.startTime,
      name: "startTime",
    })
  }
  if (input.endTime !== undefined) {
    queryParams.endTime = normalizeTimestamp({
      value: input.endTime,
      name: "endTime",
    })
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
  return queryParams
}

function adaptFundingHistory({ data }) {
  if (!Array.isArray(data)) {
    throw new TypeError("Bitunix Futures funding-history response data must be an array")
  }
  return Object.freeze(data.map((row) => {
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
      fundingTime: normalizeTimestamp({
        value: row.fundingTime,
        name: "fundingTime",
      }),
      markPrice: row.markPrice,
    })
  }))
}

export async function getFuturesFundingRateHistory({ broker, input = {} }) {
  try {
    const queryParams = buildFundingHistoryQuery({
      input,
    })
    const response = await broker.restClient.request({
      method: "GET",
      path: "/api/v1/futures/market/get_funding_rate_history",
      queryParams,
      authenticated: false,
    })
    return toResult({
      data: adaptFundingHistory({
        data: response.data,
      }),
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
