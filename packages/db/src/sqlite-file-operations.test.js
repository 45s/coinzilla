import assert from "node:assert/strict"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  assertDifferentFiles,
  removeTemporaryDirectory,
  validateIntegrity,
  verifyDatabaseFile,
} from "./infrastructure/sqlite/sqlite-file-operations.js"

async function createTemporaryDirectory() {
  return mkdtemp(join(tmpdir(), "coinzilla-db-file-operations-"))
}

test("SQLite integrity validation rejects non-ok integrity results", () => {
  const database = {
    prepare(sql) {
      return {
        all() {
          return sql === "PRAGMA integrity_check"
            ? [{ integrity_check: "database disk image is malformed" }]
            : []
        },
      }
    },
  }

  assert.throws(
    () => validateIntegrity(database),
    /integrity validation/,
    "A database whose integrity_check result is not exactly ok must be rejected",
  )
})

test("SQLite integrity validation rejects foreign-key violations", () => {
  const database = {
    prepare(sql) {
      return {
        all() {
          return sql === "PRAGMA integrity_check"
            ? [{ integrity_check: "ok" }]
            : [{
              table: "children",
              rowid: 1,
              parent: "parents",
              fkid: 0,
            }]
        },
      }
    },
  }

  assert.throws(
    () => validateIntegrity(database),
    /foreign-key violations/,
    "A database with any foreign-key violation must fail integrity validation",
  )
})

test("SQLite path comparison preserves non-ENOENT canonicalization failures", async () => {
  const directory = await createTemporaryDirectory()
  const sourceFilename = join(directory, "source.sqlite")
  const loopingDestination = join(directory, "looping-destination.sqlite")

  try {
    await writeFile(sourceFilename, "")
    await symlink(loopingDestination, loopingDestination)
    await assert.rejects(
      assertDifferentFiles({
        sourceFilename,
        destinationFilename: loopingDestination,
      }),
      (error) => error.code === "ELOOP",
      "A symlink loop must propagate its filesystem error instead of being treated as a missing destination",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("temporary-directory cleanup preserves both operation and cleanup failures", async () => {
  const directory = await createTemporaryDirectory()
  const operationFailure = new Error("database operation failed")
  const cleanupFailure = new Error("temporary directory cleanup failed")

  try {
    await assert.rejects(
      removeTemporaryDirectory({
        directory,
        operationError: operationFailure,
        remove: async () => {
          throw cleanupFailure
        },
      }),
      (error) => error instanceof AggregateError
        && error.errors[0] === operationFailure
        && error.errors[1] === cleanupFailure
        && error.cause === cleanupFailure,
      "Cleanup failure must retain both the original operation error and the cleanup error",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("temporary-directory cleanup propagates cleanup failure when no operation failed", async () => {
  const directory = await createTemporaryDirectory()
  const cleanupFailure = new Error("temporary directory cleanup failed")

  try {
    await assert.rejects(
      removeTemporaryDirectory({
        directory,
        remove: async () => {
          throw cleanupFailure
        },
      }),
      (error) => error === cleanupFailure,
      "A standalone cleanup failure must be propagated without inventing an operation error",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("SQLite verification preserves integrity and close failures", async (context) => {
  const directory = await createTemporaryDirectory()
  const filename = join(directory, "verification.sqlite")
  const source = new DatabaseSync(filename)
  source.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)")
  source.close()

  const originalPrepare = DatabaseSync.prototype.prepare
  const originalClose = DatabaseSync.prototype.close
  const integrityFailure = new Error("SQLite integrity verification failed")
  const closeFailure = new Error("SQLite verification connection close failed")
  let verificationConnection

  context.mock.method(DatabaseSync.prototype, "prepare", function prepare(sql) {
    if (sql === "PRAGMA integrity_check") {
      verificationConnection = this
      throw integrityFailure
    }
    return originalPrepare.call(this, sql)
  })
  context.mock.method(DatabaseSync.prototype, "close", function close() {
    if (this === verificationConnection) {
      throw closeFailure
    }
    return originalClose.call(this)
  })

  try {
    assert.throws(
      () => verifyDatabaseFile({ filename, timeout: 100 }),
      (error) => error instanceof AggregateError
        && error.errors[0] === integrityFailure
        && error.errors[1] === closeFailure
        && error.cause === integrityFailure,
      "A verification close failure must not mask the original integrity failure",
    )
  } finally {
    context.mock.restoreAll()
    if (verificationConnection?.isOpen) {
      originalClose.call(verificationConnection)
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
