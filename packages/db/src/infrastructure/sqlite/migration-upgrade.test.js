import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase } from "../../index.js"

function createLegacyMigrations() {
  return [
    {
      version: 1,
      name: "create-legacy-accounts",
      up() {
        throw new Error("An already-applied legacy migration must never execute again")
      },
    },
    {
      version: 2,
      name: "add-account-status",
      up(transaction) {
        transaction.exec("ALTER TABLE legacy_accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
      },
    },
  ]
}

function createLegacySchema({ database }) {
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (1, 'create-legacy-accounts', '2026-11-18T12:00:00.000Z');
    CREATE TABLE legacy_accounts (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    INSERT INTO legacy_accounts (id, email) VALUES (7, 'legacy@example.test');
  `)
}

async function assertLegacyUpgrade({ database, migrations }) {
  assert.deepEqual(
    await database.migrate(migrations),
    [2],
    "Upgrading a legacy migration history must apply only the newly pending migration",
  )

  const history = database.prepare(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
  ).all().map((row) => ({ ...row }))

  assert.equal(
    history[0].checksum,
    "legacy-unverified",
    "Existing migration rows must retain an explicit marker when their original fingerprints cannot be reconstructed",
  )
  database.prepare(
    "UPDATE schema_migrations SET checksum = NULL WHERE version = ?",
  ).run(1)
  await assert.rejects(
    database.migrate(migrations),
    /checksum mismatch at version 1/,
    "Clearing a legacy migration marker must not bypass migration-history validation",
  )
  database.prepare(
    "UPDATE schema_migrations SET checksum = ? WHERE version = ?",
  ).run("legacy-unverified", 1)

  assert.match(
    history[1].checksum,
    /^[a-f0-9]{64}$/,
    "New migration history rows must store a SHA-256 implementation fingerprint",
  )
  assert.deepEqual(
    database.prepare("SELECT id, email, status FROM legacy_accounts").all().map((row) => ({ ...row })),
    [{
      id: 7,
      email: "legacy@example.test",
      status: "active",
    }],
    "Adding migration fingerprints must preserve existing application tables and their data",
  )
}

async function assertReconnectPersistence({ filename, migrations }) {
  const database = createSqliteDatabase({
    filename,
  })
  await database.connect()

  try {
    assert.deepEqual(
      await database.migrate(migrations),
      [],
      "Reconnecting to an upgraded database must not reapply previously recorded migrations",
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM legacy_accounts").get().count,
      1,
      "Application data must persist after closing and reopening a migrated SQLite database",
    )
  } finally {
    await database.close()
  }
}

test("legacy migration history upgrades without losing applied rows or application data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-migration-upgrade-"))
  const filename = join(directory, "legacy.sqlite")
  const migrations = createLegacyMigrations()
  const database = createSqliteDatabase({
    filename,
  })

  try {
    await database.connect()
    createLegacySchema({
      database,
    })
    await assertLegacyUpgrade({
      database,
      migrations,
    })
    await database.close()
    await assertReconnectPersistence({
      filename,
      migrations,
    })
  } finally {
    if (database.state !== "closed") {
      await database.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
