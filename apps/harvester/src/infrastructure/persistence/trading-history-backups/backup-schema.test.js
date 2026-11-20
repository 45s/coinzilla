import assert from "node:assert/strict"
import {
  mkdtemp,
  rm,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSqliteDatabase } from "@coinzilla/db"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "../relational-migrations.js"
import {
  assertCurrentSchema,
  readSchemaVersion,
  validateRestoredDatabase,
} from "./backup-schema.js"

async function createMigratedDatabase({ testContext } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-backup-schema-"))
  const cleanup = {
    database: null,
  }
  testContext.after(async () => {
    await cleanup.database?.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const database = createSqliteDatabase({
    filename: path.join(directory, "history.sqlite"),
  })
  cleanup.database = database
  await database.connect()
  await database.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
  return database
}

test("reads and validates the current relational schema and row counts", async (t) => {
  const database = await createMigratedDatabase({
    testContext: t,
  })
  assert.equal(readSchemaVersion(database), 3)
  assert.equal(assertCurrentSchema(database), 3)
  const result = await validateRestoredDatabase({
    database,
    manifest: {
      schemaVersion: 3,
    },
    environment: "testnet",
    backupFilename: "history.sqlite",
  })
  assert.equal(result.environment, "testnet")
  assert.equal(result.schemaVersion, 3)
  assert.deepEqual(result.rowCounts, {
    orders: 0,
    fills: 0,
    fill_commissions: 0,
    history_sync_cursors: 0,
  })
})

test("rejects an incomplete relational schema", async (t) => {
  const database = await createMigratedDatabase({
    testContext: t,
  })
  database.exec("DROP TABLE fills")
  assert.throws(
    () => assertCurrentSchema(database),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_SCHEMA_INVALID",
  )
})

test("rejects a manifest schema version that does not match the restored database", async (t) => {
  const database = await createMigratedDatabase({
    testContext: t,
  })
  await assert.rejects(
    validateRestoredDatabase({
      database,
      manifest: {
        schemaVersion: 2,
      },
      environment: "testnet",
      backupFilename: "history.sqlite",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_SCHEMA_INVALID",
  )
})
