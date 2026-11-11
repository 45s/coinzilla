import {
  formatTelegramNotification,
  TELEGRAM_NOTIFICATION_EVENT_NAMES,
} from "./format-telegram-notification.js"

const DEFAULT_MAX_PENDING = 1000

export const TELEGRAM_NOTIFICATION_EVENTS = TELEGRAM_NOTIFICATION_EVENT_NAMES

function validateEventNames(eventNames) {
  if (!Array.isArray(eventNames)) {
    throw new TypeError("eventNames must be an array of supported Telegram event names")
  }
  if (eventNames.length === 0) {
    throw new RangeError("eventNames must contain at least one supported Telegram event")
  }

  const seen = new Set()
  for (const eventName of eventNames) {
    if (typeof eventName !== "string" || !eventName.trim()) {
      throw new TypeError("Every event name must be a non-empty string")
    }
    if (!TELEGRAM_NOTIFICATION_EVENTS.includes(eventName)) {
      throw new TypeError(`Unsupported Telegram notification event: ${eventName}`)
    }
    if (seen.has(eventName)) {
      throw new TypeError(`Duplicate Telegram notification event: ${eventName}`)
    }
    seen.add(eventName)
  }

  return Object.freeze([...eventNames])
}

function validateDependencies({ eventBus, notifier, logger, maxPending, eventNames }) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new TypeError("eventBus must expose subscribe()")
  }
  if (!notifier || typeof notifier.sendMessage !== "function") {
    throw new TypeError("notifier must expose sendMessage()")
  }
  if (
    logger !== undefined &&
    (!logger ||
      typeof logger !== "object" ||
      (logger.error !== undefined && typeof logger.error !== "function"))
  ) {
    throw new TypeError("logger.error must be a function when supplied")
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new RangeError("maxPending must be a positive safe integer")
  }
  return validateEventNames(eventNames)
}

function emitWarningSafely(message, error) {
  try {
    process.emitWarning(message, { detail: error })
  } catch {
    // A diagnostic fallback must never poison the delivery queue.
  }
}

function reportDeliveryFailure(logger, eventName, error) {
  if (typeof logger?.error !== "function") return false

  try {
    logger.error({
      message: "Telegram notification delivery failed",
      eventName,
      error,
    })
    return true
  } catch (loggingError) {
    emitWarningSafely(
      "Telegram notification error logger failed",
      loggingError,
    )
    return false
  }
}

function unsubscribeAll(subscriptions) {
  const errors = []

  for (const subscription of subscriptions) {
    try {
      const result = subscription.unsubscribe()
      if (result?.ok === false) {
        throw new Error("Event bus rejected notification unsubscription")
      }
    } catch (error) {
      errors.push(error)
    }
  }

  return errors
}

/**
 * Attach a Telegram notifier to a fixed allowlist of low-volume operational events.
 * Sends are serialized and admission-controlled; flush the event bus before close().
 */
export function subscribeTelegramNotifications({
  eventBus,
  notifier,
  logger,
  maxPending = DEFAULT_MAX_PENDING,
  eventNames = TELEGRAM_NOTIFICATION_EVENTS,
} = {}) {
  const selectedEventNames = validateDependencies({ eventBus, notifier, logger, maxPending, eventNames })

  let deliveryTail = Promise.resolve()
  let pendingCount = 0
  let acceptedCount = 0
  let deliveredCount = 0
  let failedCount = 0
  let overflowCount = 0
  let isClosed = false
  let closePromise
  const subscriptions = []

  try {
    for (const eventName of selectedEventNames) {
      const result = eventBus.subscribe({
        name: eventName,
        handler: (event) => {
          // EventBus may already have scheduled a handler when unsubscribe occurs.
          // Do not accept newly-started callbacks after close has begun.
          if (isClosed) return Promise.resolve()

          if (pendingCount >= maxPending) {
            overflowCount += 1
            const error = new Error(
              `Telegram notification queue capacity exceeded (maxPending=${maxPending})`,
            )
            if (reportDeliveryFailure(logger, eventName, error)) {
              return Promise.resolve()
            }
            return Promise.reject(error)
          }

          pendingCount += 1
          acceptedCount += 1

          const delivery = deliveryTail.then(async () => {
            const message = formatTelegramNotification(event)
            if (message) {
              await notifier.sendMessage(message)
              deliveredCount += 1
            }
          })

          const observedDelivery = delivery.catch((error) => {
            failedCount += 1
            if (!reportDeliveryFailure(logger, eventName, error)) {
              throw error
            }
          })

          const completedDelivery = observedDelivery.finally(() => {
            pendingCount -= 1
          })

          // Keep the internal queue usable after a failed send. When no logger is
          // supplied, the returned rejection is left for EventBus.onError/logger.
          deliveryTail = completedDelivery.catch(() => undefined)
          return completedDelivery
        },
      })

      if (!result?.ok || typeof result.subscription?.unsubscribe !== "function") {
        throw new Error(`Unable to subscribe to event: ${eventName}`)
      }

      subscriptions.push(result.subscription)
    }
  } catch (error) {
    isClosed = true
    const cleanupErrors = unsubscribeAll(subscriptions)
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Unable to subscribe to Telegram notifications and cleanup was incomplete",
        { cause: error },
      )
    }
    throw error
  }

  return {
    /** Return a frozen snapshot of queue and delivery counters. */
    getDiagnostics() {
      return Object.freeze({
        acceptedCount,
        deliveredCount,
        failedCount,
        overflowCount,
        pendingCount,
        closed: isClosed,
      })
    },
    close() {
      if (closePromise) return closePromise

      isClosed = true
      const cleanupErrors = unsubscribeAll(subscriptions)

      closePromise = (async () => {
        await deliveryTail
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            "Unable to clean up every Telegram event subscription",
          )
        }
      })()

      return closePromise
    },
  }
}
