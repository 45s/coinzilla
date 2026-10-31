import { formatNotification, NOTIFICATION_EVENT_NAMES } from "./format-notification.js"

export const TELEGRAM_NOTIFICATION_EVENTS = NOTIFICATION_EVENT_NAMES

function validateDependencies({ eventBus, notifier, logger }) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new TypeError("eventBus must expose subscribe()")
  }
  if (!notifier || typeof notifier.sendMessage !== "function") {
    throw new TypeError("notifier must expose sendMessage()")
  }
  if (logger !== undefined && (!logger || typeof logger !== "object" || (logger.error !== undefined && typeof logger.error !== "function"))) {
    throw new TypeError("logger.error must be a function when supplied")
  }
}

function reportSubscriptionFailure(logger, eventName, error) {
  if (typeof logger?.error !== "function") return
  try {
    logger.error({ message: "Telegram notification delivery failed", eventName, error })
  } catch (loggingError) {
    process.emitWarning("Telegram notification error logger failed", { detail: loggingError })
  }
}

/**
 * Subscribe a Telegram notifier to the package's explicit, low-volume event allowlist.
 * Delivery is serialized to preserve event order and naturally bounds in-flight HTTP calls.
 */
export function subscribeTelegramNotifications({ eventBus, notifier, logger } = {}) {
  validateDependencies({ eventBus, notifier, logger })

  let deliveryTail = Promise.resolve()
  let isClosed = false
  const subscriptions = []

  try {
    for (const eventName of TELEGRAM_NOTIFICATION_EVENTS) {
      const result = eventBus.subscribe({
        name: eventName,
        handler: (event) => {
          const delivery = deliveryTail.then(async () => {
            const message = formatNotification(event)
            if (message) await notifier.sendMessage(message)
          })
          deliveryTail = delivery.catch((error) => {
            reportSubscriptionFailure(logger, eventName, error)
          })
          return delivery
        },
      })

      if (!result?.ok || typeof result.subscription?.unsubscribe !== "function") {
        throw new Error(`Unable to subscribe to event: ${eventName}`)
      }
      subscriptions.push(result.subscription)
    }
  } catch (error) {
    isClosed = true
    for (const subscription of subscriptions) subscription.unsubscribe()
    throw error
  }

  return {
    async close() {
      if (!isClosed) {
        isClosed = true
        for (const subscription of subscriptions) subscription.unsubscribe()
      }
      await deliveryTail
    },
  }
}
