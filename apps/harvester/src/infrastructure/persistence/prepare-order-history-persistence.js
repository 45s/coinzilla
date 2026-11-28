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

function createPreparationFailureLogDetails({ error, relational } = {}) {
  const details = {
    message: relational
      ? "Relational trading history is unavailable; legacy order history remains active"
      : "Order history persistence is unavailable",
    error,
    errorName: error?.name ?? "Error",
    errorCode: "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    causeCode: error?.code,
    errorMessage: error?.message ?? String(error),
  }
  details.errorContext = error?.context
  details.errorStage = error?.stage ?? error?.context?.stage
  return details
}

function logPreparationFailure({ logger, error, relational = false } = {}) {
  try {
    logger?.error?.(createPreparationFailureLogDetails({
      error,
      relational,
    }))
  } catch {
    // Optional persistence diagnostics must not prevent Harvester startup.
  }
}

function hasRelationalMigration({ database, version = 1 } = {}) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (!exists) {
    return false
  }
  return database.prepare(
    "SELECT 1 FROM schema_migrations WHERE version = ?",
  ).get(version) !== undefined
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
  if (hasRelationalMigration({ database })) {
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

function hashRelationalHistory(database) {
  const hash = createHash("sha256")
  let count = 0
  for (const table of ["orders", "fills", "fill_commissions"]) {
    const exists = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table)
    hash.update(table)
    hash.update("\\0")
    if (!exists) {
      continue
    }
    const rows = database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()
    count += rows.length
    for (const row of rows) {
      hash.update(JSON.stringify(row))
      hash.update("\\0")
    }
  }
  return {
    count,
    checksum: hash.digest("hex"),
  }
}

async function verifyOrderIdentityMigrationBackup({ filename, expected } = {}) {
  const backupDatabase = createSqliteDatabase({
    filename,
  })
  await backupDatabase.connect()
  try {
    const integrity = backupDatabase.prepare("PRAGMA integrity_check").get()
    if (integrity?.integrity_check !== "ok") {
      throw new Error("Pre-order-identity SQLite backup failed its integrity check.")
    }
    const actual = hashRelationalHistory(backupDatabase)
    if (actual.count !== expected.count || actual.checksum !== expected.checksum) {
      throw new Error("Pre-order-identity SQLite backup does not contain the exact relational trading-history rows.")
    }
  } finally {
    await backupDatabase.close()
  }
}

async function createVerifiedOrderIdentityMigrationBackup({ database, filename } = {}) {
  if (
    !hasRelationalMigration({
      database,
      version: 4,
    }) ||
    hasRelationalMigration({
      database,
      version: 5,
    })
  ) {
    return null
  }
  const sourceSnapshot = hashRelationalHistory(database)
  if (sourceSnapshot.count === 0) {
    return null
  }
  const backupFilename = `${filename}.pre-relational-v5.${sourceSnapshot.checksum}.backup`
  try {
    await access(backupFilename)
    await verifyOrderIdentityMigrationBackup({
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
    await verifyOrderIdentityMigrationBackup({
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

async function applyRelationalMigrations({ database, filename } = {}) {
  const legacyMigrationBackupFilename = await createVerifiedMigrationBackup({
    database,
    filename,
  })
  try {
    await database.migrate(HARVESTER_RELATIONAL_MIGRATIONS.slice(0, 4))
  } catch (error) {
    error.stage = "RELATIONAL_MIGRATION_V1_V4"
    throw error
  }
  let orderIdentityMigrationBackupFilename
  try {
    orderIdentityMigrationBackupFilename = await createVerifiedOrderIdentityMigrationBackup({
      database,
      filename,
    })
  } catch (error) {
    error.stage = "RELATIONAL_MIGRATION_V5_BACKUP"
    throw error
  }
  try {
    await database.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
  } catch (error) {
    Object.assign(error, {
      stage: "RELATIONAL_MIGRATION_V5",
      migrationBackupFilename: legacyMigrationBackupFilename ?? orderIdentityMigrationBackupFilename,
      orderIdentityMigrationBackupFilename,
    })
    throw error
  }
  return {
    migrationBackupFilename: legacyMigrationBackupFilename ?? orderIdentityMigrationBackupFilename,
    orderIdentityMigrationBackupFilename,
  }
}

function createRelationalResources({
  database,
  eventBus,
  environment,
  logger,
  runtimeSessionId,
  errorBuffer,
  partialResources,
} = {}) {
  const repositories = createRelationalHistoryRepositories({ database })
  const observers = createRelationalHistoryObservers({
    eventBus,
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    environment,
    logger,
  })
  partialResources.observers = observers
  const runtimeErrorObserver = createRuntimeErrorProjection({
    database,
    runtimeSessionId,
    errorBuffer,
    logger,
  })
  partialResources.runtimeErrorObserver = runtimeErrorObserver
  return {
    ...repositories,
    ...observers,
    runtimeErrorObserver,
  }
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
  let resources
  const partialResources = {}
  try {
    try {
      await relationalDatabase.connect()
    } catch (error) {
      error.stage = "RELATIONAL_DATABASE_CONNECT"
      throw error
    }
    const migrationBackups = await applyRelationalMigrations({
      database: relationalDatabase,
      filename,
    })
    resources = createRelationalResources({
      database: relationalDatabase,
      eventBus,
      environment,
      logger,
      runtimeSessionId,
      errorBuffer,
      partialResources,
    })
    return {
      relationalDatabase,
      ...resources,
      ...migrationBackups,
    }
  } catch (error) {
    error.stage ??= "RELATIONAL_RESOURCE_PREPARATION"
    await closePartialRelationalResources({
      database: relationalDatabase,
      observers: [
        partialResources.runtimeErrorObserver,
        partialResources.observers?.fillObserver,
        partialResources.observers?.relationalOrderObserver,
      ],
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
      migrationBackupFilename: relationalError.migrationBackupFilename ?? null,
      orderIdentityMigrationBackupFilename: relationalError.orderIdentityMigrationBackupFilename ?? null,
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
