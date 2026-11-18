import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase } from "../src/index.js"

test("SQLite connection initialization preserves both setup and cleanup failures", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-connect-cleanup-"))
  const database = createSqliteDatabase({
    filename: join(directory, "records.sqlite"),
  })
  const originalExec = DatabaseSync.prototype.exec
  const initializationFailure = new Error("WAL initialization failed")
  const cleanupFailure = new Error("partial connection cleanup failed")
  let failedConnection

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql, ...parameters) {
    if (sql === "PRAGMA journal_mode = WAL") {
      throw initializationFailure
    }
    return originalExec.call(this, sql, ...parameters)
  })
  context.mock.method(DatabaseSync.prototype, "close", function close(...parameters) {
    failedConnection = this
    throw cleanupFailure
  })

  try {
    await assert.rejects(
      database.connect(),
      (error) => error instanceof AggregateError
        && error.errors[0] === initializationFailure
        && error.errors[1] === cleanupFailure
        && error.cause === initializationFailure,
      "A failed cleanup must not replace the original SQLite initialization failure",
    )
  } finally {
    context.mock.restoreAll()
    if (failedConnection?.isOpen) {
      failedConnection.close()
    }
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
