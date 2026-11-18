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

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql) {
    if (sql === "PRAGMA journal_mode = WAL") {
      throw initializationFailure
    }
    return originalExec.call(this, sql)
  })
  context.mock.method(DatabaseSync.prototype, "close", function close() {
    failedConnection = this
    throw cleanupFailure
  })

  try {
    await assert.rejects(
      database.connect(),
      (error) => error instanceof AggregateError
        && error.errors[0] === initializationFailure
        && error.errors[1] === cleanupFailure,
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


test("SQLite connection retries a transient WAL initialization lock within the configured timeout", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-wal-retry-"))
  const database = createSqliteDatabase({
    filename: join(directory, "records.sqlite"),
    timeout: 1_000,
  })
  const originalExec = DatabaseSync.prototype.exec
  const lockFailure = Object.assign(new Error("database is locked"), {
    errcode: 5,
  })
  let walAttempts = 0

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql) {
    if (sql === "PRAGMA journal_mode = WAL") {
      walAttempts += 1
      if (walAttempts === 1) {
        throw lockFailure
      }
    }
    return originalExec.call(this, sql)
  })

  try {
    await database.connect()
    assert.equal(walAttempts, 2)
    assert.equal(
      database.prepare("PRAGMA journal_mode").get().journal_mode,
      "wal",
      "A transient lock during WAL setup must be retried until the file-backed database is initialized",
    )
  } finally {
    context.mock.restoreAll()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("SQLite connection closes the native handle when WAL mode cannot be enabled", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-wal-unavailable-"))
  const database = createSqliteDatabase({
    filename: join(directory, "records.sqlite"),
  })
  const originalExec = DatabaseSync.prototype.exec
  let openedConnection

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql) {
    if (sql === "PRAGMA journal_mode = WAL") {
      openedConnection = this
      return
    }
    return originalExec.call(this, sql)
  })

  try {
    await assert.rejects(
      database.connect(),
      /failed to enable WAL journal mode/,
      "A file-backed database must not report a successful connection unless SQLite confirms WAL mode",
    )
    assert.equal(
      openedConnection.isOpen,
      false,
      "A connection whose WAL mode could not be enabled must close its partially initialized native handle",
    )
  } finally {
    context.mock.restoreAll()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite WAL initialization does not retry a lock after a zero-millisecond timeout", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-wal-zero-timeout-"))
  const database = createSqliteDatabase({
    filename: join(directory, "records.sqlite"),
    timeout: 0,
  })
  const originalExec = DatabaseSync.prototype.exec
  const lockFailure = Object.assign(new Error("database is locked"), {
    errcode: 5,
  })
  let walAttempts = 0

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql) {
    if (sql === "PRAGMA journal_mode = WAL") {
      walAttempts += 1
      throw lockFailure
    }
    return originalExec.call(this, sql)
  })

  try {
    await assert.rejects(
      database.connect(),
      (error) => error === lockFailure,
      "A zero timeout must surface the first SQLite WAL lock failure without retrying",
    )
    assert.equal(walAttempts, 1)
  } finally {
    context.mock.restoreAll()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
