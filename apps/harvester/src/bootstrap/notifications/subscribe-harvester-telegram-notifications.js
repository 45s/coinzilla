import {
  subscribeTelegramNotifications,
  TELEGRAM_NOTIFICATION_EVENTS,
} from "@coinzilla/notifiers"
import { HARVESTER_EVENT_NAMES, HARVESTER_EVENT_SOURCE } from "../../application/events/event-names.js"

const EVENT_MAPPINGS = Object.freeze({
  [HARVESTER_EVENT_NAMES.STARTED]: ({ data }) => ({ name: "bot.started", data: {} }),
  [HARVESTER_EVENT_NAMES.STOPPED]: ({ data }) => ({
    name: "bot.stopped",
    data: { reason: data.reason, outcome: data.outcome },
  }),
  [HARVESTER_EVENT_NAMES.STRATEGY_PAUSED]: ({ data }) => ({
    name: "bot.pair_paused",
    data: { symbol: data.symbol, reason: data.reason },
  }),
  [HARVESTER_EVENT_NAMES.FILL_APPLIED]: ({ data }) => ({
    name: "fill.received",
    data: {
      symbol: data.symbol,
      fill: { price: data.price, quantity: data.quantity, tradeId: data.tradeId },
    },
  }),
  [HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED]: ({ data }) => ({
    name: "bot.recovery_completed",
    data: {
      message: data.symbol + " recovery completed; net profit " + data.realizedNetProfit +
        "; retained quantity " + data.freeQuantity,
    },
  }),
  [HARVESTER_EVENT_NAMES.EXECUTION_ACCOUNTING_FAILED]: ({ data }) => ({
    name: "bot.recovery_failed",
    data: { message: data.symbol + " execution accounting failed: " + data.error?.message },
  }),
})

/**
 * Bridge Harvester-owned application events to the notifier package's stable
 * notification vocabulary. The package owns formatting, queuing and delivery.
 */
export async function subscribeHarvesterTelegramNotifications({
  eventBus,
  notifier,
  logger,
} = {}) {
  const notificationSubscriber = subscribeTelegramNotifications({
    eventBus,
    notifier,
    logger,
  })
  const subscriptions = []

  try {
    for (const [eventName, mapEvent] of Object.entries(EVENT_MAPPINGS)) {
      const result = eventBus.subscribe({
        name: eventName,
        handler: (event) => {
          const mapped = mapEvent(event)
          const publishResult = eventBus.publish({
            name: mapped.name,
            source: HARVESTER_EVENT_SOURCE,
            data: mapped.data,
          })
          if (publishResult?.ok !== true) {
            throw publishResult?.errors?.[0] ?? new Error("Unable to publish Telegram notification event")
          }
        },
      })
      if (result?.ok !== true || typeof result.subscription?.unsubscribe !== "function") {
        throw result?.errors?.[0] ?? new Error("Unable to subscribe Harvester Telegram event bridge")
      }
      subscriptions.push(result.subscription)
    }
  } catch (error) {
    for (const subscription of subscriptions) subscription.unsubscribe()
    try {
      await notificationSubscriber.close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Telegram subscription setup and cleanup failed", { cause: error })
    }
    throw error
  }

  return Object.freeze({
    close: async () => {
      const errors = []
      for (const subscription of subscriptions) {
        try {
          const result = subscription.unsubscribe()
          if (result?.ok === false) errors.push(new Error("Unable to unsubscribe Harvester Telegram event bridge"))
        } catch (error) {
          errors.push(error)
        }
      }
      try {
        await notificationSubscriber.close()
      } catch (error) {
        errors.push(error)
      }
      if (errors.length > 0) throw new AggregateError(errors, "Telegram notification shutdown was incomplete")
    },
    getDiagnostics: notificationSubscriber.getDiagnostics,
    supportedEventNames: TELEGRAM_NOTIFICATION_EVENTS,
  })
}
