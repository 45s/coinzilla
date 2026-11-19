import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase, restoreSqliteDatabase } from "../../index.js"

function createRelationalMigration() {
  return {
    version: 1,
    name: "create-sample-entities",
    up(transaction) {
      transaction.exec(`
        CREATE TABLE sample_entities (
          id INTEGER PRIMARY KEY,
          external_key TEXT NOT NULL UNIQUE
        )
      `)
    },
  }
}

async function createMigratedBackup({ sourceFilename, backupFilename, migration }) {
  const database = createSqliteDatabase({
    filename: sourceFilename,
  })

  try {
    await database.connect()
    assert.deepEqual(
      await database.migrate([migration]),
      [1],
      "A fresh file-backed database must apply its initial relational schema migration",
    )
    database.prepare(
      "INSERT INTO sample_entities (id, external_key) VALUES (?, ?)",
    ).run(42, "sample-key-42")
    await database.backup({
      destination: backupFilename,
    })
  } finally {
    await database.close()
  }
}

async function assertRestoredSchema({ backupFilename, restoredFilename, migration }) {
  await restoreSqliteDatabase({
    backupFilename,
    filename: restoredFilename,
  })

  const database = createSqliteDatabase({
    filename: restoredFilename,
  })
  await database.connect()

  try {
    assert.deepEqual(
      await database.migrate([migration]),
      [],
      "Restoring a migrated backup must preserve the migration fingerprint and prevent schema replay",
    )
    assert.deepEqual(
      database.prepare(
        "SELECT id, external_key FROM sample_entities",
      ).all().map((row) => ({ ...row })),
      [{
        id: 42,
        external_key: "sample-key-42",
      }],
      "Restoring a migrated backup must preserve application-owned relational table data",
    )
  } finally {
    await database.close()
  }
}

test("SQLite backup and restore preserve application tables and migration history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-migrated-backup-"))
  const sourceFilename = join(directory, "source.sqlite")
  const backupFilename = join(directory, "backup.sqlite")
  const restoredFilename = join(directory, "restored.sqlite")
  const migration = createRelationalMigration()

  try {
    await createMigratedBackup({
      sourceFilename,
      backupFilename,
      migration,
    })
    await assertRestoredSchema({
      backupFilename,
      restoredFilename,
      migration,
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
