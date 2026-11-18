import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError, createDatabase, createSqliteProvider } from "./index.js"

async function createConcurrencyFixture() {
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

  return {
    directory,
    database,
    competingConnection: new DatabaseSync(filename, {
      timeout: 0,
    }),
  }
}

async function verifyReadsDuringWriteReservation({ database, competingConnection }) {
  competingConnection.exec("BEGIN IMMEDIATE")

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
}

async function closeConcurrencyFixture({ directory, database, competingConnection }) {
  if (competingConnection.isTransaction) {
    competingConnection.exec("ROLLBACK")
  }
  competingConnection.close()
  await database.close()
  await rm(directory, {
    recursive: true,
    force: true,
  })
}

test("SQLite reads remain available while another connection holds a write reservation", async () => {
  const fixture = await createConcurrencyFixture()

  try {
    await verifyReadsDuringWriteReservation(fixture)
  } finally {
    await closeConcurrencyFixture(fixture)
  }
})


test("SQLite surfaces a busy writer error when the configured timeout is zero", async () => {
  const fixture = await createConcurrencyFixture()

  try {
    fixture.competingConnection.exec("BEGIN IMMEDIATE")

    await assert.rejects(
      fixture.database.create({
        collection: "people",
        record: {
          id: "blocked-write",
          name: "Must not commit",
        },
      }),
      (error) => error instanceof DatabaseProviderError
        && /database is locked/i.test(error.cause.message),
      "A writer blocked beyond a zero-millisecond busy timeout must surface the native SQLite busy error",
    )
    assert.equal(
      await fixture.database.readOne({
        collection: "people",
        id: "blocked-write",
      }),
      null,
      "A write rejected by SQLite lock contention must not leave a partial record",
    )
  } finally {
    await closeConcurrencyFixture(fixture)
  }
})
