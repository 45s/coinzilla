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
      settle({
        event,
        error: null,
      })
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
    timer = setTimeout(() => {
      settle({
        event: null,
        error: new Error("Timed out waiting for the matching Bitunix Futures private order event"),
      })
    }, timeoutMs)
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
