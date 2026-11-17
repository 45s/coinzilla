import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseConflictError } from "../src/index.js"

async function withConnectedDatabase({ database, callback }) {
  await database.connect()

  try {
    await callback(database)
  } finally {
    await database.close()
  }
}

async function withStorageKey({ callback }) {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-contract-"))
  const storageKey = join(directory, `${randomUUID()}.sqlite`)

  try {
    await callback({
      storageKey,
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
}

async function withDatabase({ createDatabase, callback, storageMode }) {
  await withStorageKey({
    callback: async ({ storageKey }) => {
      const database = createDatabase({
        storageKey,
        storageMode,
      })
      await withConnectedDatabase({
        database,
        callback,
      })
    },
  })
}

function registerStandardTest({
  name,
  description,
  createDatabase,
  verify,
  storageMode,
}) {
  test(`${name} (${storageMode}): ${description}`, async () => {
    await withDatabase({
      createDatabase,
      callback: verify,
      storageMode,
    })
  })
}

function registerQueryCapabilityTest({
  name,
  description,
  capability,
  createDatabase,
  capabilities,
  storageMode,
  verify,
}) {
  test(`${name} (${storageMode}): ${description}`, async (context) => {
    if (!capabilities.queries[capability]) {
      context.skip(`Provider declares queries.${capability}=false`)
      return
    }

    await withDatabase({
      createDatabase,
      callback: verify,
      storageMode,
    })
  })
}

async function verifyCreateAndRead({ database, record }) {
  const created = await database.create({
    collection: "people",
    record,
  })
  assert.deepEqual(
    created,
    record,
    "CREATE must return the same JSON record that the provider stored",
  )

  const read = await database.readOne({
    collection: "people",
    id: record.id,
  })
  assert.deepEqual(
    read,
    record,
    "READ ONE must retrieve the record from its collection and identifier",
  )
}

async function verifyUpdateAndDelete({ database, record }) {
  const updated = await database.update({
    collection: "people",
    id: record.id,
    changes: {
      name: "Updated",
    },
  })
  assert.deepEqual(
    updated,
    {
      ...record,
      name: "Updated",
    },
    "UPDATE must merge changed fields and preserve every untouched record field",
  )

  assert.equal(
    await database.delete({
      collection: "people",
      id: record.id,
    }),
    true,
    "DELETE must return true when the requested collection record exists",
  )
  assert.equal(
    await database.readOne({
      collection: "people",
      id: record.id,
    }),
    null,
    "READ ONE must return null after the record has been deleted",
  )
}

async function verifyCollectionIsolation(database) {
  await database.create({
    collection: "people",
    record: {
      id: "shared-id",
      name: "Person",
    },
  })
  const team = await database.create({
    collection: "teams",
    record: {
      id: "shared-id",
      name: "Team",
    },
  })

  assert.equal(
    team.id,
    "shared-id",
    "The same identifier must be allowed in a different collection",
  )
  assert.equal(
    await database.delete({
      collection: "people",
      id: "shared-id",
    }),
    true,
    "Deleting one collection's record must succeed without affecting another collection",
  )
  assert.notEqual(
    await database.readOne({
      collection: "teams",
      id: "shared-id",
    }),
    null,
    "Deleting a record must not affect another collection with the same identifier",
  )
}

async function verifyCrud(database) {
  const record = {
    id: "record-1",
    name: "First",
    status: "active",
  }
  await verifyCreateAndRead({
    database,
    record,
  })
  await verifyUpdateAndDelete({
    database,
    record,
  })
  await verifyCollectionIsolation(database)
}
async function verifyDuplicate(database) {
  await database.create({
    collection: "people",
    record: {
      id: "duplicate-1",
      name: "Original",
    },
  })

  await assert.rejects(
    database.create({
      collection: "people",
      record: {
        id: "duplicate-1",
        name: "Duplicate",
      },
    }),
    (error) => error instanceof DatabaseConflictError
      && error.code === "DB_RECORD_CONFLICT",
    "CREATE must classify duplicate collection identifiers with the public database conflict error",
  )
}

async function verifyFilters(database) {
  await database.create({
    collection: "people",
    record: {
      id: "verified-1",
      status: "active",
      verified: true,
      nickname: null,
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "numeric-true-1",
      status: "active",
      verified: 1,
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "missing-nickname-1",
      status: "active",
    },
  })

  const verified = await database.readMany({
    collection: "people",
    query: {
      filter: {
        verified: true,
      },
    },
  })
  assert.deepEqual(
    verified.map((record) => record.id),
    ["verified-1"],
    "Equality filters must distinguish JSON booleans from numeric values",
  )

  const explicitNull = await database.readMany({
    collection: "people",
    query: {
      filter: {
        nickname: null,
      },
    },
  })
  assert.deepEqual(
    explicitNull.map((record) => record.id),
    ["verified-1"],
    "An explicit null filter must not match records where the field is absent",
  )
}

async function verifySorting(database) {
  await database.create({
    collection: "people",
    record: {
      id: "person-b",
      name: "Same",
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "person-a",
      name: "Same",
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "person-c",
      name: "Zebra",
    },
  })

  const records = await database.readMany({
    collection: "people",
    query: {
      sort: [
        {
          field: "name",
          direction: "asc",
        },
      ],
    },
  })

  assert.deepEqual(
    records.map((record) => record.id),
    ["person-a", "person-b", "person-c"],
    "Sorting must honor the requested field and use the identifier as a stable tie-breaker",
  )
}

async function verifyPagination(database) {
  for (const record of [
    {
      id: "rank-1",
      rank: 1,
    },
    {
      id: "rank-2",
      rank: 2,
    },
    {
      id: "rank-3",
      rank: 3,
    },
  ]) {
    await database.create({
      collection: "records",
      record,
    })
  }

  const remaining = await database.readMany({
    collection: "records",
    query: {
      sort: [
        {
          field: "rank",
          direction: "asc",
        },
      ],
      offset: 1,
    },
  })
  assert.deepEqual(
    remaining.map((record) => record.id),
    ["rank-2", "rank-3"],
    "An offset without a limit must return every remaining sorted record",
  )

  const page = await database.readMany({
    collection: "records",
    query: {
      sort: [
        {
          field: "rank",
          direction: "asc",
        },
      ],
      limit: 1,
      offset: 1,
    },
  })
  assert.deepEqual(
    page.map((record) => record.id),
    ["rank-2"],
    "Pagination must apply limit and offset after sorting the complete matching set",
  )
}

async function verifyMissingRecords(database) {
  assert.equal(
    await database.update({
      collection: "people",
      id: "missing-1",
      changes: {
        name: "Ignored",
      },
    }),
    null,
    "UPDATE must return null when the requested record does not exist",
  )
  assert.equal(
    await database.delete({
      collection: "people",
      id: "missing-1",
    }),
    false,
    "DELETE must return false when the requested record does not exist",
  )
}

async function verifyRollback(database) {
  const failure = new Error("abort the complete transaction")

  await assert.rejects(
    database.transaction((transaction) => {
      transaction.create({
        collection: "people",
        record: {
          id: "transaction-1",
          name: "Uncommitted",
        },
      })
      throw failure
    }),
    (error) => error === failure,
    "A failed transaction must preserve the original callback error",
  )

  assert.equal(
    await database.readOne({
      collection: "people",
      id: "transaction-1",
    }),
    null,
    "A failed transaction must roll back every record written by its callback",
  )
}

async function verifyCommit(database) {
  const result = await database.transaction((transaction) => {
    transaction.create({
      collection: "people",
      record: {
        id: "committed-1",
        name: "Committed",
      },
    })
    return "committed"
  })

  assert.equal(
    result,
    "committed",
    "A successful transaction must return the callback result after commit",
  )
  assert.deepEqual(
    await database.readOne({
      collection: "people",
      id: "committed-1",
    }),
    {
      id: "committed-1",
      name: "Committed",
    },
    "A successful transaction must make every callback write visible after commit",
  )
}

async function verifyTransactionCallbackMode(database) {
  if (database.capabilities.transactions.callbackMode === "synchronous") {
    await assert.rejects(
      database.transaction(async () => {}),
      TypeError,
      "A provider declaring synchronous callbacks must reject async transaction work",
    )
    return
  }

  await database.transaction(async (transaction) => {
    await transaction.create({
      collection: "records",
      record: {
        id: "async-transaction-1",
        step: "before-await",
      },
    })
    await Promise.resolve()
    await transaction.create({
      collection: "records",
      record: {
        id: "async-transaction-2",
        step: "after-await",
      },
    })
  })

  const records = await database.readMany({
    collection: "records",
  })
  assert.deepEqual(
    records.map((record) => record.id),
    ["async-transaction-1", "async-transaction-2"],
    "A provider declaring asynchronous callbacks must keep the transaction open across awaited work",
  )
}

async function verifyLifecycle({ createDatabase, storageMode }) {
  await withStorageKey({
    callback: async ({ storageKey }) => {
      const database = createDatabase({
        storageKey,
        storageMode,
      })
      await database.connect()
      await database.close()

      assert.equal(
        database.state,
        "closed",
        "Closing the composed database must expose the terminal closed lifecycle state",
      )
      assert.throws(
        () => database.readMany({
          collection: "people",
        }),
        /Database must be connected/,
        "A closed database must reject new CRUD operations before calling the provider",
      )
      await assert.rejects(
        database.connect(),
        /Cannot connect database while it is closed/,
        "A closed database resource must not be reopened through the same lifecycle facade",
      )
    },
  })
}

async function verifyCapabilities(database) {
  assert.equal(
    Object.isFrozen(database.capabilities),
    true,
    "Consumers must receive an immutable provider capability snapshot",
  )
  assert.equal(
    Object.isFrozen(database.capabilities.queries),
    true,
    "Nested provider capability groups must also be immutable",
  )
}

async function verifyPersistence({ createDatabase, storageMode }) {
  await withStorageKey({
    callback: async ({ storageKey }) => {
      await withConnectedDatabase({
        database: createDatabase({
          storageKey,
          storageMode,
        }),
        callback: async (database) => {
          await database.create({
            collection: "people",
            record: {
              id: "persistent-1",
              name: "Stored",
            },
          })
        },
      })

      await withConnectedDatabase({
        database: createDatabase({
          storageKey,
          storageMode,
        }),
        callback: async (database) => {
          const record = await database.readOne({
            collection: "people",
            id: "persistent-1",
          })
          assert.deepEqual(
            record,
            {
              id: "persistent-1",
              name: "Stored",
            },
            "A newly created provider connection must read records persisted by the previous connection",
          )
        },
      })
    },
  })
}

function registerPersistenceTest({ name, createDatabase, storageMode }) {
  test(`${name} (${storageMode}): persistent records survive a new database connection`, async (context) => {
    if (storageMode === "memory") {
      context.skip("Provider declares ephemeral in-memory storage")
      return
    }

    await verifyPersistence({
      createDatabase,
      storageMode,
    })
  })
}

function registerCrudAndQueryTests({
  name,
  createDatabase,
  capabilities,
  storageMode,
}) {
  registerStandardTest({
    name,
    description: "CRUD operations preserve records and collection isolation",
    createDatabase,
    verify: verifyCrud,
    storageMode,
  })
  registerStandardTest({
    name,
    description: "duplicate identifiers return the shared conflict error",
    createDatabase,
    verify: verifyDuplicate,
    storageMode,
  })
  registerQueryCapabilityTest({
    name,
    description: "exact equality filters distinguish JSON values",
    capability: "equalityFilters",
    createDatabase,
    capabilities,
    verify: verifyFilters,
    storageMode,
  })
  registerQueryCapabilityTest({
    name,
    description: "sorting is stable and honors requested fields",
    capability: "sorting",
    createDatabase,
    capabilities,
    verify: verifySorting,
    storageMode,
  })
  registerQueryCapabilityTest({
    name,
    description: "pagination applies limit and offset after sorting",
    capability: "pagination",
    createDatabase,
    capabilities,
    verify: verifyPagination,
    storageMode,
  })
}

function registerTransactionTests({ name, createDatabase, storageMode }) {
  registerStandardTest({
    name,
    description: "missing updates and deletes use non-exception results",
    createDatabase,
    verify: verifyMissingRecords,
    storageMode,
  })
  registerStandardTest({
    name,
    description: "transaction failures roll back every record change",
    createDatabase,
    verify: verifyRollback,
    storageMode,
  })
  registerStandardTest({
    name,
    description: "successful transactions commit all record changes",
    createDatabase,
    verify: verifyCommit,
    storageMode,
  })
  registerStandardTest({
    name,
    description: "transaction callbacks follow the declared callback mode",
    createDatabase,
    verify: verifyTransactionCallbackMode,
    storageMode,
  })
  registerStandardTest({
    name,
    description: "provider capabilities are exposed as an immutable snapshot",
    createDatabase,
    verify: verifyCapabilities,
    storageMode,
  })
}

function registerLifecycleTests({ name, createDatabase, storageMode }) {
  test(`${name} (${storageMode}): closing the database prevents new work`, async () => {
    await verifyLifecycle({
      createDatabase,
      storageMode,
    })
  })
  registerPersistenceTest({
    name,
    createDatabase,
    storageMode,
  })
}

/**
 * Register the provider-neutral contract tests for a database provider.
 *
 * The factory receives an opaque storageKey and a declared storageMode. Each test
 * receives an isolated key; persistence tests reuse that key across connections.
 *
 * @param {{name: string, createDatabase: (options: {storageKey: string, storageMode?: string}) => object}} options
 */
export function runDatabaseProviderConformanceTests({ name, createDatabase }) {
  const capabilityProbe = createDatabase({
    storageKey: `conformance-probe-${randomUUID()}`,
  })
  const { capabilities } = capabilityProbe
  const probeClose = capabilityProbe.close()

  test(`${name}: capability discovery closes its unconnected provider probe`, async () => {
    await probeClose
  })

  for (const storageMode of capabilities.storage.modes) {
    const options = {
      name,
      createDatabase,
      capabilities,
      storageMode,
    }
    registerCrudAndQueryTests(options)
    registerTransactionTests(options)
    registerLifecycleTests(options)
  }
}
