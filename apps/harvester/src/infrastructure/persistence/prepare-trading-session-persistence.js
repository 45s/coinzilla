import { createDatabase, createSqliteProvider } from "@coinzilla/db"
import { createTradingSessionRepository } from "./trading-session-repository.js"
import { assertTradingSessionDatabaseIsolation } from "./resolve-trading-session-database-filename.js"

const SQLITE_TIMEOUT_MS = 5_000

function reportPersistenceFailure({ logger, stage, error }) {
  try {
    logger?.error?.({
      message: "Ordinary trading-session history is unavailable; Harvester continues without this non-authoritative history store.",
      persistenceStage: stage,
      errorName: error?.name ?? "Error",
      errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
    })
  } catch {
    // Optional historical reporting diagnostics must not affect trading startup.
  }
}

async function closeAfterPreparationFailure({ database, logger }) {
  if (!database || database.state === "closed") {
    return
  }
  try {
    await database.close()
  } catch (error) {
    reportPersistenceFailure({
      logger,
      stage: "close-after-prepare-failure",
      error,
    })
  }
}

export async function prepareTradingSessionPersistence({
  tradingMode,
  env,
  logger,
  createDatabase: createDatabaseFactory = createDatabase,
  createSqliteProvider: createSqliteProviderFactory = createSqliteProvider,
} = {}) {
  let database
  try {
    const filename = await assertTradingSessionDatabaseIsolation({
      tradingMode,
      env,
    })
    database = createDatabaseFactory({
      provider: createSqliteProviderFactory({
        filename,
        timeout: SQLITE_TIMEOUT_MS,
      }),
    })
    await database.connect()
    return {
      database,
      repository: createTradingSessionRepository({ database }),
    }
  } catch (error) {
    reportPersistenceFailure({
      logger,
      stage: "prepare",
      error,
    })
    await closeAfterPreparationFailure({
      database,
      logger,
    })
    return null
  }
}
