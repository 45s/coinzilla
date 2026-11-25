import { ensure, handleErr, toResult } from "@coinzilla/utils"

function normalizeSymbol(value) {
  return ensure.nonEmptyString({
    value,
    name: "symbol",
  }).trim().toUpperCase()
}

function buildTradingSettingsQuery({ input }) {
  if (input.symbols === undefined) {
    return {
      queryParams: undefined,
      requestedSymbols: undefined,
    }
  }
  if (!Array.isArray(input.symbols) || input.symbols.length < 1 || input.symbols.length > 50) {
    throw new TypeError("symbols must be a non-empty array containing no more than 50 symbols")
  }
  const requestedSymbols = input.symbols.map(normalizeSymbol)
  if (new Set(requestedSymbols).size !== requestedSymbols.length) {
    throw new TypeError("symbols must not contain duplicates")
  }
  return {
    queryParams: {
      symbols: requestedSymbols.join(","),
    },
    requestedSymbols,
  }
}

function adaptTradingSettings({ data, requestedSymbols }) {
  if (!Array.isArray(data)) {
    throw new TypeError("Bitunix Futures trading-settings response data must be an array")
  }
  const requestedSet = requestedSymbols === undefined ? null : new Set(requestedSymbols)
  const seenSymbols = new Set()
  const settings = data.map((row) => {
    ensure.plainObject({
      value: row,
      name: "Futures trading setting",
    })
    const symbol = normalizeSymbol(row.symbol)
    if (requestedSet !== null && !requestedSet.has(symbol)) {
      throw new TypeError("Bitunix Futures trading-settings response contains an unrequested symbol")
    }
    if (seenSymbols.has(symbol)) {
      throw new TypeError(`Bitunix Futures trading-settings response contains duplicate symbol ${symbol}`)
    }
    seenSymbols.add(symbol)
    const result = {
      symbol,
      marginCoin: ensure.nonEmptyString({
        value: row.marginCoin,
        name: "marginCoin",
      }).trim().toUpperCase(),
      marginMode: ensure.oneOf({
        value: row.marginMode,
        values: ["CROSS", "ISOLATION"],
        name: "marginMode",
      }),
      leverage: ensure.positiveInteger({
        value: row.leverage,
        name: "leverage",
      }),
    }
    if (row.longLeverage !== undefined) {
      result.longLeverage = ensure.positiveInteger({
        value: row.longLeverage,
        name: "longLeverage",
      })
    }
    if (row.shortLeverage !== undefined) {
      result.shortLeverage = ensure.positiveInteger({
        value: row.shortLeverage,
        name: "shortLeverage",
      })
    }
    return Object.freeze(result)
  })
  return Object.freeze(settings)
}

export async function getFuturesTradingSettings({ broker, input = {} }) {
  try {
    const { queryParams, requestedSymbols } = buildTradingSettingsQuery({
      input,
    })
    const response = await broker.restClient.request({
      method: "GET",
      path: "/api/v1/futures/account/trading_settings",
      queryParams,
      authenticated: true,
    })
    return toResult({
      data: adaptTradingSettings({
        data: response.data,
        requestedSymbols,
      }),
    })
  } catch (error) {
    handleErr({
      where: "getFuturesTradingSettings()",
      error,
    })
    return toResult({
      errors: [error],
    })
  }
}
