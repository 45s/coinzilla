import { assertDecimalString, ensure, handleErr, toResult } from "@coinzilla/utils"

function normalizeSymbol(value) {
  return ensure.nonEmptyString({
    value,
    name: "symbol",
  }).trim().toUpperCase()
}

function adaptPositionTiers({ data, symbol }) {
  if (!Array.isArray(data)) {
    throw new TypeError("Bitunix Futures position-tier response data must be an array")
  }
  const seenLevels = new Set()
  const tiers = data.map((row) => {
    ensure.plainObject({
      value: row,
      name: "Futures position tier",
    })
    const rowSymbol = normalizeSymbol(row.symbol)
    if (rowSymbol !== symbol) {
      throw new TypeError("Bitunix Futures position-tier response symbol does not match the requested symbol")
    }
    const level = ensure.positiveInteger({
      value: row.level,
      name: "level",
    })
    if (seenLevels.has(level)) {
      throw new TypeError(`Bitunix Futures position-tier response contains duplicate level ${level}`)
    }
    seenLevels.add(level)
    for (const field of ["startValue", "endValue", "maintenanceMarginRate"]) {
      assertDecimalString({
        value: row[field],
        name: field,
      })
    }
    return Object.freeze({
      symbol: rowSymbol,
      level,
      startValue: row.startValue,
      endValue: row.endValue,
      leverage: ensure.positiveInteger({
        value: row.leverage,
        name: "leverage",
      }),
      maintenanceMarginRate: row.maintenanceMarginRate,
    })
  })
  return Object.freeze(tiers)
}

export async function getFuturesPositionTiers({ broker, input = {} }) {
  try {
    const symbol = normalizeSymbol(input.symbol)
    const response = await broker.restClient.request({
      method: "GET",
      path: "/api/v1/futures/position/get_position_tiers",
      queryParams: {
        symbol,
      },
      authenticated: false,
    })
    return toResult({
      data: adaptPositionTiers({
        data: response.data,
        symbol,
      }),
    })
  } catch (error) {
    handleErr({
      where: "getFuturesPositionTiers()",
      error,
    })
    return toResult({
      errors: [error],
    })
  }
}
