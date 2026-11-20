export const HISTORY_SOURCE = "binance.exchange-history"

export function requireNumericCursor({ value, field, symbol }) {
  const text = String(value)
  if (!/^\d+$/.test(text)) {
    throw new TypeError(`Binance ${field} is invalid for ${symbol}`)
  }
  const cursor = Number(text)
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new RangeError(`Binance ${field} exceeds the safe pagination range for ${symbol}`)
  }
  return cursor
}

export function validateHistoryPage({ result, symbol, limit, historyType }) {
  if (result?.ok !== true || !Array.isArray(result.data)) {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(
      `Unable to fetch Binance ${historyType} history for ${symbol}${details ? `: ${details}` : ""}`,
    )
  }
  if (result.data.length > limit) {
    throw new Error(`Binance ${historyType} history exceeded the requested page size for ${symbol}`)
  }
  return result.data
}

export async function waitBeforeHistoryRequest({ state, requestDelayMs, sleep }) {
  if (state.requestCount > 0 && requestDelayMs > 0) {
    await sleep({
      durationMs: requestDelayMs,
    })
  }
}

export function createHistorySourceEvent({ id, name, observedAt }) {
  return {
    id,
    name,
    source: HISTORY_SOURCE,
    timestamp: observedAt,
  }
}

export function isArchivedOrderHistoryResult({ result } = {}) {
  return result?.ok === false &&
    Array.isArray(result.errors) &&
    result.errors.length > 0 &&
    result.errors.every((error) => error?.code === -2026)
}
