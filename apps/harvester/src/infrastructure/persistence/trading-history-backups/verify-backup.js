import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises"
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path"
import {
  createSqliteDatabase,
  restoreSqliteDatabase,
} from "@coinzilla/db"
import { OrderHistoryPersistenceError } from "../order-history-persistence-error.js"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "../relational-migrations.js"
import { resolveHarvesterDatabaseFilename } from "../resolve-harvester-database-filename.js"

const REQUIRED_TABLES = Object.freeze([
  "orders",
  "fills",
  "fill_commissions",
  "history_sync_cursors",
])
const ENVIRONMENT_TABLES = Object.freeze([
  "orders",
  "fills",
  "history_sync_cursors",
])
const MANIFEST_FORMAT_VERSION = 1
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function createBackupError({ stage, code, cause, environment, backupFilename } = {}) {
  return new OrderHistoryPersistenceError({
    stage,
    code,
    cause,
    context: {
      environment,
      ...(backupFilename ? { backupFilename: basename(backupFilename) } : {}),
    },
  })
}

export function resolveBackupDirectory({ tradingMode, env = process.env } = {}) {
  const databaseFilename = resolveHarvesterDatabaseFilename({
    tradingMode,
    env,
  })
  const databaseRoot = dirname(dirname(databaseFilename))
  const environmentDirectory = tradingMode === "live" ? "production" : "testnet"
  return join(databaseRoot, "backups", environmentDirectory)
}

export async function calculateSha256(filename) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

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

async function assertRegularFile(filename, { stage, code, environment } = {}) {
  let stats
  try {
    stats = await lstat(filename)
  } catch (cause) {
    throw createBackupError({
      stage,
      code,
      cause,
      environment,
      backupFilename: filename,
    })
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw createBackupError({
      stage,
      code,
      environment,
      backupFilename: filename,
    })
  }
}

function validateManifest({ manifest, backupFilename, environment } = {}) {
  const latestSchemaVersion = HARVESTER_RELATIONAL_MIGRATIONS.at(-1)?.version ?? 0
  const validTimestamp = typeof manifest?.createdAt === "string" &&
    Number.isFinite(Date.parse(manifest.createdAt)) &&
    new Date(manifest.createdAt).toISOString() === manifest.createdAt
  const validManifest = manifest?.formatVersion === MANIFEST_FORMAT_VERSION &&
    manifest.environment === environment &&
    manifest.filename === basename(backupFilename) &&
    Number.isSafeInteger(manifest.schemaVersion) &&
    manifest.schemaVersion >= 0 &&
    manifest.schemaVersion <= latestSchemaVersion &&
    validTimestamp &&
    typeof manifest.sha256 === "string" &&
    SHA256_PATTERN.test(manifest.sha256)
  if (!validManifest) {
    throw createBackupError({
      stage: "manifest-validation",
      code: manifest?.environment !== environment
        ? "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH"
        : "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      environment,
      backupFilename,
    })
  }
}

export async function readAndValidateManifest({
  backupFilename,
  backupDirectory,
  environment,
} = {}) {
  const resolvedFilename = resolve(backupFilename)
  const resolvedDirectory = resolve(backupDirectory)
  if (dirname(resolvedFilename) !== resolvedDirectory) {
    throw createBackupError({
      stage: "manifest-path-validation",
      code: "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
      environment,
      backupFilename: resolvedFilename,
    })
  }
  await assertRegularFile(resolvedDirectory, {
    stage: "manifest-directory-validation",
    code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
    environment,
  }).catch((error) => {
    if (error instanceof OrderHistoryPersistenceError) {
      throw error
    }
    throw error
  })
  const backupDirectoryStats = await lstat(resolvedDirectory)
  if (backupDirectoryStats.isSymbolicLink() || !backupDirectoryStats.isDirectory()) {
    throw createBackupError({
      stage: "manifest-directory-validation",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      environment,
      backupFilename: resolvedFilename,
    })
  }
  await assertRegularFile(resolvedFilename, {
    stage: "backup-file-validation",
    code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
    environment,
  })
  const manifestFilename = `${resolvedFilename}.manifest.json`
  await assertRegularFile(manifestFilename, {
    stage: "manifest-file-validation",
    code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
    environment,
  })
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestFilename, "utf8"))
  } catch (cause) {
    throw createBackupError({
      stage: "manifest-read",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      cause,
      environment,
      backupFilename: resolvedFilename,
    })
  }
  validateManifest({
    manifest,
    backupFilename: resolvedFilename,
    environment,
  })
  const actualDigest = await calculateSha256(resolvedFilename)
  if (actualDigest !== manifest.sha256) {
    throw createBackupError({
      stage: "digest-validation",
      code: "HARVESTER_HISTORY_BACKUP_DIGEST_MISMATCH",
      environment,
      backupFilename: resolvedFilename,
    })
  }
  return {
    backupFilename: resolvedFilename,
    manifestFilename,
    manifest,
  }
}

function assertEnvironmentRows(database, environment) {
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

function readRowCounts(database) {
  return Object.fromEntries(REQUIRED_TABLES.map((tableName) => [
    tableName,
    database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
  ]))
}

async function restoreAndValidate({
  backupFilename,
  temporaryDirectory,
  manifest,
  environment,
} = {}) {
  const restoredFilename = join(temporaryDirectory, "restored-history.sqlite")
  let database
  let connected = false
  let result
  let failure
  try {
    await restoreSqliteDatabase({
      backupFilename,
      filename: restoredFilename,
    })
    database = createSqliteDatabase({
      filename: restoredFilename,
    })
    await database.connect()
    connected = true
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
    assertEnvironmentRows(database, environment)
    result = {
      environment,
      schemaVersion,
      rowCounts: readRowCounts(database),
    }
  } catch (cause) {
    failure = cause instanceof OrderHistoryPersistenceError
      ? cause
      : createBackupError({
        stage: "restore-validation",
        code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
        cause,
        environment,
        backupFilename,
      })
  }
  if (connected) {
    try {
      await database.close()
    } catch (cause) {
      failure = failure
        ? new AggregateError([failure, cause], "Restore candidate close failed.")
        : createBackupError({
          stage: "restore-close",
          code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
          cause,
          environment,
          backupFilename,
        })
    }
  }
  if (failure) {
    throw failure
  }
  return result
}

export async function verifyBackup({
  backupFilename,
  env = process.env,
  expectedDirectory,
} = {}) {
  const environment = env.TRADING_MODE
  if (environment !== "testnet" && environment !== "live") {
    throw createBackupError({
      stage: "environment-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_ENVIRONMENT",
      environment,
      backupFilename,
    })
  }
  const backupDirectory = expectedDirectory ?? resolveBackupDirectory({
    tradingMode: environment,
    env,
  })
  const validated = await readAndValidateManifest({
    backupFilename,
    backupDirectory,
    environment,
  })
  const temporaryDirectory = await mkdtemp(join(backupDirectory, ".restore-check-"))
  let result
  let failure
  try {
    result = await restoreAndValidate({
      backupFilename: validated.backupFilename,
      temporaryDirectory,
      manifest: validated.manifest,
      environment,
    })
  } catch (cause) {
    failure = cause
  }
  try {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    })
  } catch (cause) {
    failure = failure
      ? new AggregateError([failure, cause], "Restore candidate cleanup failed.")
      : createBackupError({
        stage: "restore-cleanup",
        code: "HARVESTER_HISTORY_BACKUP_CLEANUP_FAILED",
        cause,
        environment,
        backupFilename,
      })
  }
  if (failure) {
    throw failure instanceof OrderHistoryPersistenceError
      ? failure
      : createBackupError({
        stage: "restore-verification",
        code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
        cause: failure,
        environment,
        backupFilename,
      })
  }
  return {
    ...result,
    backupFilename: validated.backupFilename,
    verified: true,
  }
}
