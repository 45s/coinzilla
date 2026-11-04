export function createBinanceUserDataClientPort(client) {
  if (!client || typeof client.request !== "function" ||
      typeof client.connect !== "function" || typeof client.disconnect !== "function" ||
      typeof client.onEvent !== "function" || typeof client.onClose !== "function") {
    throw new TypeError("A compatible Binance WebSocket API client is required")
  }

  return Object.freeze({
    get state() {
      return client.state
    },
    connect: (...args) => client.connect(...args),
    disconnect: (...args) => client.disconnect(...args),
    onEvent: (listener) => client.onEvent(listener),
    onError: (listener) => client.onError?.(listener),
    onClose: (listener) => client.onClose(listener),
    subscribe: () => client.request(
      "userDataStream.subscribe.signature",
      {},
      { signed: true },
    ),
    listSubscriptions: () => client.request("session.subscriptions"),
    unsubscribe: (subscriptionId) => client.request(
      "userDataStream.unsubscribe",
      { subscriptionId },
    ),
  })
}
