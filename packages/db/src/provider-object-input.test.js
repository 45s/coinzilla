import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"

const INITIAL_RECORD = Object.freeze({
  id: "object-input-1",
  name: "Initial",
})

async function verifyCreate(database) {
  assert.deepEqual(
    await database.create({
      collection: "people",
      record: INITIAL_RECORD,
    }),
    INITIAL_RECORD,
    "CREATE must accept one named input object and return the inserted record",
  )
}

async function verifyReadOne(database) {
  assert.deepEqual(
    await database.readOne({
      collection: "people",
      id: INITIAL_RECORD.id,
    }),
    INITIAL_RECORD,
    "READ ONE must accept one named input object containing collection and identifier",
  )
}

async function verifyReadMany(database) {
  assert.deepEqual(
    await database.readMany({
      collection: "people",
      query: {
        filter: {
          name: INITIAL_RECORD.name,
        },
      },
    }),
    [INITIAL_RECORD],
    "READ MANY must accept one named input object containing collection and query",
  )
}

async function verifyUpdate(database) {
  assert.deepEqual(
    await database.update({
      collection: "people",
      id: INITIAL_RECORD.id,
      changes: {
        name: "Updated",
      },
    }),
    {
      ...INITIAL_RECORD,
      name: "Updated",
    },
    "UPDATE must accept one named input object and return the complete updated record",
  )
}

async function verifyDelete(database) {
  assert.equal(
    await database.delete({
      collection: "people",
      id: INITIAL_RECORD.id,
    }),
    true,
    "DELETE must accept one named input object and report the removed record",
  )
}

async function verifyObjectInputContract(database) {
  await verifyCreate(database)
  await verifyReadOne(database)
  await verifyReadMany(database)
  await verifyUpdate(database)
  await verifyDelete(database)
}

test("provider-neutral CRUD operations accept one named input object", async () => {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
  await database.connect()

  try {
    await verifyObjectInputContract(database)
  } finally {
    await database.close()
  }
})
