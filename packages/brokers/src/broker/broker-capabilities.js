export const BROKER_CAPABILITY_TYPES = Object.freeze([
  "READ_ASSETS",
  "READ_BALANCES",
  "READ_ACCOUNT_SNAPSHOT",
  "READ_SERVER_TIME",
  "READ_EXCHANGE_MARKETS",
  "READ_SYMBOL_FILTERS",
  "READ_TRADING_RULES",
  "READ_OPEN_ORDERS",
  "READ_ORDER",
  "READ_ORDER_HISTORY",
  "READ_CANONICAL_ORDER",
  "READ_CANONICAL_ORDER_HISTORY",
  "READ_TRADE_HISTORY",
  "READ_FILLS",
  "READ_MARKET_PRICE",
  "READ_CANDLES",
  "READ_ORDER_BOOK",
  "READ_KLINES",
  "READ_KLINE_HISTORY",
  "READ_EXCHANGE_RATES",
  "READ_DEPOSITS",
  "READ_DEPOSIT_ADDRESS",
  "READ_WITHDRAWAL_HISTORY",
  "READ_MATCHING_ORDER_DETAILS",
  "PLACE_LIMIT_ORDER",
  "PLACE_MARKET_ORDER",
  "CANCEL_ORDER",
  "CANCEL_ALL_ORDERS",
  "SUBSCRIBE_MARKET_PRICES",
  "SUBSCRIBE_CANDLES",
  "SUBSCRIBE_BOOK_TICKER",
  "SUBSCRIBE_USER_DATA",
  "READ_COMPLETE_FILL_HISTORY",
  "RECONCILE_ORDERS",
  "REPLAY_USER_DATA_EVENTS",
  "RECOVER_USER_DATA_SESSION",
  "RECOVER_PROCESS_RESTART",
])

export const BROKER_CAPABILITY_STATUSES = Object.freeze([
  "SUPPORTED",
  "UNSUPPORTED",
  "UNKNOWN",
])

export const brokerCapabilitiesErrMsgs = Object.freeze({
  input: "BrokerCapabilities input should be an object",
  provider: "BrokerCapabilities.provider should be a non-empty string",
  product: "BrokerCapabilities.product should be a non-empty string",
  environment: "BrokerCapabilities.environment should be a valid object",
  capabilities: "BrokerCapabilities.capabilities should be an array",
  capability: "BrokerCapabilities.capabilities should contain valid capability objects",
  type: "Broker capability type is unsupported",
  status: "Broker capability status is unsupported",
  metadata: "Broker capability metadata should contain non-empty strings",
  guarantee: "SUPPORTED broker capabilities require a method and guarantee",
  reason: "UNSUPPORTED and UNKNOWN broker capabilities require a reason",
  conditions: "Broker capability conditions should be non-empty strings",
  duplicate: "Broker capability types should be unique",
  query: "BrokerCapabilities lookup requires a supported capability type",
})

const ENVIRONMENT_KEYS = new Set(["selector", "selectedMode", "supportedModes", "notes"])
const CAPABILITY_KEYS = new Set([
  "type",
  "status",
  "method",
  "guarantee",
  "limitation",
  "reason",
  "conditions",
])

function isRecord({ value }) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireNonEmptyString({ value, message }) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    throw new TypeError(message)
  }
  return value
}

function deepFreeze({ value }) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }
  for (const nestedValue of Object.values(value)) {
    deepFreeze({ value: nestedValue })
  }
  return Object.freeze(value)
}

function cloneValue({ value }) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue({ value: entry }))
  }
  if (isRecord({ value })) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      cloneValue({ value: entry }),
    ]))
  }
  return value
}

function normalizeStringArray({ value, message }) {
  if (!Array.isArray(value) || value.some((entry) =>
    typeof entry !== "string" || entry.trim() === "" || entry !== entry.trim())) {
    throw new TypeError(message)
  }
  return [...value]
}

function normalizeEnvironment({ environment }) {
  if (environment === undefined) {
    return undefined
  }
  if (!isRecord({ value: environment })) {
    throw new TypeError(brokerCapabilitiesErrMsgs.environment)
  }
  for (const key of Object.keys(environment)) {
    if (!ENVIRONMENT_KEYS.has(key)) {
      throw new TypeError(brokerCapabilitiesErrMsgs.environment)
    }
  }

  const normalized = {}
  for (const key of ["selector", "selectedMode", "notes"]) {
    if (environment[key] !== undefined) {
      normalized[key] = requireNonEmptyString({
        value: environment[key],
        message: brokerCapabilitiesErrMsgs.environment,
      })
    }
  }
  if (environment.supportedModes !== undefined) {
    normalized.supportedModes = normalizeStringArray({
      value: environment.supportedModes,
      message: brokerCapabilitiesErrMsgs.environment,
    })
    if (normalized.supportedModes.length === 0 ||
        new Set(normalized.supportedModes).size !== normalized.supportedModes.length) {
      throw new TypeError(brokerCapabilitiesErrMsgs.environment)
    }
  }
  if (normalized.selectedMode !== undefined && normalized.supportedModes !== undefined &&
      !normalized.supportedModes.includes(normalized.selectedMode)) {
    throw new TypeError(brokerCapabilitiesErrMsgs.environment)
  }
  return deepFreeze({ value: normalized })
}

function normalizeCapability({ capability }) {
  if (!isRecord({ value: capability })) {
    throw new TypeError(brokerCapabilitiesErrMsgs.capability)
  }
  for (const key of Object.keys(capability)) {
    if (!CAPABILITY_KEYS.has(key)) {
      throw new TypeError(brokerCapabilitiesErrMsgs.capability)
    }
  }

  const { type, status } = capability
  if (!BROKER_CAPABILITY_TYPES.includes(type)) {
    throw new TypeError(brokerCapabilitiesErrMsgs.type)
  }
  if (!BROKER_CAPABILITY_STATUSES.includes(status)) {
    throw new TypeError(brokerCapabilitiesErrMsgs.status)
  }

  const normalized = {
    type,
    status,
  }
  for (const key of ["method", "guarantee", "limitation", "reason"]) {
    if (capability[key] !== undefined) {
      normalized[key] = requireNonEmptyString({
        value: capability[key],
        message: brokerCapabilitiesErrMsgs.metadata,
      })
    }
  }
  if (status === "SUPPORTED" &&
      (normalized.method === undefined || normalized.guarantee === undefined)) {
    throw new TypeError(brokerCapabilitiesErrMsgs.guarantee)
  }
  if ((status === "UNSUPPORTED" || status === "UNKNOWN") && normalized.reason === undefined) {
    throw new TypeError(brokerCapabilitiesErrMsgs.reason)
  }
  if (capability.conditions !== undefined) {
    normalized.conditions = normalizeStringArray({
      value: capability.conditions,
      message: brokerCapabilitiesErrMsgs.conditions,
    })
  }
  return deepFreeze({ value: normalized })
}

/**
 * Immutable, exchange-neutral declaration of one broker provider's verified capabilities.
 * Runtime readiness, account authorization and connectivity remain separate concerns.
 */
export class BrokerCapabilities {
  #capabilitiesByType

  constructor(input = {}) {
    if (!isRecord({ value: input })) {
      throw new TypeError(brokerCapabilitiesErrMsgs.input)
    }
    const provider = requireNonEmptyString({
      value: input.provider,
      message: brokerCapabilitiesErrMsgs.provider,
    })
    const product = requireNonEmptyString({
      value: input.product,
      message: brokerCapabilitiesErrMsgs.product,
    })
    if (input.capabilities !== undefined && !Array.isArray(input.capabilities)) {
      throw new TypeError(brokerCapabilitiesErrMsgs.capabilities)
    }

    const capabilities = (input.capabilities ?? []).map((capability) =>
      normalizeCapability({ capability }))
    const types = capabilities.map(({ type }) => type)
    if (new Set(types).size !== types.length) {
      throw new TypeError(brokerCapabilitiesErrMsgs.duplicate)
    }

    this.contractVersion = 1
    this.provider = provider
    this.product = product
    this.environment = normalizeEnvironment({ environment: input.environment })
    this.capabilities = Object.freeze(capabilities)
    this.#capabilitiesByType = new Map(capabilities.map((capability) => [
      capability.type,
      capability,
    ]))
    Object.freeze(this)
  }

  getCapability({ type } = {}) {
    if (!BROKER_CAPABILITY_TYPES.includes(type)) {
      throw new TypeError(brokerCapabilitiesErrMsgs.query)
    }
    return this.#capabilitiesByType.get(type) ?? Object.freeze({
      type,
      status: "UNKNOWN",
    })
  }

  getStatus({ type } = {}) {
    return this.getCapability({ type }).status
  }

  get value() {
    return cloneValue({ value: {
      contractVersion: this.contractVersion,
      provider: this.provider,
      product: this.product,
      ...(this.environment ? { environment: this.environment } : {}),
      capabilities: this.capabilities,
    } })
  }

  toJSON() {
    return this.value
  }
}
