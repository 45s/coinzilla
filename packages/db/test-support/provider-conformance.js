import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseConflictError } from "../src/index.js"

async function withDatabase({ createDatabase, callback, filename = ":memory:" }) {
  const database = createDatabase({
    filename,
  })
  await database.connect()

  try {
    await callback(database)
  } finally {
    await database.close()
  }
}

function registerStandardTest({ name, description, createDatabase, verify }) {
  test(`${name}: ${description}`, async () => {
    await withDatabase({
      createDatabase,
      callback: verify,
    })
  })
}

async function verifyCrud(database) {
  const record = {
    id: "record-1",
    name: "First",
    status: "active",
  }
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
    id: "record-1",
  })
  assert.deepEqual(
    read,
    record,
    "READ ONE must retrieve the record from its collection and identifier",
  )

  const updated = await database.update({
    collection: "people",
    id: "record-1",
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

  const otherCollectionRecord = await database.create({
    collection: "teams",
    record: {
      id: "record-1",
      name: "Separate collection",
    },
  })
  assert.equal(
    otherCollectionRecord.id,
    "record-1",
    "The same identifier must be allowed in a different collection",
  )

  assert.equal(
    await database.delete({
      collection: "people",
      id: "record-1",
    }),
    true,
    "DELETE must return true when the requested collection record exists",
  )
  assert.equal(
    await database.readOne({
      collection: "people",
      id: "record-1",
    }),
    null,
    "READ ONE must return null after the record has been deleted",
  )
  assert.notEqual(
    await database.readOne({
      collection: "teams",
      id: "record-1",
    }),
    null,
    "Deleting a record must not affect another collection with the same identifier",
  )
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

async function verifyQueries(database) {
  await database.create({
    collection: "people",
    record: {
      id: "person-3",
      name: "Charlie",
      status: "active",
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "person-2",
      name: "Bravo",
      status: "active",
      verified: true,
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "person-1",
      name: "Alpha",
      status: "inactive",
    },
  })

  const records = await database.readMany({
    collection: "people",
    query: {
      filter: {
        status: "active",
      },
      sort: [
        {
          field: "name",
          direction: "asc",
        },
      ],
      limit: 1,
      offset: 1,
    },
  })

  assert.deepEqual(
    records.map((record) => record.id),
    ["person-3"],
    "READ MANY must filter before sorting and apply offset/limit to the sorted matches",
  )

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
    ["person-2"],
    "Equality filters must distinguish JSON booleans from other JSON value types",
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

async function verifyNullFiltering(database) {
  await database.create({
    collection: "people",
    record: {
      id: "explicit-null-1",
      nickname: null,
    },
  })
  await database.create({
    collection: "people",
    record: {
      id: "missing-nickname-1",
      name: "No nickname",
    },
  })

  const records = await database.readMany({
    collection: "people",
    query: {
      filter: {
        nickname: null,
      },
    },
  })

  assert.deepEqual(
    records.map((record) => record.id),
    ["explicit-null-1"],
    "An explicit null filter must not match records where the field is absent",
  )
}

async function verifyLifecycle({ createDatabase }) {
  const database = createDatabase({
    filename: ":memory:",
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

async function verifyPersistence({ createDatabase }) {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-contract-"))
  const filename = join(directory, "records.sqlite")

  try {
    await withDatabase({
      createDatabase,
      filename,
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

    await withDatabase({
      createDatabase,
      filename,
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
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
}

/**
 * Register the provider-neutral contract tests for a database provider.
 *
 * The factory receives a filename. Use ":memory:" for isolated tests and
 * persist the supplied filename when testing reconnect behavior.
 *
 * @param {{name: string, createDatabase: (options: {filename: string}) => object}} options
 */
export function runDatabaseProviderConformanceTests({ name, createDatabase }) {
  registerStandardTest({
    name,
    description: "CRUD operations preserve records and collection isolation",
    createDatabase,
    verify: verifyCrud,
  })
  registerStandardTest({
    name,
    description: "duplicate identifiers return the shared conflict error",
    createDatabase,
    verify: verifyDuplicate,
  })
  registerStandardTest({
    name,
    description: "filters, sorting, and pagination return the requested page",
    createDatabase,
    verify: verifyQueries,
  })
  registerStandardTest({
    name,
    description: "missing updates and deletes use non-exception results",
    createDatabase,
    verify: verifyMissingRecords,
  })
  registerStandardTest({
    name,
    description: "transaction failures roll back every record change",
    createDatabase,
    verify: verifyRollback,
  })
  registerStandardTest({
    name,
    description: "successful transactions commit all record changes",
    createDatabase,
    verify: verifyCommit,
  })
  registerStandardTest({
    name,
    description: "missing fields do not match explicit null filters",
    createDatabase,
    verify: verifyNullFiltering,
  })
  registerStandardTest({
    name,
    description: "provider capabilities are exposed as an immutable snapshot",
    createDatabase,
    verify: verifyCapabilities,
  })
  test(`${name}: closing the database prevents new work and releases the provider`, async () => {
    await verifyLifecycle({
      createDatabase,
    })
  })
  test(`${name}: file-backed records survive a new database connection`, async () => {
    await verifyPersistence({
      createDatabase,
    })
  })
}
