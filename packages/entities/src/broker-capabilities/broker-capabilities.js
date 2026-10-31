export const BROKER_CAPABILITY_TYPES = Object.freeze([
  "READ_ASSETS",
  "READ_BALANCES",
  "READ_OPEN_ORDERS",
  "READ_ORDER",
  "READ_ORDER_HISTORY",
  "READ_TRADE_HISTORY",
  "PLACE_LIMIT_ORDER",
  "PLACE_MARKET_ORDER",
  "CANCEL_ORDER",
  "CANCEL_ALL_ORDERS",
  "READ_MARKET_PRICE",
  "SUBSCRIBE_MARKET_PRICES",
  "SUBSCRIBE_USER_DATA",
  "READ_TRADING_RULES",
])

export const BROKER_CAPABILITY_STATUSES = Object.freeze([
  "SUPPORTED",
  "UNSUPPORTED",
  "UNKNOWN",
])

export const brokerCapabilitiesErrMsgs = {
  capabilities: "BrokerCapabilities.capabilities should be an array",
  capability: "BrokerCapabilities.capabilities should contain valid capability objects",
  type: "Broker capability type is unsupported",
  status: "Broker capability status is unsupported",
  duplicate: "Broker capability types should be unique",
  query: "BrokerCapabilities.getStatus requires a supported capability type",
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export class BrokerCapabilities {
  #capabilities
  #statuses

  constructor({ capabilities = [] } = {}) {
    if (
      !Array.isArray(capabilities) ||
      Array.from(capabilities).some((capability) => capability === undefined)
    ) {
      throw new Error(brokerCapabilitiesErrMsgs.capabilities)
    }

    const normalized = capabilities.map((capability) => {
      if (!isRecord(capability)) {
        throw new Error(brokerCapabilitiesErrMsgs.capability)
      }
      const { type, status } = capability
      if (!BROKER_CAPABILITY_TYPES.includes(type)) {
        throw new Error(brokerCapabilitiesErrMsgs.type)
      }
      if (!BROKER_CAPABILITY_STATUSES.includes(status)) {
        throw new Error(brokerCapabilitiesErrMsgs.status)
      }

      return Object.freeze({ type, status })
    })

    const types = normalized.map(({ type }) => type)
    if (new Set(types).size !== types.length) {
      throw new Error(brokerCapabilitiesErrMsgs.duplicate)
    }

    this.#capabilities = Object.freeze(normalized)
    this.#statuses = new Map(normalized.map(({ type, status }) => [type, status]))

    Object.freeze(this)
  }

  get capabilities() {
    return this.#capabilities
  }

  getStatus({ type } = {}) {
    if (!BROKER_CAPABILITY_TYPES.includes(type)) {
      throw new Error(brokerCapabilitiesErrMsgs.query)
    }

    return this.#statuses.get(type) ?? "UNKNOWN"
  }

  get value() {
    return {
      capabilities: this.#capabilities.map(({ type, status }) => ({ type, status })),
    }
  }
}
