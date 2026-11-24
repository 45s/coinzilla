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

function adaptFundingRate(row, expectedSymbol) {
  ensure.plainObject({
    value: row,
    name: "Futures funding rate",
  })
  const symbol = normalizeSymbol(row.symbol)
  if (expectedSymbol !== undefined && symbol !== expectedSymbol) {
    throw new TypeError("Bitunix Futures funding-rate response symbol does not match the requested symbol")
  }
  for (const field of ["markPrice", "lastPrice", "indexPrice", "fundingRate", "maxFundingRate", "minFundingRate"]) {
    assertDecimalString({
      value: row[field],
      name: field,
    })
  }
  return Object.freeze({
    symbol,
    markPrice: row.markPrice,
    lastPrice: row.lastPrice,
    indexPrice: row.indexPrice,
    fundingRate: row.fundingRate,
    nextFundingTime: normalizeTimestamp(row.nextFundingTime, "nextFundingTime"),
    fundingInterval: ensure.positiveInteger({
      value: row.fundingInterval,
      name: "fundingInterval",
    }),
    maxFundingRate: row.maxFundingRate,
    minFundingRate: row.minFundingRate,
  })
}

function adaptFundingRates(data, expectedSymbol) {
  if (!Array.isArray(data)) {
    throw new TypeError("Bitunix Futures funding-rate response data must be an array")
  }
  const seenSymbols = new Set()
  const rates = data.map((row) => {
    const rate = adaptFundingRate(row, expectedSymbol)
    if (seenSymbols.has(rate.symbol)) {
      throw new TypeError(`Bitunix Futures funding-rate response contains duplicate symbol ${rate.symbol}`)
    }
    seenSymbols.add(rate.symbol)
    return rate
  })
  return Object.freeze(rates)
}

export async function getFuturesFundingRate({ broker, input = {} }) {
  try {
    const symbol = normalizeSymbol(input.symbol)
    const response = await broker.restClient.request({
      method: "GET",
      path: "/api/v1/futures/market/funding_rate",
      queryParams: {
        symbol,
      },
      authenticated: false,
    })
    const rates = adaptFundingRates(response.data, symbol)
    if (rates.length !== 1) {
      throw new TypeError("Bitunix Futures single-symbol funding-rate response must contain exactly one row")
    }
    return toResult({
      data: rates[0],
    })
  } catch (error) {
    handleErr({
      where: "getFuturesFundingRate()",
      error,
    })
    return toResult({
      errors: [error],
    })
  }
}

export async function getFuturesFundingRates({ broker }) {
  try {
    const response = await broker.restClient.request({
      method: "GET",
      path: "/api/v1/futures/market/funding_rate/batch",
      authenticated: false,
    })
    return toResult({
      data: adaptFundingRates(response.data),
    })
  } catch (error) {
    handleErr({
      where: "getFuturesFundingRates()",
      error,
    })
    return toResult({
      errors: [error],
    })
  }
}
