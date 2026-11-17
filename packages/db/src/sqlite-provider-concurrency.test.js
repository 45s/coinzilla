import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createDatabase, createSqliteProvider } from "./index.js"

test("SQLite reads remain available while another connection holds a write reservation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-concurrency-"))
  const filename = join(directory, "records.sqlite")
  const database = createDatabase({
    provider: createSqliteProvider({
      filename,
      timeout: 0,
    }),
  })
  await database.connect()

  await database.create({
    collection: "people",
    record: {
      id: "readable-1",
      name: "Committed",
      status: "active",
    },
  })

  const competingConnection = new DatabaseSync(filename, {
    timeout: 0,
  })
  let writeReservationStarted = false

  try {
    competingConnection.exec("BEGIN IMMEDIATE")
    writeReservationStarted = true

    assert.deepEqual(
      await database.readOne({
        collection: "people",
        id: "readable-1",
      }),
      {
        id: "readable-1",
        name: "Committed",
        status: "active",
      },
      "A WAL reader must not require a competing write reservation",
    )

    assert.deepEqual(
      await database.readMany({
        collection: "people",
        query: {
          filter: {
            status: "active",
          },
        },
      }),
      [{
        id: "readable-1",
        name: "Committed",
        status: "active",
      }],
      "Collection queries must remain available while another connection holds an uncommitted write transaction",
    )
  } finally {
    if (writeReservationStarted) {
      competingConnection.exec("ROLLBACK")
    }
    competingConnection.close()
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
