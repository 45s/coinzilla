import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"

async function verifyCreateAndRead(database) {
  const record = {
    id: "person-1",
    name: "Morty",
  }
  const createdRecord = await database.create({
    collection: "people",
    record,
  })

  assert.deepEqual(
    createdRecord,
    record,
    "CREATE must return the stored provider-neutral record without changing its fields",
  )

  const readRecord = await database.readOne({
    collection: "people",
    id: "person-1",
  })
  assert.deepEqual(
    readRecord,
    createdRecord,
    "READ ONE must return the record stored under the requested identifier",
  )
}

async function verifyUpdateAndDelete(database) {
  const updatedRecord = await database.update({
    collection: "people",
    id: "person-1",
    changes: {
      name: "Summer",
    },
  })
  assert.deepEqual(
    updatedRecord,
    {
      id: "person-1",
      name: "Summer",
    },
    "UPDATE must return the complete updated record while preserving its identifier",
  )

  const records = await database.readMany({
    collection: "people",
  })
  assert.deepEqual(
    records,
    [updatedRecord],
    "READ MANY without filters must return every record in the collection",
  )

  assert.equal(
    await database.delete({
      collection: "people",
      id: "person-1",
    }),
    true,
    "DELETE must report that the requested existing record was removed",
  )
  assert.equal(
    await database.readOne({
      collection: "people",
      id: "person-1",
    }),
    null,
    "READ ONE must return null after the requested record has been deleted",
  )
}

test("provider-neutral database API creates, reads, updates, and deletes records", async () => {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
  await database.connect()

  try {
    await verifyCreateAndRead(database)
    await verifyUpdateAndDelete(database)
  } finally {
    await database.close()
  }
})

test("SQLite CREATE uses the validated record snapshot instead of rereading a caller Proxy", async () => {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
  let proxyGetTrapExecuted = false
  const expectedRecord = {
    id: "proxy-person-1",
    name: "Proxy-safe",
  }
  const record = new Proxy(expectedRecord, {
    get() {
      proxyGetTrapExecuted = true
      throw new Error("Caller Proxy get trap must not execute after validation")
    },
  })
  await database.connect()

  try {
    const createdRecord = await database.create({
      collection: "people",
      record,
    })

    assert.deepEqual(
      createdRecord,
      expectedRecord,
      "CREATE must persist and return the descriptor-validated record snapshot",
    )
    assert.equal(
      proxyGetTrapExecuted,
      false,
      "SQLite CREATE must not execute caller-controlled Proxy get traps after record validation",
    )
    assert.deepEqual(
      await database.readOne({
        collection: "people",
        id: expectedRecord.id,
      }),
      expectedRecord,
      "CREATE must persist the identifier and record contents from the same validated snapshot",
    )
  } finally {
    await database.close()
  }
})


test("SQLite CRUD binds collection, identifier, and filter values instead of interpolating SQL", async () => {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
  await database.connect()
  const injectionValue = "' OR 1=1 --"
  const injectionCollection = "people'; DROP TABLE records; --"
  const injectionIdentifier = "person' OR 1=1 --"

  try {
    await database.create({
      collection: injectionCollection,
      record: {
        id: injectionIdentifier,
        name: injectionValue,
      },
    })
    await database.create({
      collection: injectionCollection,
      record: {
        id: "ordinary-person",
        name: "ordinary",
      },
    })

    assert.deepEqual(
      await database.readOne({
        collection: injectionCollection,
        id: injectionIdentifier,
      }),
      {
        id: injectionIdentifier,
        name: injectionValue,
      },
      "SQL-looking collection names and identifiers must be treated as bound data",
    )
    assert.deepEqual(
      await database.readMany({
        collection: injectionCollection,
        query: {
          filter: {
            name: injectionValue,
          },
        },
      }),
      [{
        id: injectionIdentifier,
        name: injectionValue,
      }],
      "A SQL-looking filter value must match only its exact stored value and never alter the query predicate",
    )
    assert.deepEqual(
      await database.readMany({
        collection: injectionCollection,
      }),
      [
        {
          id: injectionIdentifier,
          name: injectionValue,
        },
        {
          id: "ordinary-person",
          name: "ordinary",
        },
      ],
      "Parameterized collection and filter operations must leave every record intact",
    )
  } finally {
    await database.close()
  }
})
