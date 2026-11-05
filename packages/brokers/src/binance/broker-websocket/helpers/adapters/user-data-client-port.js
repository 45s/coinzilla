import { adaptMsg } from "./adapt-msg.js"
import { getUserDataEventIdentity } from "../user-data-event-deduplicator.js"

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
    onEvent: (listener) => client.onEvent((message) => {
      if (!message || typeof message !== "object") return
      const subscriptionId = message.subscriptionId
      if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 0) return
      const event = message.event && typeof message.event === "object"
        ? message.event
        : message

      if (event.e === "eventStreamTerminated") {
        listener({
          type: "terminated",
          subscriptionId,
          eventTime: event.E ?? null,
          event,
        })
        return
      }

      listener({
        type: "event",
        subscriptionId,
        deduplicationKey: getUserDataEventIdentity(message),
        event: adaptMsg(event),
      })
    }),
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
