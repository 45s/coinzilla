import assert from "node:assert/strict"
import test from "node:test"

import { createSqliteDatabase } from "../src/index.js"

async function createConnectedDatabase() {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()
  return database
}

test("SQLite rejects nested transactions without damaging the outer connection", async () => {
  const database = await createConnectedDatabase()
  let nestedTransaction

  try {
    await database.transaction(() => {
      nestedTransaction = database.transaction(() => "must-not-run")
    })

    await assert.rejects(
      nestedTransaction,
      /Nested SQLite transactions are not supported/,
      "A nested transaction must reject instead of opening a second SQLite transaction",
    )
    assert.equal(
      database.prepare("SELECT 1 AS value").get().value,
      1,
      "Rejecting a nested transaction must leave the outer connection usable",
    )
  } finally {
    await database.close()
  }
})

test("SQLite transaction statements and iterators cannot escape their transaction", async () => {
  const database = await createConnectedDatabase()
  let escapedStatement
  let escapedIterator

  try {
    await database.transaction((transaction) => {
      escapedStatement = transaction.prepare("SELECT 1 AS value")
      escapedIterator = escapedStatement.iterate()
      assert.equal(
        escapedIterator.next().value.value,
        1,
        "A guarded iterator must return rows while its transaction remains active",
      )
      assert.equal(
        escapedIterator.return().done,
        true,
        "A guarded iterator must support early termination inside its active transaction",
      )
      assert.equal(
        escapedIterator.throw(new Error("stop iteration")),
        undefined,
        "A guarded iterator must preserve the underlying iterator throw behavior",
      )
    })

    assert.throws(
      () => escapedStatement.get(),
      /no longer active/,
      "A prepared statement retained after commit must reject further database access",
    )
    assert.throws(
      () => escapedIterator.next(),
      /no longer active/,
      "An iterator retained after commit must reject further row access",
    )
  } finally {
    await database.close()
  }
})

test("SQLite rolls back when a returned thenable throws while its then property is inspected", async () => {
  const database = await createConnectedDatabase()
  const callbackFailure = new Error("then property inspection failed")
  const thenable = Object.defineProperty({}, "then", {
    get() {
      throw callbackFailure
    },
  })

  try {
    await database.exec("CREATE TABLE guarded_entries (id INTEGER PRIMARY KEY)")
    await assert.rejects(
      database.transaction((transaction) => {
        transaction.exec("INSERT INTO guarded_entries (id) VALUES (1)")
        return thenable
      }),
      (error) => error === callbackFailure,
      "A throwing then getter must preserve its original error while aborting the transaction",
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM guarded_entries").get().count,
      0,
      "A transaction whose result cannot be inspected must roll back all writes",
    )
  } finally {
    await database.close()
  }
})
