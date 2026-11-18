import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { createSqliteDatabase } from "../src/index.js"

async function createConnectedDatabase() {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()
  database.exec("CREATE TABLE transaction_records (id INTEGER PRIMARY KEY)")
  return database
}

test("SQLite rolls back when COMMIT fails and preserves the commit error", async (context) => {
  const database = await createConnectedDatabase()
  const originalExec = DatabaseSync.prototype.exec
  const commitFailure = new Error("native COMMIT failed")

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql) {
    if (sql === "COMMIT") {
      throw commitFailure
    }
    return originalExec.call(this, sql)
  })

  try {
    await assert.rejects(
      database.transaction((transaction) => {
        transaction.exec("INSERT INTO transaction_records (id) VALUES (1)")
      }),
      (error) => error === commitFailure,
      "A commit failure must remain the reported error after a successful rollback",
    )
  } finally {
    context.mock.restoreAll()
  }

  try {
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM transaction_records").get().count,
      0,
      "A failed COMMIT must roll back all transaction writes",
    )
    assert.equal(
      database.state,
      "connected",
      "A commit failure followed by a successful rollback must leave the connection usable",
    )
  } finally {
    await database.close()
  }
})

test("SQLite aggregates the work and rollback errors when rollback itself fails", async (context) => {
  const database = await createConnectedDatabase()
  const originalExec = DatabaseSync.prototype.exec
  const workFailure = new Error("transaction work failed")
  const rollbackFailure = new Error("native ROLLBACK failed")

  context.mock.method(DatabaseSync.prototype, "exec", function exec(sql) {
    if (sql === "ROLLBACK") {
      throw rollbackFailure
    }
    return originalExec.call(this, sql)
  })

  try {
    await assert.rejects(
      database.transaction((transaction) => {
        transaction.exec("INSERT INTO transaction_records (id) VALUES (1)")
        throw workFailure
      }),
      (error) => error instanceof AggregateError
        && error.errors[0] === workFailure
        && error.errors[1] === rollbackFailure
        && error.cause === workFailure,
      "A rollback failure must not hide the original work failure or the rollback failure",
    )
  } finally {
    context.mock.restoreAll()
  }

  try {
    database.exec("ROLLBACK")
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM transaction_records").get().count,
      0,
      "The test must explicitly recover the native connection after injecting a rollback failure",
    )
  } finally {
    await database.close()
  }
})
