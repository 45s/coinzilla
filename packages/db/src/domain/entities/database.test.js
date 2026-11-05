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
