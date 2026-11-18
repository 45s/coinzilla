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

function createDeferredRecordWrite(transaction) {
  return () => transaction.create({
    collection: "entries",
    record: {
      id: "late-write",
      value: "must-not-escape-rollback",
    },
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
      database.transaction((transaction) => Promise.resolve().then(
        createDeferredRecordWrite(transaction),
      )),
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


test("provider-neutral transactions reject missing callbacks before entering the provider", async () => {
  const database = createConnectedDatabase()
  await database.connect()

  try {
    assert.throws(
      () => database.transaction(null),
      /callback is required/,
      "The provider-neutral facade must reject a missing transaction callback before provider execution",
    )
  } finally {
    await database.close()
  }
})
