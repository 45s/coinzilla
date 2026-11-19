import { createHash } from "node:crypto"

import { createMigration } from "../../domain/entities/migration.js"
import { findPendingMigrations } from "../../domain/services/migration-history.js"

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function"
}

function compareMigrationVersions(...migrations) {
  const [left, right] = migrations
  return left.version - right.version
}

function createMigrationChecksum(migration) {
  const source = Function.prototype.toString.call(migration.up)
  return createHash("sha256").update(source).digest("hex")
}

function validateMigrations(migrations) {
  if (!Array.isArray(migrations)) {
    throw new TypeError("SQLite migrations must be an array")
  }

  const versions = new Set()
  const names = new Set()

  return migrations
    .map((definition) => {
      if (!definition || typeof definition !== "object") {
        throw new TypeError("Each SQLite migration must be an object")
      }

      const migration = createMigration(definition)
      if (versions.has(migration.version)) {
        throw new TypeError("SQLite migrations must have unique positive integer versions")
      }
      if (names.has(migration.name)) {
        throw new TypeError("SQLite migration names must be non-empty and unique")
      }

      versions.add(migration.version)
      names.add(migration.name)
      return Object.freeze({
        ...migration,
        checksum: createMigrationChecksum(migration),
      })
    })
    .sort(compareMigrationVersions)
}

function ensureMigrationChecksumColumn(transaction) {
  const columns = transaction.prepare("PRAGMA table_info(schema_migrations)").all()
  const hasChecksumColumn = columns.some(({ name }) => name === "checksum")

  if (!hasChecksumColumn) {
    transaction.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT DEFAULT 'legacy-unverified'")
  }
}

/**
 * Apply ordered, synchronous SQL migrations atomically.
 *
 * Applied migration checksums identify the source text of each synchronous
 * migration callback. Legacy history rows retain a null checksum because
 * their original implementation cannot be reconstructed safely.
 *
 * @param {{database: {exec: Function, transaction: Function}, migrations: Array<{version: number, name: string, up: (transaction: {exec: Function, prepare: Function}) => void}>}} options
 * @returns {Promise<number[]>} Newly applied migration versions.
 */
export async function migrateSqliteDatabase({ database, migrations }) {
  const orderedMigrations = validateMigrations(migrations)

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    )
  `)

  return database.transaction((transaction) => {
    ensureMigrationChecksumColumn(transaction)

    const appliedMigrations = transaction
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all()
    const pendingMigrations = findPendingMigrations(
      orderedMigrations,
      appliedMigrations,
    )
    const insertMigration = transaction.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
    )
    const newlyApplied = []

    for (const migration of pendingMigrations) {
      const result = migration.up(transaction)
      if (isThenable(result)) {
        Promise.resolve(result).catch(() => {})
        throw new TypeError("SQLite migration up functions must be synchronous")
      }

      insertMigration.run(
        migration.version,
        migration.name,
        new Date().toISOString(),
        migration.checksum,
      )
      newlyApplied.push(migration.version)
    }

    return newlyApplied
  })
}
