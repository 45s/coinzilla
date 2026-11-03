import { assertObjectInput, toResult } from "@coinzilla/utils"

const STRATEGY_MODES = Object.freeze(["read-only", "conservative", "aggressive"])
const OUTCOMES = Object.freeze(["success", "failed"])
const SECRET_ASSIGNMENT = /\b(api[\s_-]?key|api[\s_-]?secret|client[\s_-]?secret|access[\s_-]?token|secret|token|password|authorization|signature)\b(\s*[:=]\s*|\s+is\s+|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
const URL_CREDENTIALS = /(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi

const requireString = ({ value, field }) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value.trim()
}

const requireBoolean = ({ value, field }) => {
  if (typeof value !== "boolean") {
    throw new TypeError(field + " must be a boolean")
  }
  return value
}

const requireStrategyMode = ({ value }) => {
  if (!STRATEGY_MODES.includes(value)) {
    throw new TypeError("strategyMode must be read-only, conservative, or aggressive")
  }
  return value
}

const requireMarkets = ({ value }) => {
  if (!Array.isArray(value)) {
    throw new TypeError("enabledMarkets must be an array")
  }
  const markets = value.map((symbol, index) =>
    requireString({ value: symbol, field: "enabledMarkets[" + index + "]" })
  )
  if (new Set(markets).size !== markets.length) {
    throw new TypeError("enabledMarkets must not contain duplicates")
  }
  return markets
}

const safeError = ({ error }) => {
  if (!(error instanceof Error)) {
    throw new TypeError("error must be an Error")
  }
  const name = typeof error.name === "string" && error.name.trim()
    ? error.name.trim().slice(0, 80)
    : "Error"
  const rawMessage = typeof error.message === "string" ? error.message : "Unknown error"
  const message = rawMessage
    .replace(SECRET_ASSIGNMENT, "$1$2[REDACTED]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .slice(0, 240)
  return { name, message }
}

const mapData = (input, operation, mapper) => {
  try {
    assertObjectInput({ input, operation })
    return toResult({ data: mapper(input) })
  } catch (error) {
    return toResult({ error })
  }
}

/**
 * Map process-start facts to a small allowlisted DTO.
 * Extra input properties (including credentials and account data) are ignored.
 */
export const mapHarvesterStartedData = (input = {}) =>
  mapData(input, "Harvester started event mapping", ({
    broker,
    strategyMode,
    enabledMarkets,
    tradingEnabled,
  }) => ({
    broker: requireString({ value: broker, field: "broker" }),
    strategyMode: requireStrategyMode({ value: strategyMode }),
    enabledMarkets: requireMarkets({ value: enabledMarkets }),
    tradingEnabled: requireBoolean({ value: tradingEnabled, field: "tradingEnabled" }),
  }))

/** Map a startup failure without exposing stack traces, causes, or raw Error objects. */
export const mapHarvesterStartupFailedData = (input = {}) =>
  mapData(input, "Harvester startup-failed event mapping", ({ stage, error }) => ({
    stage: requireString({ value: stage, field: "stage" }),
    error: safeError({ error }),
  }))

/** Map a completed shutdown attempt. */
export const mapHarvesterStoppedData = (input = {}) =>
  mapData(input, "Harvester stopped event mapping", ({ reason, outcome, error }) => {
    if (!OUTCOMES.includes(outcome)) {
      throw new TypeError("outcome must be success or failed")
    }
    return {
      reason: requireString({ value: reason, field: "reason" }),
      outcome,
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })

/** Map only non-secret effective configuration facts, never the full config. */
export const mapConfigValidatedData = (input = {}) =>
  mapData(input, "Configuration-validated event mapping", ({
    enabledMarkets,
    strategyMode,
    tradingEnabled,
  }) => ({
    enabledMarkets: requireMarkets({ value: enabledMarkets }),
    strategyMode: requireStrategyMode({ value: strategyMode }),
    tradingEnabled: requireBoolean({ value: tradingEnabled, field: "tradingEnabled" }),
  }))

export const mapBrokerConnectedData = (input = {}) =>
  mapData(input, "Broker-connected event mapping", ({ broker }) => ({
    broker: requireString({ value: broker, field: "broker" }),
  }))

export const mapBrokerConnectionFailedData = (input = {}) =>
  mapData(input, "Broker-connection-failed event mapping", ({ broker, error }) => ({
    broker: requireString({ value: broker, field: "broker" }),
    error: safeError({ error }),
  }))

export const mapBrokerDisconnectedData = (input = {}) =>
  mapData(input, "Broker-disconnected event mapping", ({ broker, outcome, error }) => {
    if (!OUTCOMES.includes(outcome)) {
      throw new TypeError("outcome must be success or failed")
    }
    return {
      broker: requireString({ value: broker, field: "broker" }),
      outcome,
      ...(error === undefined ? {} : { error: safeError({ error }) }),
    }
  })
