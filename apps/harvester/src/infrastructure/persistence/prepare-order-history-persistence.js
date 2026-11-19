import {
  createDatabase,
  createSqliteProvider,
} from "@coinzilla/db"
import { defaultLogger } from "@coinzilla/utils"
import { createOrderHistoryRepository } from "./order-history-repository.js"
import { createOrderHistoryObserver } from "./create-order-history-observer.js"
import { assertHarvesterDatabaseIsolation } from "./resolve-harvester-database-filename.js"

function logPreparationFailure({ logger, error } = {}) {
  try {
    logger?.error?.({
      message: "Order history persistence is unavailable",
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    })
  } catch {
    // Optional persistence diagnostics must not prevent Harvester startup.
  }
}

/**
 * Prepare the optional environment-scoped SQLite order-history projection.
 *
 * @param {{tradingMode: string, env?: object, eventBus: object, logger?: object}} input
 * @returns {Promise<{database: object, observer: object}|null>}
 * @throws {never} Preparation failures disable this non-authoritative projection only.
 */
export async function prepareOrderHistoryPersistence({
  tradingMode,
  env = process.env,
  eventBus,
  logger = defaultLogger,
} = {}) {
  let database
  try {
    const filename = await assertHarvesterDatabaseIsolation({
      tradingMode,
      env,
    })
    database = createDatabase({
      provider: createSqliteProvider({
        filename,
        timeout: 5000,
      }),
    })
    await database.connect()
    const repository = createOrderHistoryRepository({
      database,
    })
    const observer = createOrderHistoryObserver({
      eventBus,
      repository,
      environment: tradingMode,
      logger,
    })
    return Object.freeze({
      database,
      observer,
    })
  } catch (error) {
    if (database && database.state !== "closed") {
      try {
        await database.close()
      } catch {
        // Preserve the original preparation failure as the primary diagnostic.
      }
    }
    logPreparationFailure({
      logger,
      error,
    })
    return null
  }
}
