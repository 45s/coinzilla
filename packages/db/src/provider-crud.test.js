import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"

test("provider-neutral database API creates, reads, updates, and deletes records", async () => {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: ":memory:",
    }),
  })
  await database.connect()

  try {
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

    const wasDeleted = await database.delete({
      collection: "people",
      id: "person-1",
    })

    assert.equal(
      wasDeleted,
      true,
      "DELETE must report that the requested existing record was removed",
    )

    const missingRecord = await database.readOne({
      collection: "people",
      id: "person-1",
    })

    assert.equal(
      missingRecord,
      null,
      "READ ONE must return null after the requested record has been deleted",
    )
  } finally {
    await database.close()
  }
})
