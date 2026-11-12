import { subscribeTelegramNotifications } from "@coinzilla/notifiers"
import {
  formatHarvesterTelegramNotification,
  HARVESTER_TELEGRAM_NOTIFICATION_EVENTS,
} from "./format-telegram-notification.js"
import { HARVESTER_EVENT_NAMES, HARVESTER_EVENT_SOURCE } from "../../application/events/event-names.js"
import { resolveTelegramNotificationPolicy } from "./resolve-telegram-notification-policy.js"

const EVENT_MAPPINGS = Object.freeze({
  [HARVESTER_EVENT_NAMES.STARTED]: () => ({ name: "bot.started", data: {} }),
  [HARVESTER_EVENT_NAMES.STOPPED]: ({ data }) => ({
    name: "bot.stopped",
    data: { reason: data.reason, outcome: data.outcome },
  }),
  [HARVESTER_EVENT_NAMES.STARTUP_FAILED]: ({ data }) => ({
    name: "bot.startup_failed",
    data: { stage: data.stage, error: data.error },
  }),
  [HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED]: ({ data }) => ({
    name: "broker.disconnected",
    data: { broker: data.broker, error: data.error },
  }),
  [HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED]: ({ data }) => ({
    name: "account.safety_alert",
    data: {
      ...(data.market === undefined ? {} : { symbol: data.market }),
      category: "broker-subscription-failed",
      message: data.broker + " " + data.stream + " subscription failed: " + (data.error?.message ?? "unknown error"),
    },
  }),
  [HARVESTER_EVENT_NAMES.STRATEGY_PAUSED]: ({ data }) => ({
    name: "bot.pair_paused",
    data: { symbol: data.symbol, reason: data.reason },
  }),
  [HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_FAILED]: ({ data }) => ({
    name: "order.failed",
    data: {
      symbol: data.symbol,
      side: data.side,
      operation: "submission",
      outcome: data.outcome,
      error: data.error,
    },
  }),
  [HARVESTER_EVENT_NAMES.ORDER_CANCEL_FAILED]: ({ data }) => ({
    name: "order.failed",
    data: {
      symbol: data.symbol,
      side: data.side,
      operation: "cancellation",
      outcome: data.outcome,
      error: data.error,
    },
  }),
  [HARVESTER_EVENT_NAMES.FILL_APPLIED]: ({ data }) => ({
    name: "fill.received",
    data: {
      symbol: data.symbol,
      side: data.side,
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
  [HARVESTER_EVENT_NAMES.EXECUTION_UNOWNED_ORDER]: ({ data }) => ({
    name: "account.safety_alert",
    data: {
      symbol: data.symbol,
      category: "unowned-order",
      message: "An unowned or external order event was detected for " + data.symbol,
    },
  }),
  [HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL]: ({ data }) => ({
    name: "account.safety_alert",
    data: {
      symbol: data.symbol,
      category: "invalid-fill",
      message: data.symbol + " execution could not be safely reconciled: " + (data.error?.message ?? data.reason),
    },
  }),
  [HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED]: ({ data }) => {
    if (data.readiness !== "BLOCKED") {return null}
    const symbols = [...new Set((data.orders ?? []).map(({ symbol }) => symbol).filter(Boolean))]
    return {
      name: "account.safety_alert",
      data: {
        ...(symbols.length === 1 ? { symbol: symbols[0] } : {}),
        category: "account-open-orders-blocked",
        message: `Account-wide open-orders audit is BLOCKED (${data.orderCount} open order(s))${symbols.length > 0 ? ": " + symbols.join(", ") : ""}. ${(data.blockReasons ?? []).join("; ")}`,
      },
    }
  },
})

/**
 * Bridge Harvester-owned application events to the notifier package's stable
 * notification vocabulary. Harvester owns message formatting and policy;
 * Notifiers owns bounded queueing, transport and delivery.
 */
export async function subscribeHarvesterTelegramNotifications({
  eventBus,
  notifier,
  logger,
  telegramConfig,
} = {}) {
  const policy = resolveTelegramNotificationPolicy({ telegramConfig })
  const notificationEventBus = Object.freeze({
    subscribe: ({ name, handler }) => eventBus.subscribe({
      name,
      handler: (event) => {
        if (!policy.shouldNotify({ name: event.name, data: event.data })) {return}
        return handler(event)
      },
    }),
  })
  const notificationSubscriber = subscribeTelegramNotifications({
    eventBus: notificationEventBus,
    notifier,
    logger,
    eventNames: policy.eventNames,
    formatMessage: formatHarvesterTelegramNotification,
  })
  const subscriptions = []

  try {
    for (const [eventName, mapEvent] of Object.entries(EVENT_MAPPINGS)) {
      const result = eventBus.subscribe({
        name: eventName,
        handler: (event) => {
          const mapped = mapEvent(event)
          if (!mapped || !policy.shouldNotify(mapped)) {return}
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
    for (const subscription of subscriptions) {subscription.unsubscribe()}
    try {
      await notificationSubscriber.close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Telegram subscription setup and cleanup failed", { cause: cleanupError })
    }
    throw error
  }

  return Object.freeze({
    close: async () => {
      const errors = []
      for (const subscription of subscriptions) {
        try {
          const result = subscription.unsubscribe()
          if (result?.ok === false) {errors.push(new Error("Unable to unsubscribe Harvester Telegram event bridge"))}
        } catch (error) {
          errors.push(error)
        }
      }
      try {
        await notificationSubscriber.close()
      } catch (error) {
        errors.push(error)
      }
      if (errors.length > 0) {throw new AggregateError(errors, "Telegram notification shutdown was incomplete")}
    },
    getDiagnostics: notificationSubscriber.getDiagnostics,
    supportedEventNames: HARVESTER_TELEGRAM_NOTIFICATION_EVENTS,
  })
}
