import assert from "node:assert/strict"
import test from "node:test"

import { createDatabaseEntity } from "./database.js"

test("database entity requires a provider", () => {
  assert.throws(() => createDatabaseEntity(), /provider object/)
})

test("database entity requires the complete provider port", () => {
  assert.throws(
    () => createDatabaseEntity({ provider: {} }),
    /connect, close, withTransaction/,
  )
})
test("database entity tracks successful and failed provider operations", async () => {
  const failure = new Error("provider execution failed")
  const provider = {
    connect() {},
    close() {},
    withTransaction(work) {
      return work({})
    },
    execute(input) {
      if (input.operation === "sync-failure") {
        throw failure
      }
      if (input.operation === "async-failure") {
        return Promise.reject(failure)
      }
      return Promise.resolve(input)
    },
  }
  const database = createDatabaseEntity({ provider })
  await database.connect()

  assert.deepEqual(await database.execute({ operation: "success" }), {
    operation: "success",
  })
  await assert.rejects(
    database.execute({ operation: "sync-failure" }),
    failure,
  )
  await assert.rejects(
    database.execute({ operation: "async-failure" }),
    failure,
  )
  await database.close()
  assert.equal(database.state, "closed")
})

test("database entity routes read transactions to the provider read-only capability", async () => {
  const calls = []
  const provider = {
    connect() {},
    close() {},
    withTransaction(work) {
      calls.push("write")
      return work({ mode: "write" })
    },
    withReadTransaction(work) {
      calls.push("read")
      return work({ mode: "read" })
    },
  }
  const database = createDatabaseEntity({ provider })
  await database.connect()

  assert.deepEqual(
    await database.readTransaction((transaction) => transaction),
    { mode: "read" },
  )
  assert.deepEqual(
    await database.transaction((transaction) => transaction),
    { mode: "write" },
  )
  assert.deepEqual(calls, ["read", "write"])
  await database.close()
})

