import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"
import { runDatabaseProviderConformanceTests } from "../test-support/provider-conformance.js"

const exercisedStorageModes = new Set()
const cleanedStorageModes = new Set()
const cleanedStorageKeys = []

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
  cleanupStorage: async ({ storageKey, storageMode }) => {
    cleanedStorageModes.add(storageMode)
    cleanedStorageKeys.push(storageKey)
  },
})

test("SQLite provider conformance exercises every declared storage mode", () => {
  assert.deepEqual(
    [...exercisedStorageModes].sort(),
    ["file", "memory"],
    "The reusable provider conformance suite must test every declared SQLite storage mode",
  )
})


test("SQLite provider conformance cleans every isolated storage key", () => {
  assert.deepEqual(
    [...cleanedStorageModes].sort(),
    ["file", "memory"],
    "The reusable conformance suite must invoke provider cleanup for every declared storage mode",
  )
  assert.equal(
    new Set(cleanedStorageKeys).size,
    cleanedStorageKeys.length,
    "Each conformance test must receive an isolated storage key that is cleaned exactly once",
  )
})
