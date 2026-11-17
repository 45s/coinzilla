import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase } from "./index.js"

function createProvider({ capabilities }) {
  return {
    capabilities,
    connect() {},
    close() {},
    withTransaction(work) {
      return work({
        create() {},
        readOne() {},
        readMany() {},
        update() {},
        delete() {},
      })
    },
  }
}

test("provider composition requires complete standard capability declarations", () => {
  const invalidCapabilities = [
    {},
    {
      transactions: {
        callbackMode: "sometimes",
        nestedTransactions: false,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["file"],
      },
    },
    {
      transactions: {
        callbackMode: "synchronous",
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["file"],
      },
    },
    {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
      },
      queries: {
        equalityFilters: true,
        sorting: "yes",
        pagination: true,
      },
      storage: {
        modes: ["file"],
      },
    },
    {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: [],
      },
    },
    {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["unknown"],
      },
    },
  ]

  for (const capabilities of invalidCapabilities) {
    assert.throws(
      () => createDatabase({
        provider: createProvider({
          capabilities,
        }),
      }),
      TypeError,
      "A provider with missing, invalid or unsupported capability declarations must be rejected at composition",
    )
  }
})

test("provider capability declarations support the documented storage modes", () => {
  const capabilities = {
    transactions: {
      callbackMode: "synchronous",
      nestedTransactions: false,
    },
    queries: {
      equalityFilters: true,
      sorting: true,
      pagination: true,
    },
    storage: {
      modes: ["file", "memory"],
    },
  }

  const database = createDatabase({
    provider: createProvider({
      capabilities,
    }),
  })

  assert.deepEqual(
    database.capabilities,
    capabilities,
    "Composition must preserve every declared provider capability for consumer inspection",
  )

  capabilities.queries.sorting = false
  assert.equal(
    database.capabilities.queries.sorting,
    true,
    "The public capability snapshot must not change when the provider mutates its original declaration",
  )
})
