import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError, createSqliteProvider } from "./index.js"

test("SQLite provider aggregates schema initialization and close failures, then can retry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-provider-schema-failure-"))
  const filename = join(directory, "provider.sqlite")
  const setup = new DatabaseSync(filename)
  setup.exec("CREATE VIEW db_records AS SELECT 1 AS id")
  setup.close()
  const provider = createSqliteProvider({ filename })
  const originalClose = DatabaseSync.prototype.close
  const closeFailure = new Error("provider cleanup close failed")
  let closeAttempts = 0
  context.mock.method(DatabaseSync.prototype, "close", function close() {
    closeAttempts += 1
    if (closeAttempts === 1) {
      throw closeFailure
    }
    return originalClose.call(this)
  })

  try {
    await assert.rejects(
      provider.connect(),
      (error) => error instanceof DatabaseProviderError
        && error.cause instanceof AggregateError
        && /view db_records already exists/i.test(error.cause.errors[0].message)
        && error.cause.errors[1] === closeFailure,
      "A schema initialization failure and its cleanup failure must both be preserved by the provider",
    )
    assert.equal(closeAttempts, 1)

    context.mock.restoreAll()
    await provider.close()
    const repair = new DatabaseSync(filename)
    repair.exec("DROP VIEW db_records")
    repair.close()

    await provider.connect()
    await provider.close()
  } finally {
    context.mock.restoreAll()
    await provider.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
