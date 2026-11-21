const TRADING_HISTORY_UPDATED_EVENT = "trading-history.updated"

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

function getNotificationFailure(result) {
  if (result?.ok === true) {
    return null
  }
  const error = result?.error ?? result?.errors?.[0]
  return {
    errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_EVENT_REJECTED",
    errorName: error?.name ?? "EventBusPublicationRejected",
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
      name: TRADING_HISTORY_UPDATED_EVENT,
      source: "harvester.trading-history-persistence",
      data: {
        resources,
      },
    })
    const failure = getNotificationFailure(result)
    if (failure) {
      reportNotificationFailure({
        logger,
        ...failure,
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
