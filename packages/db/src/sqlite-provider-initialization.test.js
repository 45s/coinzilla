import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DatabaseProviderError, createSqliteProvider } from "./index.js"

test("SQLite provider closes a connected handle after schema initialization fails and can retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-provider-schema-failure-"))
  const filename = join(directory, "provider.sqlite")
  const setup = new DatabaseSync(filename)
  setup.exec("CREATE VIEW db_records AS SELECT 1 AS id")
  setup.close()
  const provider = createSqliteProvider({ filename })

  try {
    await assert.rejects(
      provider.connect(),
      (error) => error instanceof DatabaseProviderError
        && /view db_records already exists/i.test(error.cause.message),
      "A schema initialization failure after native connection setup must be translated and retain its SQLite cause",
    )

    const repair = new DatabaseSync(filename)
    repair.exec("DROP VIEW db_records")
    repair.close()

    await provider.connect()
    await provider.close()
  } finally {
    await provider.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
