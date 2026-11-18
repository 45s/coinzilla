import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createDatabase, createSqliteProvider, createSqliteDatabase } from "../src/index.js"

async function createTemporaryDirectory() {
  return mkdtemp(join(tmpdir(), "coinzilla-db-runtime-"))
}

test("file-backed SQLite enables WAL and foreign keys with the configured busy timeout", async () => {
  const directory = await createTemporaryDirectory()
  const database = createSqliteDatabase({
    filename: join(directory, "runtime.sqlite"),
    timeout: 1_234,
  })
  await database.connect()

  try {
    assert.equal(
      database.prepare("PRAGMA journal_mode").get().journal_mode,
      "wal",
      "File-backed SQLite connections must enable WAL mode",
    )
    assert.equal(
      database.prepare("PRAGMA foreign_keys").get().foreign_keys,
      1,
      "Foreign-key enforcement must be enabled on every SQLite connection",
    )
    assert.equal(
      database.prepare("PRAGMA busy_timeout").get().timeout,
      1_234,
      "SQLite must apply the configured lock wait timeout to the native connection",
    )
    database.exec("CREATE TABLE foreign_key_parents (id INTEGER PRIMARY KEY)")
    database.exec("CREATE TABLE foreign_key_children (parent_id INTEGER REFERENCES foreign_key_parents(id))")
    assert.throws(
      () => database.prepare("INSERT INTO foreign_key_children (parent_id) VALUES (?)").run(42),
      /FOREIGN KEY constraint failed/,
      "SQLite must reject a row that violates an enabled foreign-key constraint",
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM foreign_key_children").get().count,
      0,
      "A rejected foreign-key write must not leave a partial row",
    )
  } finally {
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("in-memory SQLite keeps its native memory journal mode", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    assert.equal(
      database.prepare("PRAGMA journal_mode").get().journal_mode,
      "memory",
      "In-memory databases must not attempt to enable file-backed WAL mode",
    )
    assert.equal(
      database.prepare("PRAGMA foreign_keys").get().foreign_keys,
      1,
      "In-memory connections must enforce foreign keys just like file-backed connections",
    )
  } finally {
    await database.close()
  }
})

test("a directly used SQLite provider can reconnect after its previous low-level connection closes", async () => {
  const directory = await createTemporaryDirectory()
  const filename = join(directory, "provider-reconnect.sqlite")
  const provider = createSqliteProvider({ filename })
  const firstDatabase = createDatabase({ provider })
  await firstDatabase.connect()

  try {
    await firstDatabase.create({
      collection: "settings",
      record: {
        id: "mode",
        value: "testnet",
      },
    })
    await firstDatabase.close()

    await provider.connect()
    await provider.withTransaction((transaction) => {
      assert.deepEqual(
        transaction.readOne({
          collection: "settings",
          id: "mode",
        }),
        {
          id: "mode",
          value: "testnet",
        },
        "A provider reconnection must reopen the persistent SQLite file without losing committed records",
      )
    })
    await provider.close()
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
