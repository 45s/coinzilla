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
  const provider = createSqliteProvider({ filename })
  const originalExec = DatabaseSync.prototype.exec
  const originalClose = DatabaseSync.prototype.close
  const schemaFailure = new Error("provider schema initialization failed")
  const closeFailure = new Error("provider cleanup close failed")
  let closeAttempts = 0

  context.mock.method(DatabaseSync.prototype, "exec", function exec(...args) {
    if (args[0].includes("CREATE TABLE IF NOT EXISTS db_records")) {
      throw schemaFailure
    }
    return originalExec.apply(this, args)
  })
  context.mock.method(DatabaseSync.prototype, "close", function close(...parameters) {
    closeAttempts += 1
    if (closeAttempts === 1) {
      throw closeFailure
    }
    return originalClose.call(this, ...parameters)
  })

  try {
    await assert.rejects(
      provider.connect(),
      (error) => error instanceof DatabaseProviderError
        && error.cause instanceof AggregateError
        && error.cause.errors[0] === schemaFailure
        && error.cause.errors[1] === closeFailure,
      "A schema initialization failure and its cleanup failure must both be preserved by the provider",
    )
    assert.equal(closeAttempts, 1)

    context.mock.restoreAll()
    await provider.close()
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
