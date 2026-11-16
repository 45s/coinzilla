/**
 * Resolve pending migrations while enforcing the immutability of applied
 * migration identity (version + name).
 *
 * @param {...Array<{version: number, name: string}>} migrationLists
 * @returns {Array<object>}
 */
export function findPendingMigrations(...migrationLists) {
  const [registeredMigrations, appliedMigrations] = migrationLists
  const migrationByVersion = new Map(
    registeredMigrations.map((migration) => [migration.version, migration]),
  )

  for (const applied of appliedMigrations) {
    const registered = migrationByVersion.get(applied.version)
    if (!registered || registered.name !== applied.name) {
      throw new Error(
        `Migration history mismatch at version ${applied.version}`,
      )
    }
  }

  const appliedVersions = new Set(
    appliedMigrations.map(({ version }) => version),
  )

  return registeredMigrations.filter(
    ({ version }) => !appliedVersions.has(version),
  )
}
