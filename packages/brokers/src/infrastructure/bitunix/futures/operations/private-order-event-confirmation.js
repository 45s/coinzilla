const CANCELED_EVENT_STATUSES = new Set(["CANCELED", "PART_FILLED_CANCELED"])

function hasIdentifier(value) {
  return typeof value === "string" && value.trim() !== ""
}

function matchesIdentifier({ actual, expected }) {
  return expected === undefined || actual === expected
}

function isPrivateSessionUnavailable(status) {
  return status?.state !== "open" || status.authenticated !== true ||
    status.recoveryRequired !== false
}

function getOrderEventKey(order) {
  return `${order.symbol}\u0000${order.orderId}\u0000${order.clientId}`
}

function createOrderEventsResult({ orders, received, error }) {
  const events = []
  const missingOrders = []
  for (const order of orders) {
    const event = received.get(getOrderEventKey(order))
    if (event) {
      events.push({ order, event })
    } else {
      missingOrders.push(order)
    }
  }
  return { events, missingOrders, error }
}

function findMatchingOrder({ event, orders }) {
  return orders.find((order) => matchesPrivateOrderEventIdentity({
    event,
    orderId: order.orderId,
    clientOrderId: order.clientId,
    symbol: order.symbol,
  }))
}

/**
 * Match a raw private order-channel event against exchange and caller order identities.
 * @param {{event: object, orderId?: string, clientOrderId?: string, symbol: string}} options
 * @returns {boolean}
 */
export function matchesPrivateOrderEventIdentity({ event, orderId, clientOrderId, symbol } = {}) {
  const payload = event?.data
  if (event?.ch !== "order" || payload === null || typeof payload !== "object" ||
      Array.isArray(payload)) {
    return false
  }
  const expectedOrderId = hasIdentifier(orderId) ? orderId : undefined
  const expectedClientOrderId = hasIdentifier(clientOrderId) ? clientOrderId : undefined
  if (expectedOrderId === undefined && expectedClientOrderId === undefined) {
    return false
  }
  return payload.symbol === symbol &&
    matchesIdentifier({
      actual: payload.orderId,
      expected: expectedOrderId,
    }) &&
    matchesIdentifier({
      actual: payload.clientId,
      expected: expectedClientOrderId,
    })
}

/**
 * Match a private CLOSE event that represents an actual canceled terminal state.
 * @param {{event: object, order: object}} options
 * @returns {boolean}
 */
export function matchesPrivateOrderCancellationEvent({ event, order } = {}) {
  const payload = event?.data
  return matchesPrivateOrderEventIdentity({
    event,
    orderId: order?.orderId,
    clientOrderId: order?.clientId,
    symbol: order?.symbol,
  }) && payload?.event === "CLOSE" &&
    CANCELED_EVENT_STATUSES.has(payload.orderStatus)
}

/**
 * Wait for one matching private order event, a private-session failure, or a bounded timeout.
 * @param {{broker: object, orderId?: string, clientOrderId?: string, symbol: string}} options
 * @returns {{promise: Promise<{event: object|null, error: Error|null}>, startTimeout: () => void, cancel: () => void}}
 */
export function createPrivateOrderEventWaiter({ broker, orderId, clientOrderId, symbol } = {}) {
  const client = broker?.privateWebSocketClient
  const timeoutMs = broker?.privateEventTimeoutMs
  if (broker?.isUserDataReady !== true || !client ||
      typeof client.on !== "function" || typeof client.off !== "function") {
    throw new Error("Bitunix Futures private order-event confirmation requires a ready private user-data session")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Bitunix Futures privateEventTimeoutMs must be a positive safe integer")
  }

  let settled = false
  let timer = null
  let resolveResult
  const promise = new Promise((resolve) => {
    resolveResult = resolve
  })
  function cleanup() {
    client.off("channel", onChannel)
    client.off("status", onStatus)
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
  function settle(result) {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    resolveResult(result)
  }
  function onChannel(event) {
    if (matchesPrivateOrderEventIdentity({
      event,
      orderId,
      clientOrderId,
      symbol,
    })) {
      settle({ event, error: null })
    }
  }
  function onStatus(status) {
    if (isPrivateSessionUnavailable(status)) {
      settle({
        event: null,
        error: new Error("Bitunix Futures private user-data session became unavailable before order-event confirmation"),
      })
    }
  }
  function startTimeout() {
    if (settled || timer !== null) {
      return
    }
    timer = setTimeout(() => settle({
      event: null,
      error: new Error("Timed out waiting for the matching Bitunix Futures private order event"),
    }), timeoutMs)
  }
  client.on("channel", onChannel)
  client.on("status", onStatus)
  return {
    promise,
    startTimeout,
    cancel: () => settle({
      event: null,
      error: null,
    }),
  }
}

/**
 * Wait for one CLOSE event per expected order identity using a single private-session listener.
 * @param {{broker: object, orders: object[]}} options
 * @returns {{promise: Promise<{events: object[], missingOrders: object[], error: Error|null}>, startTimeout: () => void, cancel: () => void}}
 */
export function createPrivateOrderEventsWaiter({ broker, orders } = {}) {
  const client = broker?.privateWebSocketClient
  const timeoutMs = broker?.privateEventTimeoutMs
  if (broker?.isUserDataReady !== true || !client ||
      typeof client.on !== "function" || typeof client.off !== "function") {
    throw new Error("Bitunix Futures private order-event confirmation requires a ready private user-data session")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Bitunix Futures privateEventTimeoutMs must be a positive safe integer")
  }
  if (!Array.isArray(orders) || orders.length === 0 ||
      orders.some((order) => !hasIdentifier(order?.orderId) ||
        !hasIdentifier(order?.clientId) || !hasIdentifier(order?.symbol))) {
    throw new TypeError("Bitunix Futures multi-order event waiter requires complete order identities")
  }
  const expectedKeys = orders.map(getOrderEventKey)
  if (new Set(expectedKeys).size !== expectedKeys.length) {
    throw new RangeError("Bitunix Futures multi-order event waiter cannot track duplicate order identities")
  }

  const received = new Map()
  let settled = false
  let timer = null
  let resolveResult
  const promise = new Promise((resolve) => {
    resolveResult = resolve
  })
  function cleanup() {
    client.off("channel", onChannel)
    client.off("status", onStatus)
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
  function settle(error = null) {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    resolveResult(createOrderEventsResult({
      orders,
      received,
      error,
    }))
  }
  function onChannel(event) {
    if (event?.data?.event !== "CLOSE") {
      return
    }
    const order = findMatchingOrder({
      event,
      orders,
    })
    if (!order) {
      return
    }
    received.set(getOrderEventKey(order), event)
    if (received.size === orders.length) {
      settle()
    }
  }
  function onStatus(status) {
    if (isPrivateSessionUnavailable(status)) {
      settle(new Error("Bitunix Futures private user-data session became unavailable before all CLOSE events were observed"))
    }
  }
  function startTimeout() {
    if (settled || timer !== null) {
      return
    }
    timer = setTimeout(() => settle(
      new Error("Timed out waiting for every matching Bitunix Futures private CLOSE event"),
    ), timeoutMs)
  }
  client.on("channel", onChannel)
  client.on("status", onStatus)
  return {
    promise,
    startTimeout,
    cancel: () => settle(),
  }
}
