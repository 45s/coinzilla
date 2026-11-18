import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError } from "./domain/errors/database-errors.js"
import { removeTemporaryDirectory } from "./infrastructure/sqlite/sqlite-file-operations.js"
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
        cleanupTemporaryDirectory: async ({ directory: temporaryPath, operationError }) => {
          temporaryDirectory = temporaryPath
          return removeTemporaryDirectory({
            directory: temporaryPath,
            operationError,
            remove: async () => {
              throw cleanupFailure
            },
          })
        },
      }),
      (error) => error instanceof DatabaseProviderError
        && error.cause instanceof AggregateError
        && error.cause.errors.length === 2
        && error.cause.errors[0] === progressFailure
        && error.cause.errors[1] === cleanupFailure,
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


test("SQLite backup validates closed source connections and invalid timeouts", async () => {
  const source = new DatabaseSync(":memory:")
  const closedSource = new DatabaseSync(":memory:")
  closedSource.close()

  try {
    await assert.rejects(
      backupSqliteDatabase({
        sourceConnection: closedSource,
        sourceFilename: ":memory:",
        destination: join(tmpdir(), "closed-source-backup.sqlite"),
      }),
      /open source connection/,
      "A backup must reject a closed native source connection before allocating temporary files",
    )
    await assert.rejects(
      backupSqliteDatabase({
        sourceConnection: source,
        sourceFilename: ":memory:",
        destination: join(tmpdir(), "invalid-timeout-backup.sqlite"),
        timeout: -1,
      }),
      /timeout/,
      "A backup must reject a negative or unsafe native SQLite timeout",
    )
  } finally {
    source.close()
  }
})

test("SQLite backup reports temporary directory creation failure without attempting cleanup", async () => {
  const directory = await createTemporaryDirectory()
  const source = new DatabaseSync(":memory:")
  const temporaryDirectoryFailure = new Error("backup temporary directory creation failed")

  try {
    await assert.rejects(
      backupSqliteDatabase({
        sourceConnection: source,
        sourceFilename: ":memory:",
        destination: join(directory, "backup.sqlite"),
        createTemporaryDirectory: async () => {
          throw temporaryDirectoryFailure
        },
      }),
      (error) => error instanceof DatabaseProviderError
        && error.cause === temporaryDirectoryFailure,
      "A temporary directory creation failure must be preserved without attempting cleanup of a directory that does not exist",
    )
  } finally {
    source.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
