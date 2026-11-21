import { createHash } from "node:crypto"
import { access } from "node:fs/promises"
import {
  createDatabase,
  createSqliteDatabase,
  createSqliteProvider,
} from "@coinzilla/db"
import { defaultLogger } from "@coinzilla/utils"
import { createOrderHistoryRepository } from "./order-history-repository.js"
import { createOrderHistoryObserver } from "./create-order-history-observer.js"
import { createRelationalOrderHistoryRepository } from "./relational-order-repository.js"
import { createFillHistoryRepository } from "./fill-history-repository.js"
import { createFillHistoryObserver } from "./create-fill-history-observer.js"
import { createHistorySyncCursorRepository } from "./history-sync-cursor-repository.js"
import { createRuntimeErrorRepository } from "./runtime-error-repository.js"
import { createRuntimeErrorObserver } from "./create-runtime-error-observer.js"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "./relational-migrations.js"
import { assertHarvesterDatabaseIsolation } from "./resolve-harvester-database-filename.js"

function logPreparationFailure({ logger, error, relational = false } = {}) {
  try {
    logger?.error?.({
      message: relational
        ? "Relational trading history is unavailable; legacy order history remains active"
        : "Order history persistence is unavailable",
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    })
  } catch {
    // Optional persistence diagnostics must not prevent Harvester startup.
  }
}

function hasRelationalMigration(database) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (!exists) {
    return false
  }
  return database.prepare(
    "SELECT 1 FROM schema_migrations WHERE version = ?",
  ).get(1) !== undefined
}

function hashLegacyRecords(database) {
  const records = database.prepare(
    "SELECT id, record FROM db_records WHERE collection = ? ORDER BY id",
  ).all("harvester_orders")
  const hash = createHash("sha256")
  for (const record of records) {
    hash.update(record.id)
    hash.update("\0")
    hash.update(record.record)
    hash.update("\0")
  }
  return {
    count: records.length,
    checksum: hash.digest("hex"),
  }
}

async function verifyMigrationBackup({ filename, expected } = {}) {
  const backupDatabase = createSqliteDatabase({
    filename,
  })
  await backupDatabase.connect()
  try {
    const integrity = backupDatabase.prepare("PRAGMA integrity_check").get()
    if (integrity?.integrity_check !== "ok") {
      throw new Error("Pre-migration SQLite backup failed its integrity check.")
    }
    const actual = hashLegacyRecords(backupDatabase)
    if (actual.count !== expected.count || actual.checksum !== expected.checksum) {
      throw new Error("Pre-migration SQLite backup does not contain the exact legacy order-history records.")
    }
  } finally {
    await backupDatabase.close()
  }
}

async function createVerifiedMigrationBackup({ database, filename } = {}) {
  if (hasRelationalMigration(database)) {
    return null
  }
  const sourceSnapshot = hashLegacyRecords(database)
  if (sourceSnapshot.count === 0) {
    return null
  }
  const backupFilename = `${filename}.pre-relational-v1.${sourceSnapshot.checksum}.backup`
  try {
    await access(backupFilename)
    await verifyMigrationBackup({
      filename: backupFilename,
      expected: sourceSnapshot,
    })
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error
    }
    await database.backup({
      destination: backupFilename,
    })
    await verifyMigrationBackup({
      filename: backupFilename,
      expected: sourceSnapshot,
    })
  }
  return backupFilename
}

async function closePartialRelationalResources({
  database,
  observers,
  logger,
} = {}) {
  for (const observer of observers) {
    try {
      await observer?.close()
    } catch (error) {
      logPreparationFailure({
        logger,
        error,
        relational: true,
      })
    }
  }
  if (database.state !== "closed") {
    try {
      await database.close()
    } catch (error) {
      logPreparationFailure({
        logger,
        error,
        relational: true,
      })
    }
  }
}

function createRelationalHistoryObservers({
  eventBus,
  orderRepository,
  fillRepository,
  environment,
  logger,
} = {}) {
  return {
    relationalOrderObserver: createOrderHistoryObserver({
      eventBus,
      repository: orderRepository,
      environment,
      logger,
    }),
    fillObserver: createFillHistoryObserver({
      eventBus,
      repository: fillRepository,
      environment,
      logger,
    }),
  }
}

function createRelationalHistoryRepositories({ database } = {}) {
  return {
    orderRepository: createRelationalOrderHistoryRepository({ database }),
    fillRepository: createFillHistoryRepository({ database }),
    historySyncCursorRepository: createHistorySyncCursorRepository({ database }),
  }
}

function createRuntimeErrorProjection({
  database,
  runtimeSessionId,
  errorBuffer,
  logger,
} = {}) {
  if (!errorBuffer || !runtimeSessionId) {
    return null
  }
  const repository = createRuntimeErrorRepository({
    database,
    runtimeSessionId,
  })
  return createRuntimeErrorObserver({
    repository,
    errorBuffer,
    logger,
  })
}

async function prepareRelationalResources({
  filename,
  eventBus,
  environment,
  logger,
  runtimeSessionId,
  errorBuffer,
} = {}) {
  const relationalDatabase = createSqliteDatabase({
    filename,
    timeout: 5000,
  })
  let relationalOrderObserver
  let fillObserver
  let runtimeErrorObserver
  try {
    await relationalDatabase.connect()
    const migrationBackupFilename = await createVerifiedMigrationBackup({
      database: relationalDatabase,
      filename,
    })
    await relationalDatabase.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
    const repositories = createRelationalHistoryRepositories({
      database: relationalDatabase,
    })
    const observers = createRelationalHistoryObservers({
      eventBus,
      orderRepository: repositories.orderRepository,
      fillRepository: repositories.fillRepository,
      environment,
      logger,
    })
    relationalOrderObserver = observers.relationalOrderObserver
    fillObserver = observers.fillObserver
    runtimeErrorObserver = createRuntimeErrorProjection({
      database: relationalDatabase,
      runtimeSessionId,
      errorBuffer,
      logger,
    })
    return {
      relationalDatabase,
      ...observers,
      runtimeErrorObserver,
      ...repositories,
      migrationBackupFilename,
    }
  } catch (error) {
    await closePartialRelationalResources({
      database: relationalDatabase,
      observers: [runtimeErrorObserver, fillObserver, relationalOrderObserver],
      logger,
    })
    throw error
  }
}

async function createLegacyPersistence({
  filename,
  environment,
  eventBus,
  logger,
} = {}) {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename,
      timeout: 5000,
    }),
  })
  try {
    await database.connect()
    const repository = createOrderHistoryRepository({
      database,
    })
    const observer = createOrderHistoryObserver({
      eventBus,
      repository,
      environment,
      logger,
    })
    return {
      database,
      observer,
    }
  } catch (error) {
    if (database.state !== "closed") {
      try {
        await database.close()
      } catch {
        // Preserve the original legacy persistence preparation failure.
      }
    }
    throw error
  }
}

async function preparePersistenceWithRelationalFallback({
  legacyPersistence,
  filename,
  eventBus,
  environment,
  logger,
  runtimeSessionId,
  errorBuffer,
} = {}) {
  try {
    const relational = await prepareRelationalResources({
      filename,
      eventBus,
      environment,
      logger,
      runtimeSessionId,
      errorBuffer,
    })
    return Object.freeze({
      ...legacyPersistence,
      ...relational,
      relationalError: null,
    })
  } catch (relationalError) {
    logPreparationFailure({
      logger,
      error: relationalError,
      relational: true,
    })
    return Object.freeze({
      ...legacyPersistence,
      relationalDatabase: null,
      relationalOrderObserver: null,
      fillObserver: null,
      runtimeErrorObserver: null,
      orderRepository: null,
      fillRepository: null,
      historySyncCursorRepository: null,
      migrationBackupFilename: null,
      relationalError,
    })
  }
}

/**
 * Prepare legacy order history and its optional relational trading-history projection.
 *
 * @param {{tradingMode: string, env?: object, eventBus: object, logger?: object}} input
 * @returns {Promise<object|null>} Legacy persistence plus optional relational resources.
 * @throws {never} Persistence failures remain visible but do not block trading startup.
 */
export async function prepareOrderHistoryPersistence({
  tradingMode,
  env = process.env,
  eventBus,
  logger = defaultLogger,
  runtimeSessionId,
  errorBuffer,
} = {}) {
  try {
    const filename = await assertHarvesterDatabaseIsolation({
      tradingMode,
      env,
    })
    const legacyPersistence = await createLegacyPersistence({
      filename,
      environment: tradingMode,
      eventBus,
      logger,
    })
    return preparePersistenceWithRelationalFallback({
      legacyPersistence,
      filename,
      eventBus,
      environment: tradingMode,
      logger,
      runtimeSessionId,
      errorBuffer,
    })
  } catch (error) {
    logPreparationFailure({
      logger,
      error,
    })
    return null
  }
}
