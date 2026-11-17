import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"

function createConnectedDatabase() {
  return createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
}

test("provider-neutral SQLite transactions reject async callbacks before invoking them", async () => {
  const database = createConnectedDatabase()
  let callbackInvoked = false
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async () => {
        callbackInvoked = true
      }),
      /must be synchronous/,
    )

    assert.equal(
      callbackInvoked,
      false,
      "A synchronous provider must reject an async callback before invoking caller code",
    )
  } finally {
    await database.close()
  }
})

test("provider-neutral SQLite transactions block deferred CRUD after rejecting a promise callback", async () => {
  const database = createConnectedDatabase()
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => Promise.resolve().then(() => transaction.create({
        collection: "entries",
        record: {
          id: "late-write",
          value: "must-not-escape-rollback",
        },
      }))),
      /must be synchronous/,
    )

    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(
      await database.readOne({
        collection: "entries",
        id: "late-write",
      }),
      null,
      "A promise continuation must not write after the synchronous SQLite transaction has rolled back",
    )
  } finally {
    await database.close()
  }
})
