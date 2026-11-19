import { createHash } from "node:crypto"
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
  const backupDatabase = createSqliteDatabase({ filename })
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
  const expected = hashLegacyRecords(database)
  if (expected.count === 0) {
    return null
  }
  const backupFilename = `${filename}.pre-relational-v1.backup`
  await database.backup({ destination: backupFilename })
  await verifyMigrationBackup({ filename: backupFilename, expected })
  return backupFilename
}

async function prepareRelationalResources({ filename, eventBus, environment, logger } = {}) {
  const relationalDatabase = createSqliteDatabase({
    filename,
    timeout: 5000,
  })
  await relationalDatabase.connect()
  try {
    const migrationBackupFilename = await createVerifiedMigrationBackup({
      database: relationalDatabase,
      filename,
    })
    await relationalDatabase.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
    const orderRepository = createRelationalOrderHistoryRepository({
      database: relationalDatabase,
    })
    const fillRepository = createFillHistoryRepository({
      database: relationalDatabase,
    })
    const relationalOrderObserver = createOrderHistoryObserver({
      eventBus,
      repository: orderRepository,
      environment,
      logger,
    })
    const fillObserver = createFillHistoryObserver({
      eventBus,
      repository: fillRepository,
      environment,
      logger,
    })
    return {
      relationalDatabase,
      relationalOrderObserver,
      fillObserver,
      migrationBackupFilename,
    }
  } catch (error) {
    await relationalDatabase.close()
    throw error
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
} = {}) {
  let database
  try {
    const filename = await assertHarvesterDatabaseIsolation({ tradingMode, env })
    database = createDatabase({
      provider: createSqliteProvider({ filename, timeout: 5000 }),
    })
    await database.connect()
    const repository = createOrderHistoryRepository({ database })
    const observer = createOrderHistoryObserver({
      eventBus,
      repository,
      environment: tradingMode,
      logger,
    })
    try {
      const relational = await prepareRelationalResources({
        filename,
        eventBus,
        environment: tradingMode,
        logger,
      })
      return Object.freeze({ database, observer, ...relational, relationalError: null })
    } catch (relationalError) {
      logPreparationFailure({ logger, error: relationalError, relational: true })
      return Object.freeze({
        database,
        observer,
        relationalDatabase: null,
        relationalOrderObserver: null,
        fillObserver: null,
        migrationBackupFilename: null,
        relationalError,
      })
    }
  } catch (error) {
    if (database && database.state !== "closed") {
      try {
        await database.close()
      } catch {
        // Preserve the original preparation failure as the primary diagnostic.
      }
    }
    logPreparationFailure({ logger, error })
    return null
  }
}
