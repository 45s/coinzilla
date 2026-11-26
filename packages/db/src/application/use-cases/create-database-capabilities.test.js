import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase } from "../../index.js"

function createProvider({ capabilities }) {
  return {
    capabilities,
    execute({ operation, input }) {
      return operation === "create" ? input.record : null
    },
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
    withReadTransaction(work) {
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

const invalidCapabilities = [
    {},
    {
      transactions: {
        callbackMode: "sometimes",
        nestedTransactions: false,
      multiDocument: true,
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
        nestedTransactions: true,
        multiDocument: true,
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
        callbackMode: "asynchronous",
        nestedTransactions: true,
        multiDocument: false,
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
      multiDocument: true,
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
      multiDocument: true,
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
      multiDocument: true,
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

test("provider composition requires complete standard capability declarations", () => {
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
      multiDocument: true,
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


test("provider-neutral reads and writes use their distinct execution boundaries", async () => {
  const provider = createProvider({
    capabilities: {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
        multiDocument: true,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["memory"],
      },
    },
  })
  let readTransactions = 0
  let singleOperations = 0
  const withReadTransaction = provider.withReadTransaction.bind(provider)
  const execute = provider.execute.bind(provider)
  provider.withReadTransaction = (work) => {
    readTransactions += 1
    return withReadTransaction(work)
  }
  provider.execute = (input) => {
    singleOperations += 1
    return execute(input)
  }
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await database.readOne({ collection: "people", id: "one" })
    await database.create({
      collection: "people",
      record: { id: "one" },
    })
    assert.equal(readTransactions, 1)
    assert.equal(singleOperations, 1)
  } finally {
    await database.close()
  }
})


test("database CRUD inside a transaction reuses its transaction context", async () => {
  const calls = {
    transactionCreate: 0,
    transactionRead: 0,
    standaloneCreate: 0,
    standaloneRead: 0,
  }
  const provider = createProvider({
    capabilities: {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
        multiDocument: true,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["memory"],
      },
    },
  })
  provider.execute = () => {
    calls.standaloneCreate += 1
  }
  provider.withReadTransaction = (work) => {
    calls.standaloneRead += 1
    return work({
      create() {},
      readOne() {},
      readMany() {},
      update() {},
      delete() {},
    })
  }
  provider.withTransaction = (work) => work({
    create() {
      calls.transactionCreate += 1
    },
    readOne() {
      calls.transactionRead += 1
    },
    readMany() {},
    update() {},
    delete() {},
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await database.create({ collection: "people", record: { id: "outside" } })
    await database.readOne({ collection: "people", id: "outside" })
    await database.transaction(() => {
      database.create({ collection: "people", record: { id: "inside" } })
      database.readOne({ collection: "people", id: "inside" })
      assert.throws(
        () => database.transaction(() => {}),
        /Nested database transactions are not supported/,
      )
      assert.throws(
        () => database.close(),
        /Cannot close a database from inside its transaction callback/,
      )
    })

    assert.deepEqual(calls, {
      transactionCreate: 1,
      transactionRead: 1,
      standaloneCreate: 1,
      standaloneRead: 1,
    })
  } finally {
    await database.close()
  }
})

test("provider composition requires atomic single-operation execution", () => {
  const provider = createProvider({
    capabilities: {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
        multiDocument: true,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["memory"],
      },
    },
  })
  delete provider.execute

  assert.throws(
    () => createDatabase({
      provider,
    }),
    /execute/,
    "A provider-neutral database must expose atomic single-operation execution",
  )
})



test("provider composition requires the explicit read transaction port", () => {
  const provider = createProvider({
    capabilities: {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
        multiDocument: true,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["memory"],
      },
    },
  })
  delete provider.withReadTransaction

  assert.throws(
    () => createDatabase({ provider }),
    /withReadTransaction/,
    "A provider-neutral database must expose its explicit read transaction boundary",
  )
})

test("provider composition rejects non-JSON capability declarations with their original cause", () => {
  const capabilities = {
    transactions: {
      callbackMode: "synchronous",
      nestedTransactions: false,
      multiDocument: true,
    },
    queries: {
      equalityFilters: true,
      sorting: true,
      pagination: true,
    },
    storage: {
      modes: ["file"],
    },
    unsupported: 1n,
  }

  assert.throws(
    () => createDatabase({
      provider: createProvider({ capabilities }),
    }),
    (error) => error instanceof TypeError
      && error.message === "Provider capabilities must be JSON-safe"
      && error.cause instanceof TypeError,
    "A provider with BigInt capability metadata must fail composition and preserve the JSON serialization cause",
  )
})

test("provider transaction facades reject incomplete transaction contexts", async () => {
  const provider = createProvider({
    capabilities: {
      transactions: {
        callbackMode: "synchronous",
        nestedTransactions: false,
      multiDocument: true,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["memory"],
      },
    },
  })
  const incompleteTransaction = {
    create() {},
    readMany() {},
    update() {},
    delete() {},
  }
  provider.withTransaction = (work) => work(incompleteTransaction)
  provider.withReadTransaction = (work) => work(incompleteTransaction)
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(() => "unused"),
      /must implement:.*readOne/,
      "An explicit transaction must reject a provider context missing any required CRUD operation",
    )
    assert.deepEqual(
      await database.create({
        collection: "people",
        record: { id: "incomplete-context-1" },
      }),
      { id: "incomplete-context-1" },
      "A standalone CRUD operation must use the single-operation provider port",
    )
  } finally {
    await database.close()
  }
})



test("providers can reject multi-document transactions while retaining single-operation execution", async () => {
  const calls = []
  const capabilities = {
    transactions: {
      callbackMode: "asynchronous",
      nestedTransactions: false,
      multiDocument: false,
    },
    queries: {
      equalityFilters: true,
      sorting: true,
      pagination: true,
    },
    storage: {
      modes: ["server"],
    },
  }
  const provider = createProvider({ capabilities })
  provider.execute = ({ operation, input }) => {
    calls.push(operation)
    return operation === "create" ? input.record : null
  }
  let callbackInvoked = false
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(() => {
        callbackInvoked = true
      }),
      /multi-document transactions are not supported/i,
    )
    assert.equal(callbackInvoked, false)
    assert.deepEqual(
      await database.create({
        collection: "people",
        record: { id: "standalone-record" },
      }),
      { id: "standalone-record" },
    )
    assert.deepEqual(calls, ["create"])
    assert.equal(database.capabilities.transactions.multiDocument, false)
  } finally {
    await database.close()
  }
})


test("provider composition accepts topology-dependent transaction guarantees", async () => {
  const capabilities = {
    transactions: {
      callbackMode: "asynchronous",
      nestedTransactions: false,
      multiDocument: "topology-dependent",
    },
    queries: {
      equalityFilters: true,
      sorting: true,
      pagination: true,
    },
    storage: {
      modes: ["server"],
    },
  }
  const provider = createProvider({ capabilities })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    assert.equal(
      database.capabilities.transactions.multiDocument,
      "topology-dependent",
    )
    assert.equal(
      await database.transaction(() => "delegated"),
      "delegated",
    )
  } finally {
    await database.close()
  }
})

test("provider composition rejects missing and array capability declarations", () => {
  for (const capabilities of [null, [], "not-an-object"]) {
    assert.throws(
      () => createDatabase({
        provider: createProvider({ capabilities }),
      }),
      /declare its database capabilities/,
      "A provider must supply one non-array capability object at the composition boundary",
    )
  }
})


test("provider composition requires a read transaction boundary", () => {
  const provider = createProvider({
    capabilities: {
      transactions: {
        callbackMode: "asynchronous",
        nestedTransactions: false,
        multiDocument: false,
      },
      queries: {
        equalityFilters: true,
        sorting: true,
        pagination: true,
      },
      storage: {
        modes: ["server"],
      },
    },
  })
  delete provider.withReadTransaction

  assert.throws(
    () => createDatabase({ provider }),
    /withReadTransaction/,
  )
})
