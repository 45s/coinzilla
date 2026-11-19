function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

/**
 * Record polling-backed broker observations as diagnostics only.
 * This handler deliberately has no access to user-data state, order accounting,
 * the event publisher, or trading-engine readiness.
 *
 * @param {{logger?: object}} options
 * @returns {(message: {observation: object}) => void}
 */
export function createUserDataObservationHandler({ logger = {} } = {}) {
  return ({ observation } = {}) => {
    if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
      logSystem({
        logger,
        message: "Ignored malformed non-authoritative broker user-data observation",
      })
      return
    }

    const symbols = Array.isArray(observation.symbols)
      ? observation.symbols
        .map((entry) => entry?.symbol)
        .filter((symbol) => typeof symbol === "string")
      : []
    logSystem({
      logger,
      message: "Received non-authoritative broker user-data observation",
      deliveryMode: observation.mode === "POLLING" ? "POLLING_OBSERVATIONS" : "UNKNOWN",
      observedAt: Number.isSafeInteger(observation.observedAt) ? observation.observedAt : null,
      sourceTime: Number.isSafeInteger(observation.sourceTime) ? observation.sourceTime : null,
      symbols,
      balanceCount: Array.isArray(observation.balances) ? observation.balances.length : 0,
      trackedOrderCount: Array.isArray(observation.matchingOrderObservations)
        ? observation.matchingOrderObservations.length
        : 0,
    })
  }
}
