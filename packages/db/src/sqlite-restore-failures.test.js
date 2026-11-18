import assert from "node:assert/strict"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError } from "./domain/errors/database-errors.js"
import { publishRestoreArtifact, publishRestoredDatabase, restoreSqliteDatabase } from "./infrastructure/sqlite/sqlite-restore.js"

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


test("SQLite restore reports post-publication cleanup failure without corrupting the published database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-restore-cleanup-"))
  const artifactDirectory = join(directory, "artifact")
  const artifactFilename = join(artifactDirectory, "restored.sqlite")
  const destinationFilename = join(directory, "published.sqlite")
  await import("node:fs/promises").then(({ mkdir }) => mkdir(artifactDirectory))
  const artifactDatabase = new DatabaseSync(artifactFilename)
  artifactDatabase.exec("CREATE TABLE retained_records (id INTEGER PRIMARY KEY)")
  artifactDatabase.prepare("INSERT INTO retained_records (id) VALUES (?)").run(42)
  artifactDatabase.close()
  const cleanupFailure = new Error("restore temporary cleanup failed")

  try {
    await assert.rejects(
      publishRestoreArtifact({
        artifact: {
          directory: artifactDirectory,
          filename: artifactFilename,
        },
        destinationFilename,
        cleanupTemporaryDirectory: async () => {
          throw cleanupFailure
        },
      }),
      (error) => error === cleanupFailure,
      "A cleanup failure after atomic publication must be reported with its original cause",
    )

    const restored = new DatabaseSync(destinationFilename, { readOnly: true })
    try {
      assert.equal(
        restored.prepare("SELECT id FROM retained_records").get().id,
        42,
        "A post-publication cleanup failure must not damage the already validated restored database",
      )
    } finally {
      restored.close()
    }
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite restore publication propagates non-conflict filesystem failures", async () => {
  const publicationFailure = Object.assign(
    new Error("restore publication I/O failure"),
    { code: "EIO" },
  )

  await assert.rejects(
    publishRestoredDatabase({
      temporaryFilename: "/temporary/restore.sqlite",
      destinationFilename: "/destination/restore.sqlite",
      linkOperation: async () => {
        throw publicationFailure
      },
    }),
    (error) => error === publicationFailure,
    "A non-conflict filesystem publication failure must be propagated without being mislabeled as a destination conflict",
  )
})
