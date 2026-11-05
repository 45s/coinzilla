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
    subscribe: async () => {
      const response = await client.request(
        "userDataStream.subscribe.signature",
        {},
        { signed: true },
      )
      return response.data?.subscriptionId ?? null
    },
    listSubscriptions: async () => {
      const response = await client.request("session.subscriptions")
      if (!Array.isArray(response.data)) return null
      return response.data.map((subscription) => subscription?.subscriptionId)
    },
    unsubscribe: async (subscriptionId) => {
      await client.request(
        "userDataStream.unsubscribe",
        { subscriptionId },
      )
    },
  })
}
