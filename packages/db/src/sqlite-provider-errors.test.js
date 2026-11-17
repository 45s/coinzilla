import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  createDatabase,
  createSqliteProvider,
  DatabaseProviderError,
} from "./index.js"

test("SQLite connection failures use the provider-neutral error contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-open-error-"))
  const database = createDatabase({
    provider: createSqliteProvider({
      filename: directory,
    }),
  })

  try {
    await assert.rejects(
      database.connect(),
      (error) => error instanceof DatabaseProviderError
        && error.code === "DB_PROVIDER_OPERATION_FAILED"
        && error.cause instanceof Error,
      "A failed SQLite connection must expose the shared provider error and preserve its native cause",
    )
  } finally {
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite lock failures use the provider-neutral error contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-lock-error-"))
  const filename = join(directory, "locked.sqlite")
  const database = createDatabase({
    provider: createSqliteProvider({
      filename,
      timeout: 0,
    }),
  })
  await database.connect()

  const competingConnection = new DatabaseSync(filename, {
    timeout: 0,
  })

  try {
    competingConnection.exec("BEGIN IMMEDIATE")

    await assert.rejects(
      database.create({
        collection: "people",
        record: {
          id: "locked-write-1",
          name: "Blocked",
        },
      }),
      (error) => error instanceof DatabaseProviderError
        && error.code === "DB_PROVIDER_OPERATION_FAILED"
        && error.cause instanceof Error,
      "A SQLite lock failure must not leak its provider-native error to the generic database consumer",
    )
  } finally {
    competingConnection.exec("ROLLBACK")
    competingConnection.close()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite query execution failures use the provider-neutral error contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-statement-error-"))
  const filename = join(directory, "records.sqlite")
  const database = createDatabase({
    provider: createSqliteProvider({
      filename,
    }),
  })
  await database.connect()

  const externalConnection = new DatabaseSync(filename)

  try {
    externalConnection.exec("DROP TABLE db_records")

    await assert.rejects(
      database.readOne({
        collection: "people",
        id: "missing-1",
      }),
      (error) => error instanceof DatabaseProviderError
        && error.code === "DB_PROVIDER_OPERATION_FAILED"
        && error.cause instanceof Error,
      "A SQLite query execution failure must be normalized before it reaches the generic consumer",
    )
  } finally {
    externalConnection.close()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
