/**
 * Match a raw private order-channel event against exchange and caller order identities.
 * @param {{event: object, orderId?: string, clientOrderId?: string, symbol: string}} options
 * @returns {boolean}
 */
export function matchesPrivateOrderEventIdentity({
  event,
  orderId,
  clientOrderId,
  symbol,
} = {}) {
  const payload = event?.data
  const hasOrderId = typeof orderId === "string" && orderId.length > 0
  const hasClientOrderId = typeof clientOrderId === "string" && clientOrderId.length > 0
  if (event?.ch !== "order" || payload === null || typeof payload !== "object" ||
      Array.isArray(payload) || (!hasOrderId && !hasClientOrderId)) {
    return false
  }
  return payload.symbol === symbol &&
    (!hasOrderId || payload.orderId === orderId) &&
    (!hasClientOrderId || payload.clientId === clientOrderId)
}

/**
 * Wait for one matching private order event, a private-session failure, or a bounded timeout.
 * @param {{broker: object, orderId?: string, clientOrderId?: string, symbol: string}} options
 * @returns {{promise: Promise<{event: object|null, error: Error|null}>, cancel: () => void}}
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
  const cleanup = () => {
    client.off("channel", onChannel)
    client.off("status", onStatus)
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
  const settle = (result) => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    resolveResult(result)
  }
  const onChannel = (event) => {
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
  const onStatus = (status) => {
    if (status?.state !== "open" || status.authenticated !== true ||
        status.recoveryRequired !== false) {
      settle({
        event: null,
        error: new Error("Bitunix Futures private user-data session became unavailable before order-event confirmation"),
      })
    }
  }
  client.on("channel", onChannel)
  client.on("status", onStatus)
  timer = setTimeout(() => {
    settle({
      event: null,
      error: new Error("Timed out waiting for the matching Bitunix Futures private order event"),
    })
  }, timeoutMs)

  return {
    promise,
    cancel: () => settle({
      event: null,
      error: null,
    }),
  }
}
