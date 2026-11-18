import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { backupSqliteDatabase } from "./infrastructure/sqlite/sqlite-backup.js"

async function createTemporaryDirectory() {
  return mkdtemp(join(tmpdir(), "coinzilla-db-backup-failure-"))
}

test("SQLite backup aggregates a progress callback failure with a temporary cleanup failure exactly once", async () => {
  const directory = await createTemporaryDirectory()
  const sourceFilename = join(directory, "source.sqlite")
  const destinationFilename = join(directory, "existing-backup.sqlite")
  const source = new DatabaseSync(sourceFilename)
  const existingBackup = new DatabaseSync(destinationFilename)
  const progressFailure = new Error("backup progress callback failed")
  const cleanupFailure = new Error("backup temporary cleanup failed")
  let temporaryDirectory

  try {
    source.exec("PRAGMA journal_mode = WAL")
    source.exec("CREATE TABLE backup_records (id INTEGER PRIMARY KEY, payload BLOB)")
    source.prepare("INSERT INTO backup_records (payload) VALUES (?)").run(
      Buffer.alloc(2 * 1024 * 1024, 5),
    )
    existingBackup.exec("CREATE TABLE preserved_records (id INTEGER PRIMARY KEY)")
    existingBackup.prepare("INSERT INTO preserved_records (id) VALUES (?)").run(42)
    existingBackup.close()

    await assert.rejects(
      backupSqliteDatabase({
        sourceConnection: source,
        sourceFilename,
        destination: destinationFilename,
        rate: 1,
        progress() {
          throw progressFailure
        },
        cleanupTemporaryDirectory: async ({ directory: temporaryPath }) => {
          temporaryDirectory = temporaryPath
          throw cleanupFailure
        },
      }),
      (error) => error instanceof AggregateError
        && error.errors.length === 2
        && error.errors[0] === progressFailure
        && error.errors[1] === cleanupFailure,
      "The aggregate failure must preserve the progress and cleanup errors once each in causal order",
    )
  } finally {
    source.close()
    if (temporaryDirectory) {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      })
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
