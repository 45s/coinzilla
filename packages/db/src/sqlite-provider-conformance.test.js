import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"
import { runDatabaseProviderConformanceTests } from "../test-support/provider-conformance.js"

const exercisedStorageModes = new Set()

runDatabaseProviderConformanceTests({
  name: "SQLite provider",
  createDatabase: ({ storageKey, storageMode }) => {
    if (storageMode) {
      exercisedStorageModes.add(storageMode)
    }

    return createDatabase({
      provider: createSqliteProvider({
        filename: storageMode === "memory" ? ":memory:" : storageKey,
      }),
    })
  },
})

test("SQLite provider conformance exercises every declared storage mode", () => {
  assert.deepEqual(
    [...exercisedStorageModes].sort(),
    ["file", "memory"],
    "The reusable provider conformance suite must test every declared SQLite storage mode",
  )
})
