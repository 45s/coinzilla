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

function createRecord({ id, name, status, verified = false }) {
  return {
    id,
    name,
    status,
    verified,
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
  test(`${name}: CRUD operations preserve records and collection isolation`, async () => {
    await withDatabase({
      createDatabase,
      callback: async (database) => {
        const record = createRecord({
          id: "record-1",
          name: "First",
          status: "active",
        })
        const created = await database.create("people", record)

        assert.deepEqual(
          created,
          record,
          "CREATE must return the same JSON record that the provider stored",
        )

        const read = await database.readOne("people", "record-1")
        assert.deepEqual(
          read,
          record,
          "READ ONE must retrieve the record from its collection and identifier",
        )

        const updated = await database.update("people", "record-1", {
          name: "Updated",
        })
        assert.deepEqual(
          updated,
          {
            ...record,
            name: "Updated",
          },
          "UPDATE must merge changed fields and preserve every untouched record field",
        )

        const otherCollectionRecord = await database.create("teams", {
          id: "record-1",
          name: "Separate collection",
        })
        assert.equal(
          otherCollectionRecord.id,
          "record-1",
          "The same identifier must be allowed in a different collection",
        )

        assert.equal(
          await database.delete("people", "record-1"),
          true,
          "DELETE must return true when the requested collection record exists",
        )
        assert.equal(
          await database.readOne("people", "record-1"),
          null,
          "READ ONE must return null after the record has been deleted",
        )
        assert.notEqual(
          await database.readOne("teams", "record-1"),
          null,
          "Deleting a record must not affect another collection with the same identifier",
        )
      },
    })
  })

  test(`${name}: duplicate identifiers return the shared conflict error`, async () => {
    await withDatabase({
      createDatabase,
      callback: async (database) => {
        await database.create("people", {
          id: "duplicate-1",
          name: "Original",
        })

        await assert.rejects(
          database.create("people", {
            id: "duplicate-1",
            name: "Duplicate",
          }),
          (error) => error instanceof DatabaseConflictError
            && error.code === "DB_RECORD_CONFLICT",
          "CREATE must classify duplicate collection identifiers with the public database conflict error",
        )
      },
    })
  })

  test(`${name}: filters, sorting, and pagination return the requested page`, async () => {
    await withDatabase({
      createDatabase,
      callback: async (database) => {
        await database.create("people", createRecord({
          id: "person-3",
          name: "Charlie",
          status: "active",
        }))
        await database.create("people", createRecord({
          id: "person-2",
          name: "Bravo",
          status: "active",
          verified: true,
        }))
        await database.create("people", createRecord({
          id: "person-1",
          name: "Alpha",
          status: "inactive",
        }))

        const records = await database.readMany("people", {
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
        })

        assert.deepEqual(
          records.map((record) => record.id),
          ["person-3"],
          "READ MANY must filter before sorting and apply offset/limit to the sorted matches",
        )

        const verified = await database.readMany("people", {
          filter: {
            verified: true,
          },
        })
        assert.deepEqual(
          verified.map((record) => record.id),
          ["person-2"],
          "Equality filters must distinguish JSON booleans from other JSON value types",
        )
      },
    })
  })

  test(`${name}: missing updates and deletes use non-exception results`, async () => {
    await withDatabase({
      createDatabase,
      callback: async (database) => {
        assert.equal(
          await database.update("people", "missing-1", {
            name: "Ignored",
          }),
          null,
          "UPDATE must return null when the requested record does not exist",
        )
        assert.equal(
          await database.delete("people", "missing-1"),
          false,
          "DELETE must return false when the requested record does not exist",
        )
      },
    })
  })

  test(`${name}: transaction failures roll back every record change`, async () => {
    await withDatabase({
      createDatabase,
      callback: async (database) => {
        const failure = new Error("abort the complete transaction")

        await assert.rejects(
          database.transaction((transaction) => {
            transaction.create("people", {
              id: "transaction-1",
              name: "Uncommitted",
            })
            throw failure
          }),
          (error) => error === failure,
          "A failed transaction must preserve the original callback error",
        )

        assert.equal(
          await database.readOne("people", "transaction-1"),
          null,
          "A failed transaction must roll back every record written by its callback",
        )
      },
    })
  })

  test(`${name}: provider capabilities are exposed as an immutable snapshot`, async () => {
    await withDatabase({
      createDatabase,
      callback: async (database) => {
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
      },
    })
  })

  test(`${name}: file-backed records survive a new database connection`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-contract-"))
    const filename = join(directory, "records.sqlite")

    try {
      await withDatabase({
        createDatabase,
        filename,
        callback: async (database) => {
          await database.create("people", {
            id: "persistent-1",
            name: "Stored",
          })
        },
      })

      await withDatabase({
        createDatabase,
        filename,
        callback: async (database) => {
          const record = await database.readOne("people", "persistent-1")
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
  })
}
