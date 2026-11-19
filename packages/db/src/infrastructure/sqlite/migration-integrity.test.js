import assert from "node:assert/strict"
import test from "node:test"

import { createSqliteDatabase } from "../../index.js"

test("applied migration definitions cannot change under the same version and name", async () => {
  const database = createSqliteDatabase({
    filename: ":memory:",
  })
  await database.connect()

  try {
    const originalMigration = {
      version: 1,
      name: "create-accounts",
      up(transaction) {
        transaction.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY)")
      },
    }

    await database.migrate([originalMigration])

    await assert.rejects(
      database.migrate([{
        version: 1,
        name: "create-accounts",
        up(transaction) {
          transaction.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT)")
        },
      }]),
      /checksum mismatch at version 1/,
      "An applied migration whose implementation changes must be rejected even when its version and name stay unchanged",
    )
  } finally {
    await database.close()
  }
})

test("tampered migration checksums are rejected", async () => {
  const database = createSqliteDatabase({
    filename: ":memory:",
  })
  await database.connect()

  try {
    const migration = {
      version: 1,
      name: "create-audit-records",
      up(transaction) {
        transaction.exec("CREATE TABLE audit_records (id INTEGER PRIMARY KEY)")
      },
    }

    await database.migrate([migration])
    database.prepare(
      "UPDATE schema_migrations SET checksum = ? WHERE version = ?",
    ).run("", 1)

    await assert.rejects(
      database.migrate([migration]),
      /checksum mismatch at version 1/,
      "A non-null but invalid or modified stored migration checksum must not be treated as legacy history",
    )
  } finally {
    await database.close()
  }
})

test("pending migrations cannot run before an already-applied higher version", async () => {
  const database = createSqliteDatabase({
    filename: ":memory:",
  })
  await database.connect()

  try {
    const secondMigration = {
      version: 2,
      name: "create-audit-records",
      up(transaction) {
        transaction.exec("CREATE TABLE audit_records (id INTEGER PRIMARY KEY)")
      },
    }

    await database.migrate([secondMigration])

    await assert.rejects(
      database.migrate([
        {
          version: 1,
          name: "create-accounts",
          up(transaction) {
            transaction.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY)")
          },
        },
        secondMigration,
      ]),
      /out of order/,
      "A missing lower migration must not be applied after a higher version is already recorded",
    )

    assert.deepEqual(
      database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
        .map(({ version }) => version),
      [2],
      "Rejecting an out-of-order migration must preserve the existing migration history",
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get().count,
      0,
      "Rejecting an out-of-order migration must leave its schema changes unapplied",
    )
  } finally {
    await database.close()
  }
})
