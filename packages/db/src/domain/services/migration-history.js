/**
 * Resolve pending migrations while enforcing applied identity, implementation
 * fingerprints, and ascending migration order.
 *
 * Legacy applied rows with a null checksum retain version/name validation;
 * new rows are checked against their registered migration source fingerprint.
 *
 * @param {...Array<{version: number, name: string, checksum?: string|null}>} migrationLists
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

    if (applied.checksum && applied.checksum !== registered.checksum) {
      throw new Error(
        `Migration checksum mismatch at version ${applied.version}`,
      )
    }
  }

  const appliedVersions = new Set(
    appliedMigrations.map(({ version }) => version),
  )
  const latestAppliedVersion = Math.max(0, ...appliedVersions)
  const pendingOutOfOrderMigration = registeredMigrations.find(
    ({ version }) => version < latestAppliedVersion && !appliedVersions.has(version),
  )

  if (pendingOutOfOrderMigration) {
    throw new Error(
      `Migration history is out of order: pending version ${pendingOutOfOrderMigration.version} precedes applied version ${latestAppliedVersion}`,
    )
  }

  return registeredMigrations.filter(
    ({ version }) => !appliedVersions.has(version),
  )
}
