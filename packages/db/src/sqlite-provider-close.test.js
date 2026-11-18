import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError } from "./domain/errors/database-errors.js"
import { createSqliteProvider } from "./index.js"

test("SQLite provider close failures retain their cause and allow a safe retry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-provider-close-"))
  const provider = createSqliteProvider({
    filename: join(directory, "provider.sqlite"),
  })
  const originalClose = DatabaseSync.prototype.close
  const closeFailure = new Error("native SQLite close failed")
  let closeAttempts = 0
  await provider.connect()

  context.mock.method(DatabaseSync.prototype, "close", function close() {
    closeAttempts += 1
    if (closeAttempts === 1) {
      throw closeFailure
    }
    return originalClose.call(this)
  })

  try {
    await assert.rejects(
      provider.close(),
      (error) => error instanceof DatabaseProviderError && error.cause === closeFailure,
      "A native close failure must be translated to the provider error without losing its cause",
    )
    await provider.close()

    assert.equal(
      closeAttempts,
      2,
      "A failed provider close must remain retryable and release the connection on the next attempt",
    )
  } finally {
    context.mock.restoreAll()
    await provider.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
