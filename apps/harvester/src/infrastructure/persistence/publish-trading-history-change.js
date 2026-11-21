import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"

function reportNotificationFailure({ logger, errorCode, errorName } = {}) {
  try {
    logger?.warn?.({
      message: "Persisted trading-history change notification was not accepted.",
      errorCode,
      errorName,
    })
  } catch {
    // Realtime notification diagnostics must not affect successful persistence.
  }
}

/**
 * Publish a resource-only invalidation hint after a history upsert has succeeded.
 *
 * @param {{eventBus: object, resources: string[], logger?: object}} input
 * @returns {void}
 */
export function publishTradingHistoryChange({ eventBus, resources, logger } = {}) {
  if (!eventBus || typeof eventBus.publish !== "function") {
    reportNotificationFailure({
      logger,
      errorCode: "HARVESTER_TRADING_HISTORY_EVENT_BUS_UNAVAILABLE",
      errorName: "EventBusUnavailable",
    })
    return
  }
  try {
    const result = eventBus.publish({
      name: HARVESTER_EVENT_NAMES.TRADING_HISTORY_UPDATED,
      source: "harvester.trading-history-persistence",
      data: {
        resources,
      },
    })
    if (result?.ok !== true) {
      reportNotificationFailure({
        logger,
        errorCode: result?.errors?.[0]?.code ?? "HARVESTER_TRADING_HISTORY_EVENT_REJECTED",
        errorName: result?.errors?.[0]?.name ?? "EventBusPublicationRejected",
      })
    }
  } catch (error) {
    reportNotificationFailure({
      logger,
      errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_EVENT_PUBLISH_FAILED",
      errorName: error?.name ?? "Error",
    })
  }
}
