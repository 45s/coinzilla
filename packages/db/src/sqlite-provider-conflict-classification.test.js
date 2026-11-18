import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseConflictError, createDatabase, createSqliteProvider } from "./index.js"

test("SQLite maps primary-key, unique-index, and unique-message constraint failures to conflicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-conflict-classification-"))
  const filename = join(directory, "provider.sqlite")
  const database = createDatabase({
    provider: createSqliteProvider({ filename }),
  })
  await database.connect()
  const schemaConnection = new DatabaseSync(filename)

  try {
    schemaConnection.exec(
      "CREATE UNIQUE INDEX db_records_collection_unique ON db_records (collection)",
    )
    await database.create({
      collection: "indexed-collection",
      record: {
        id: "first",
        value: "one",
      },
    })
    await assert.rejects(
      database.create({
        collection: "indexed-collection",
        record: {
          id: "second",
          value: "two",
        },
      }),
      DatabaseConflictError,
      "A native SQLITE_CONSTRAINT_UNIQUE error must be classified as a record conflict",
    )

    schemaConnection.exec("DROP INDEX db_records_collection_unique")
    schemaConnection.exec("CREATE TRIGGER force_unique_message BEFORE INSERT ON db_records BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: db_records.record'); END")
    await assert.rejects(
      database.create({
        collection: "message-classification",
        record: {
          id: "triggered",
          value: "three",
        },
      }),
      DatabaseConflictError,
      "A unique-constraint message from a non-unique SQLite constraint code must use the compatibility fallback",
    )
  } finally {
    schemaConnection.close()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
