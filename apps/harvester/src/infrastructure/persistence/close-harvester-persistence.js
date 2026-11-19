import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"

function reportCloseFailure({ logger, error, stage } = {}) {
  try {
    logger?.error?.({
      message: "Order history persistence cleanup failed",
      persistenceStage: stage,
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    })
  } catch {
    // Cleanup diagnostics must not prevent later resources from closing.
  }
}

/**
 * Drain the order-history observer before closing its SQLite database.
 *
 * @param {{observer?: object, database?: object, logger?: object}} input
 * @returns {Promise<Error[]>} Cleanup failures that should be included in process shutdown diagnostics.
 */
export async function closeHarvesterPersistence({
  observer,
  database,
  logger,
} = {}) {
  const errors = []
  if (observer && typeof observer.close === "function") {
    try {
      const result = await observer.close()
      if (result?.ok === false && Array.isArray(result.errors)) {
        errors.push(...result.errors)
      }
    } catch (cause) {
      const error = new OrderHistoryPersistenceError({
        stage: "observer-close",
        cause,
      })
      errors.push(error)
      reportCloseFailure({
        logger,
        error,
        stage: "observer-close",
      })
    }
  }
  if (database && typeof database.close === "function" && database.state !== "closed") {
    try {
      await database.close()
    } catch (cause) {
      const error = new OrderHistoryPersistenceError({
        stage: "database-close",
        cause,
      })
      errors.push(error)
      reportCloseFailure({
        logger,
        error,
        stage: "database-close",
      })
    }
  }
  return errors
}
