/**
 * Normalize and freeze application-owned attribution for one canonical order.
 *
 * @param {object} options
 * @param {object} options.ownership Strategy and Position attribution.
 * @param {string} options.clientOrderId Original Harvester client order identity.
 * @param {string} [options.brokerOrderId] Exchange-assigned order identity, once known.
 * @returns {object} Immutable order ownership record.
 */
export function createOrderOwnership({ ownership, clientOrderId, brokerOrderId } = {}) {
  if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) {
    throw new TypeError("Order ownership must be an object")
  }
  for (const field of ["strategyId", "positionId"]) {
    if (typeof ownership[field] !== "string" || !ownership[field].trim()) {
      throw new TypeError(`Order ownership requires a non-empty ${field}`)
    }
  }
  if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
    throw new TypeError("Order ownership requires a non-empty clientOrderId")
  }
  if (ownership.clientOrderId !== undefined && ownership.clientOrderId !== clientOrderId) {
    throw new Error("Order ownership clientOrderId does not match its canonical order")
  }
  if (ownership.brokerOrderId !== undefined && ownership.brokerOrderId !== brokerOrderId) {
    throw new Error("Order ownership brokerOrderId does not match its canonical order")
  }
  for (const field of ["purpose", "cycleId"]) {
    if (ownership[field] !== undefined && ownership[field] !== null &&
        (typeof ownership[field] !== "string" || !ownership[field].trim())) {
      throw new TypeError(`Order ownership ${field} must be a non-empty string when provided`)
    }
  }

  const normalized = {
    clientOrderId,
    strategyId: ownership.strategyId.trim(),
    positionId: ownership.positionId.trim(),
  }
  if (brokerOrderId !== undefined) {
    normalized.brokerOrderId = brokerOrderId
  }
  if (typeof ownership.purpose === "string") {
    normalized.purpose = ownership.purpose.trim()
  }
  if (typeof ownership.cycleId === "string") {
    normalized.cycleId = ownership.cycleId.trim()
  }
  return Object.freeze(normalized)
}

/**
 * Validate ownership records against the canonical orders they attribute.
 *
 * @param {object} options
 * @param {import("@coinzilla/entities").CanonicalOrder[]} options.orders
 * @param {object[]} options.ownerships
 * @returns {ReadonlyArray<object>} Validated immutable ownership records.
 */
export function validateOrderOwnerships({ orders, ownerships } = {}) {
  if (!Array.isArray(ownerships)) {
    throw new TypeError("OrderRegistry.ownerships must be an array")
  }
  const normalizedOwnerships = ownerships.map((ownership) => {
    const order = orders.find((item) => item.clientOrderId === ownership?.clientOrderId)
    if (!order) {
      throw new Error("Order ownership must reference a registered canonical order")
    }
    return createOrderOwnership({
      ownership,
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    })
  })
  const clientOrderIds = normalizedOwnerships.map((ownership) => ownership.clientOrderId)
  const brokerOrderIds = normalizedOwnerships
    .map((ownership) => ownership.brokerOrderId)
    .filter((id) => id !== undefined)
  if (new Set(clientOrderIds).size !== clientOrderIds.length) {
    throw new TypeError("OrderRegistry cannot contain duplicate ownership clientOrderIds")
  }
  if (new Set(brokerOrderIds).size !== brokerOrderIds.length) {
    throw new TypeError("OrderRegistry cannot contain duplicate ownership brokerOrderIds")
  }
  return Object.freeze(normalizedOwnerships)
}

/**
 * Resolve order ownership by Harvester client identity, exchange identity, or both.
 *
 * @param {object} options
 * @param {object[]} options.ownerships
 * @param {string} [options.clientOrderId]
 * @param {string} [options.brokerOrderId]
 * @returns {object|undefined} Matching immutable ownership record.
 */
export function findOrderOwnership({ ownerships, clientOrderId, brokerOrderId } = {}) {
  if (clientOrderId === undefined && brokerOrderId === undefined) {
    throw new TypeError("OrderRegistry.getOwnership requires clientOrderId or brokerOrderId")
  }
  if (clientOrderId !== undefined && (typeof clientOrderId !== "string" || !clientOrderId.trim())) {
    throw new TypeError("OrderRegistry.getOwnership clientOrderId must be a non-empty string")
  }
  if (brokerOrderId !== undefined && (typeof brokerOrderId !== "string" || !brokerOrderId.trim())) {
    throw new TypeError("OrderRegistry.getOwnership brokerOrderId must be a non-empty string")
  }

  const byClientOrderId = clientOrderId === undefined
    ? undefined
    : ownerships.find((ownership) => ownership.clientOrderId === clientOrderId)
  const byBrokerOrderId = brokerOrderId === undefined
    ? undefined
    : ownerships.find((ownership) => ownership.brokerOrderId === brokerOrderId)
  if (clientOrderId !== undefined && brokerOrderId !== undefined &&
      byClientOrderId !== byBrokerOrderId) {
    throw new Error("Order ownership clientOrderId and brokerOrderId identify different registered orders")
  }
  return byClientOrderId ?? byBrokerOrderId
}

/**
 * Compare two normalized ownership records without changing their identities.
 *
 * @param {object} options
 * @param {object} options.current
 * @param {object} options.next
 * @returns {boolean} Whether every ownership field matches.
 */
export function hasSameOrderOwnership({ current, next } = {}) {
  return JSON.stringify(current) === JSON.stringify(next)
}

/**
 * Attach a broker identity without changing the original client or strategy ownership.
 *
 * @param {object} options
 * @param {object[]} options.ownerships
 * @param {string} options.clientOrderId
 * @param {string} options.brokerOrderId
 * @returns {ReadonlyArray<object>} Updated immutable ownership records.
 */
export function attachBrokerOrderIdToOwnership({ ownerships, clientOrderId, brokerOrderId } = {}) {
  return Object.freeze(ownerships.map((ownership) => {
    if (ownership.clientOrderId !== clientOrderId) {
      return ownership
    }
    return Object.freeze({
      ...ownership,
      brokerOrderId,
    })
  }))
}
