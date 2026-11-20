/** Pure validation for the startup exchange-history synchronization boundary. */

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`Account history ${field} must be a stable provider identifier`)
  }
  return value
}

function validateBroker({ broker } = {}) {
  if (typeof broker?.getCanonicalOrderHistory !== "function" ||
      typeof broker?.getFills !== "function") {
    throw new TypeError("Account history synchronization requires canonical order and fill history methods")
  }
}

function validateSymbols({ symbols } = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0 ||
      symbols.some((symbol) => typeof symbol !== "string" || !symbol.trim())) {
    throw new TypeError("Account history synchronization requires configured market symbols")
  }
  if (new Set(symbols).size !== symbols.length) {
    throw new Error("Account history synchronization symbols must be unique")
  }
}

function validateProviderIdentity({ providerIdentity } = {}) {
  if (providerIdentity?.providerType !== "binance") {
    throw new TypeError("Account history synchronization currently supports Binance only")
  }
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    requireIdentifier({
      value: providerIdentity[field],
      field,
    })
  }
}

function hasOrderRepository({ orderRepository } = {}) {
  return typeof orderRepository?.upsertHistorical === "function" &&
    typeof orderRepository?.findByExchangeOrderIdentity === "function" &&
    typeof orderRepository?.getOldestPendingOrderId === "function"
}

function hasFillRepository({ fillRepository } = {}) {
  return typeof fillRepository?.upsert === "function"
}

function hasCursorRepository({ cursorRepository } = {}) {
  return typeof cursorRepository?.get === "function" &&
    typeof cursorRepository?.saveOrderCursor === "function" &&
    typeof cursorRepository?.saveTradeCursor === "function"
}

function validateRepositories(input) {
  if (!hasOrderRepository(input) || !hasFillRepository(input) || !hasCursorRepository(input)) {
    throw new TypeError("Account history synchronization requires relational history and cursor repositories")
  }
}

function validatePagination({ limit, requestDelayMs, sleep, now } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_PAGE_SIZE) {
    throw new TypeError("Account history page size must be between 1 and 1000")
  }
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0) {
    throw new TypeError("Account history request delay must be a non-negative safe integer")
  }
  if (typeof sleep !== "function" || typeof now !== "function") {
    throw new TypeError("Account history synchronization requires sleep and clock functions")
  }
}

export function validateOptions(input) {
  validateBroker(input)
  validateSymbols(input)
  validateProviderIdentity(input)
  if (!["testnet", "live"].includes(input.environment)) {
    throw new TypeError("Account history synchronization environment must be testnet or live")
  }
  validateRepositories(input)
  validatePagination(input)
}

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

export function validatePage({ result, symbol, limit, historyType }) {
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
