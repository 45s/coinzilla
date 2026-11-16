const DEFAULT_MAX_PENDING = 1000

function validateEventNames(eventNames) {
  if (!Array.isArray(eventNames)) {
    throw new TypeError("eventNames must be an array of application event names")
  }
  if (eventNames.length === 0) {
    throw new RangeError("eventNames must contain at least one application event")
  }

  const seen = new Set()
  for (const eventName of eventNames) {
    if (typeof eventName !== "string" || !eventName.trim()) {
      throw new TypeError("Every event name must be a non-empty string")
    }
    if (seen.has(eventName)) {
      throw new TypeError(`Duplicate notification event: ${eventName}`)
    }
    seen.add(eventName)
  }

  return Object.freeze([...eventNames])
}

function validateDependencies({ eventBus, notifier, formatMessage, logger, maxPending, eventNames }) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new TypeError("eventBus must expose subscribe()")
  }
  if (typeof formatMessage !== "function") {
    throw new TypeError("formatMessage must be a function supplied by the consuming application")
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

function emitWarningSafely({ message, error }) {
  try {
    process.emitWarning(message, { detail: error })
  } catch {
    // A diagnostic fallback must never poison the delivery queue.
  }
}

function reportDeliveryFailure({ logger, eventName, error }) {
  if (typeof logger?.error !== "function") {
    return false
  }

  try {
    logger.error({
      message: "Telegram notification delivery failed",
      eventName,
      error,
    })
    return true
  } catch (loggingError) {
    emitWarningSafely({
      message: "Telegram notification error logger failed",
      error: loggingError,
    })
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

function createDeliveryHandler({
  eventName,
  state,
  notifier,
  logger,
  maxPending,
  formatMessage,
}) {
  return (event) => {
    if (state.isClosed) {
      return Promise.resolve()
    }
    if (state.pendingCount >= maxPending) {
      state.overflowCount += 1
      const error = new Error(
        `Telegram notification queue capacity exceeded (maxPending=${maxPending})`,
      )
      if (reportDeliveryFailure({ logger, eventName, error })) {
        return Promise.resolve()
      }
      return Promise.reject(error)
    }
    state.pendingCount += 1
    state.acceptedCount += 1
    const delivery = state.deliveryTail.then(async () => {
      const message = formatMessage(event)
      if (message) {
        await notifier.sendMessage(message)
        state.deliveredCount += 1
      }
    })
    const observedDelivery = delivery.catch((error) => {
      state.failedCount += 1
      if (!reportDeliveryFailure({ logger, eventName, error })) {
        throw error
      }
    })
    const completedDelivery = observedDelivery.finally(() => {
      state.pendingCount -= 1
    })
    state.deliveryTail = completedDelivery.catch(() => undefined)
    return completedDelivery
  }
}

/**
 * Deliver application-formatted messages for application-selected events through Telegram.
 * Sends are serialized and admission-controlled; flush the event bus before close().
 */
export function subscribeTelegramNotifications({
  eventBus,
  notifier,
  logger,
  maxPending = DEFAULT_MAX_PENDING,
  eventNames,
  formatMessage,
} = {}) {
  const selectedEventNames = validateDependencies({ eventBus, notifier, formatMessage, logger, maxPending, eventNames })

  const state = {
    deliveryTail: Promise.resolve(),
    pendingCount: 0,
    acceptedCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    overflowCount: 0,
    isClosed: false,
  }
  let closePromise
  const subscriptions = []

  try {
    for (const eventName of selectedEventNames) {
      const result = eventBus.subscribe({
        name: eventName,
        handler: createDeliveryHandler({
          eventName,
          state,
          notifier,
          logger,
          maxPending,
          formatMessage,
        }),
      })

      if (!result?.ok || typeof result.subscription?.unsubscribe !== "function") {
        throw new Error(`Unable to subscribe to event: ${eventName}`)
      }

      subscriptions.push(result.subscription)
    }
  } catch (error) {
    state.isClosed = true
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
        acceptedCount: state.acceptedCount,
        deliveredCount: state.deliveredCount,
        failedCount: state.failedCount,
        overflowCount: state.overflowCount,
        pendingCount: state.pendingCount,
        closed: state.isClosed,
      })
    },
    close() {
      if (closePromise) {
        return closePromise
      }

      state.isClosed = true
      const cleanupErrors = unsubscribeAll(subscriptions)

      closePromise = (async () => {
        await state.deliveryTail
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
