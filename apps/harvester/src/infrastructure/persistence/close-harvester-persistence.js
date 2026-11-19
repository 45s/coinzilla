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

async function closeObserver({ observer, logger, stage } = {}) {
  if (typeof observer?.close !== "function") {
    return []
  }
  try {
    const result = await observer.close()
    return result?.ok === false && Array.isArray(result.errors) ? result.errors : []
  } catch (cause) {
    const error = new OrderHistoryPersistenceError({ stage, cause })
    reportCloseFailure({ logger, error, stage })
    return [error]
  }
}

async function closeDatabase({ database, logger, stage } = {}) {
  if (typeof database?.close !== "function" || database.state === "closed") {
    return []
  }
  try {
    await database.close()
    return []
  } catch (cause) {
    const error = new OrderHistoryPersistenceError({ stage, cause })
    reportCloseFailure({ logger, error, stage })
    return [error]
  }
}

/**
 * Drain every projection observer before closing either SQLite connection.
 *
 * @param {{observer?: object, relationalOrderObserver?: object, fillObserver?: object, database?: object, relationalDatabase?: object, logger?: object}} input
 * @returns {Promise<Error[]>} Cleanup failures for process shutdown diagnostics.
 */
export async function closeHarvesterPersistence({
  observer,
  relationalOrderObserver,
  fillObserver,
  database,
  relationalDatabase,
  logger,
} = {}) {
  const errors = []
  errors.push(...await closeObserver({ observer, logger, stage: "legacy-observer-close" }))
  errors.push(...await closeObserver({ observer: relationalOrderObserver, logger, stage: "relational-order-observer-close" }))
  errors.push(...await closeObserver({ observer: fillObserver, logger, stage: "fill-observer-close" }))
  errors.push(...await closeDatabase({ database, logger, stage: "legacy-database-close" }))
  errors.push(...await closeDatabase({ database: relationalDatabase, logger, stage: "relational-database-close" }))
  return errors
}
