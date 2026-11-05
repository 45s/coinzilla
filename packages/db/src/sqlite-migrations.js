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

  const validated = migrations.map((migration) => {
    if (!migration || typeof migration !== "object") {
      throw new TypeError("Each SQLite migration must be an object")
    }
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0 || versions.has(migration.version)) {
      throw new TypeError("SQLite migrations must have unique positive integer versions")
    }
    if (typeof migration.name !== "string" || migration.name.trim() === "" || names.has(migration.name)) {
      throw new TypeError("SQLite migration names must be non-empty and unique")
    }
    if (typeof migration.up !== "function") {
      throw new TypeError("Each SQLite migration must provide an up function")
    }
    if (migration.up.constructor?.name === "AsyncFunction") {
      throw new TypeError("SQLite migration up functions must be synchronous")
    }

    versions.add(migration.version)
    names.add(migration.name)

    return migration
  })

  return validated.sort((left, right) => left.version - right.version)
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
    const migrationByVersion = new Map(
      orderedMigrations.map((migration) => [migration.version, migration]),
    )

    for (const applied of appliedMigrations) {
      const migration = migrationByVersion.get(applied.version)
      if (!migration || migration.name !== applied.name) {
        throw new Error(
          `SQLite migration history mismatch at version ${applied.version}`,
        )
      }
    }

    const appliedVersions = new Set(
      appliedMigrations.map(({ version }) => version),
    )
    const insertMigration = transaction.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    )
    const newlyApplied = []

    for (const migration of orderedMigrations) {
      if (appliedVersions.has(migration.version)) continue

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
