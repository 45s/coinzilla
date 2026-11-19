import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase } from "../../index.js"

test("legacy migration history upgrades without losing applied rows or application data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-migration-upgrade-"))
  const filename = join(directory, "legacy.sqlite")
  const migrations = [
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
  const database = createSqliteDatabase({
    filename,
  })

  try {
    await database.connect()
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
      null,
      "Existing migration rows without fingerprints must remain intact and explicitly unverified",
    )
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

    await database.close()

    const reconnectedDatabase = createSqliteDatabase({
      filename,
    })
    await reconnectedDatabase.connect()

    try {
      assert.deepEqual(
        await reconnectedDatabase.migrate(migrations),
        [],
        "Reconnecting to an upgraded database must not reapply previously recorded migrations",
      )
      assert.equal(
        reconnectedDatabase.prepare("SELECT COUNT(*) AS count FROM legacy_accounts").get().count,
        1,
        "Application data must persist after closing and reopening a migrated SQLite database",
      )
    } finally {
      await reconnectedDatabase.close()
    }
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
