import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError } from "./domain/errors/database-errors.js"
import { assertRestoreDestinationIsNew, publishRestoreArtifact, publishRestoredDatabase, restoreSqliteDatabase } from "./infrastructure/sqlite/sqlite-restore.js"

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
  await mkdir(artifactDirectory)
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


test("SQLite restore classifies a missing backup source and publishes no destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-restore-missing-"))
  const backupFilename = join(directory, "missing.sqlite")
  const destinationFilename = join(directory, "restored.sqlite")

  try {
    await assert.rejects(
      restoreSqliteDatabase({
        backupFilename,
        filename: destinationFilename,
      }),
      (error) => error instanceof DatabaseProviderError && error.cause.code === "ENOENT",
      "A missing backup source must be reported as a provider failure with the filesystem cause",
    )
    await assert.rejects(
      stat(destinationFilename),
      (error) => error.code === "ENOENT",
      "A restore with a missing source must not create or publish a destination",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("restore destination checks propagate non-ENOENT filesystem failures", async () => {
  const filesystemFailure = Object.assign(
    new Error("destination metadata is inaccessible"),
    { code: "EACCES" },
  )

  await assert.rejects(
    assertRestoreDestinationIsNew({
      filename: "/destination/records.sqlite",
      realpathOperation: async () => {
        throw filesystemFailure
      },
    }),
    (error) => error === filesystemFailure,
    "A destination metadata error must not be mistaken for a missing destination",
  )
})

test("SQLite restore aggregates integrity and source-close failures", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-restore-integrity-close-"))
  const backupFilename = join(directory, "foreign-key-violation.sqlite")
  const destinationFilename = join(directory, "restored.sqlite")
  const backup = new DatabaseSync(backupFilename)
  backup.exec("PRAGMA foreign_keys = OFF")
  backup.exec("CREATE TABLE parents (id INTEGER PRIMARY KEY)")
  backup.exec("CREATE TABLE children (parent_id INTEGER REFERENCES parents(id))")
  backup.prepare("INSERT INTO children (parent_id) VALUES (?)").run(999)
  backup.close()

  const originalClose = DatabaseSync.prototype.close
  const closeFailure = new Error("source connection close failed after integrity failure")
  let failedConnection

  context.mock.method(DatabaseSync.prototype, "close", function close() {
    failedConnection = this
    throw closeFailure
  })

  try {
    await assert.rejects(
      restoreSqliteDatabase({
        backupFilename,
        filename: destinationFilename,
      }),
      (error) => error instanceof DatabaseProviderError
        && error.cause instanceof AggregateError
        && error.cause.errors[0] instanceof TypeError
        && error.cause.errors[1] === closeFailure,
      "Restore must preserve both the integrity failure and the subsequent source-close failure",
    )
  } finally {
    context.mock.restoreAll()
    if (failedConnection?.isOpen) {
      originalClose.call(failedConnection)
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("restore destination checks preserve TypeError failures from filesystem lookup", async () => {
  const filesystemFailure = new TypeError("invalid filesystem lookup argument")

  await assert.rejects(
    assertRestoreDestinationIsNew({
      filename: "/destination/records.sqlite",
      realpathOperation: async () => {
        throw filesystemFailure
      },
    }),
    (error) => error === filesystemFailure,
    "A TypeError raised by the filesystem lookup must not be mislabeled as an existing destination",
  )
})
