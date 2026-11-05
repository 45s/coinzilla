import { createMigration } from "./domain/entities/migration.js"
import { findPendingMigrations } from "./domain/services/migration-history.js"

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function"
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
      return migration
    })
    .sort((left, right) => left.version - right.version)
}

/**
 * Apply ordered, synchronous SQL migrations atomically.
 *
 * @param {{exec: Function, transaction: Function}} database
 * @param {Array<{version: number, name: string, up: (transaction: {exec: Function, prepare: Function}) => void}>} migrations
 * @returns {Promise<number[]>} Newly applied migration versions.
 */
export async function migrateSqliteDatabase(database, migrations) {
  const orderedMigrations = validateMigrations(migrations)

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)

  return database.transaction((transaction) => {
    const appliedMigrations = transaction
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all()
    const pendingMigrations = findPendingMigrations(
      orderedMigrations,
      appliedMigrations,
    )
    const insertMigration = transaction.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
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
      )
      newlyApplied.push(migration.version)
    }

    return newlyApplied
  })
}
