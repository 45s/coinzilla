import { createBackupError } from "./errors.js"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "../relational-migrations.js"

const REQUIRED_TABLES = Object.freeze([
  "orders",
  "fills",
  "fill_commissions",
  "history_sync_cursors",
  "runtime_errors",
])
const ENVIRONMENT_TABLES = Object.freeze([
  "orders",
  "fills",
  "history_sync_cursors",
  "runtime_errors",
])

function readAppliedMigrationVersions(database) {
  const migrationTable = database.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get("schema_migrations")
  if (!migrationTable) {
    return []
  }
  return database.prepare(
    "SELECT version FROM schema_migrations ORDER BY version",
  ).all().map((row) => row.version)
}

export function readSchemaVersion(database) {
  const versions = readAppliedMigrationVersions(database)
  return versions.at(-1) ?? 0
}

export function assertCurrentSchema(database) {
  const expectedVersions = HARVESTER_RELATIONAL_MIGRATIONS.map(
    (migration) => migration.version,
  )
  const actualVersions = readAppliedMigrationVersions(database)
  if (JSON.stringify(actualVersions) !== JSON.stringify(expectedVersions)) {
    throw createBackupError({
      stage: "schema-validation",
      code: "HARVESTER_HISTORY_BACKUP_SCHEMA_INVALID",
    })
  }
  for (const tableName of REQUIRED_TABLES) {
    const table = database.prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(tableName)
    if (!table) {
      throw createBackupError({
        stage: "schema-validation",
        code: "HARVESTER_HISTORY_BACKUP_SCHEMA_INVALID",
      })
    }
  }
  return expectedVersions.at(-1) ?? 0
}

function assertEnvironmentRows({ database, environment } = {}) {
  for (const tableName of ENVIRONMENT_TABLES) {
    const mismatch = database.prepare(
      `SELECT COUNT(*) AS count FROM ${tableName} WHERE environment <> ?`,
    ).get(environment)
    if (mismatch.count > 0) {
      throw createBackupError({
        stage: "environment-data-validation",
        code: "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
        environment,
      })
    }
  }
}

function readRowCounts({ database } = {}) {
  return Object.fromEntries(REQUIRED_TABLES.map((tableName) => [
    tableName,
    database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
  ]))
}

export async function validateRestoredDatabase({
  database,
  manifest,
  environment,
  backupFilename,
} = {}) {
  const restoredSchemaVersion = readSchemaVersion(database)
  if (restoredSchemaVersion !== manifest.schemaVersion) {
    throw createBackupError({
      stage: "restore-schema-validation",
      code: "HARVESTER_HISTORY_BACKUP_SCHEMA_INVALID",
      environment,
      backupFilename,
    })
  }
  await database.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
  const schemaVersion = assertCurrentSchema(database)
  const integrity = database.prepare("PRAGMA integrity_check").get()?.integrity_check
  if (integrity !== "ok") {
    throw createBackupError({
      stage: "restore-integrity-validation",
      code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
      environment,
      backupFilename,
    })
  }
  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all()
  if (foreignKeyViolations.length > 0) {
    throw createBackupError({
      stage: "restore-foreign-key-validation",
      code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
      environment,
      backupFilename,
    })
  }
  assertEnvironmentRows({
    database,
    environment,
  })
  return {
    environment,
    schemaVersion,
    rowCounts: readRowCounts({
      database,
    }),
  }
}
