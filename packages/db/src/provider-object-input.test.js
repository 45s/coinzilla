import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"

test("provider-neutral CRUD operations accept one named input object", async () => {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
  await database.connect()

  try {
    const record = {
      id: "object-input-1",
      name: "Initial",
    }

    assert.deepEqual(
      await database.create({
        collection: "people",
        record,
      }),
      record,
      "CREATE must accept one named input object and return the inserted record",
    )
    assert.deepEqual(
      await database.readOne({
        collection: "people",
        id: "object-input-1",
      }),
      record,
      "READ ONE must accept one named input object containing collection and identifier",
    )
    assert.deepEqual(
      await database.readMany({
        collection: "people",
        query: {
          filter: {
            name: "Initial",
          },
        },
      }),
      [record],
      "READ MANY must accept one named input object containing collection and query",
    )
    assert.deepEqual(
      await database.update({
        collection: "people",
        id: "object-input-1",
        changes: {
          name: "Updated",
        },
      }),
      {
        ...record,
        name: "Updated",
      },
      "UPDATE must accept one named input object and return the complete updated record",
    )
    assert.equal(
      await database.delete({
        collection: "people",
        id: "object-input-1",
      }),
      true,
      "DELETE must accept one named input object and report the removed record",
    )
  } finally {
    await database.close()
  }
})
