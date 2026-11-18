import assert from "node:assert/strict"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError } from "./domain/errors/database-errors.js"
import { restoreSqliteDatabase } from "./infrastructure/sqlite/sqlite-restore.js"

test("SQLite restore preserves a source connection close failure and removes the staged artifact", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-restore-close-"))
  const backupFilename = join(directory, "backup.sqlite")
  const destinationFilename = join(directory, "restored.sqlite")
  const backup = new DatabaseSync(backupFilename)
  backup.exec("CREATE TABLE retained_records (id INTEGER PRIMARY KEY)")
  backup.prepare("INSERT INTO retained_records (id) VALUES (?)").run(1)
  backup.close()

  const originalClose = DatabaseSync.prototype.close
  const closeFailure = new Error("restore source connection close failed")
  let closeAttempts = 0
  let failedSourceConnection

  context.mock.method(DatabaseSync.prototype, "close", function close() {
    closeAttempts += 1
    if (closeAttempts === 2) {
      failedSourceConnection = this
      throw closeFailure
    }
    return originalClose.call(this)
  })

  try {
    await assert.rejects(
      restoreSqliteDatabase({
        backupFilename,
        filename: destinationFilename,
      }),
      (error) => error instanceof DatabaseProviderError && error.cause === closeFailure,
      "A source connection close failure must be reported without publishing an incomplete restore",
    )
    await assert.rejects(
      stat(destinationFilename),
      (error) => error.code === "ENOENT",
      "A restore whose source connection cannot close must remove its staged database and publish no destination",
    )
  } finally {
    context.mock.restoreAll()
    if (failedSourceConnection?.isOpen) {
      failedSourceConnection.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
