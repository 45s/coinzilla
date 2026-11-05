import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase } from "../src/index.js"

test("SQLite connects and executes parameterized SQL", async () => {
  const database = createSqliteDatabase()
  await database.connect()

  try {
    database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
    database.prepare("INSERT INTO users (name) VALUES (?)").run("Morty")

    assert.deepEqual(
      database.prepare("SELECT id, name FROM users").all().map((row) => ({ ...row })),
      [{ id: 1, name: "Morty" }],
    )
    assert.equal(database.state, "connected")
  } finally {
    await database.close()
  }
})

test("SQLite transactions commit successful work", async () => {
  const database = createSqliteDatabase()
  await database.connect()

  try {
    database.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)")

    await database.transaction((transaction) => {
      transaction.prepare("INSERT INTO accounts (balance) VALUES (?)").run(100)
      transaction.prepare("UPDATE accounts SET balance = balance + 50 WHERE id = 1").run()
    })

    assert.equal(database.prepare("SELECT balance FROM accounts WHERE id = 1").get().balance, 150)
  } finally {
    await database.close()
  }
})

test("SQLite transactions roll back all writes when work throws", async () => {
  const database = createSqliteDatabase()
  await database.connect()

  try {
    database.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")

    await assert.rejects(
      database.transaction((transaction) => {
        transaction.prepare("INSERT INTO entries (value) VALUES (?)").run("first")
        throw new Error("abort transaction")
      }),
      /abort transaction/,
    )

    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM entries").get().count, 0)
    assert.equal(database.state, "connected")
  } finally {
    await database.close()
  }
})

test("SQLite rejects async transaction callbacks before invoking them", async () => {
  const database = createSqliteDatabase()
  await database.connect()
  let invoked = false

  try {
    await assert.rejects(
      database.transaction(async () => {
        invoked = true
      }),
      /must be synchronous/,
    )
    assert.equal(invoked, false)
    assert.equal(database.state, "connected")
  } finally {
    await database.close()
  }
})

test("SQLite rejects promise-returning transaction callbacks and rolls back", async () => {
  const database = createSqliteDatabase()
  await database.connect()

  try {
    database.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")

    await assert.rejects(
      database.transaction(() => {
        database.prepare("INSERT INTO entries (value) VALUES (?)").run("temporary")
        return Promise.resolve()
      }),
      /must be synchronous/,
    )

    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM entries").get().count, 0)
  } finally {
    await database.close()
  }
})

test("SQLite file databases persist data after closing and reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-"))
  const filename = join(directory, "coinzilla.sqlite")

  try {
    const first = createSqliteDatabase({ filename })
    await first.connect()
    first.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    first.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("mode", "test")
    await first.close()

    const second = createSqliteDatabase({ filename })
    await second.connect()
    try {
      assert.deepEqual(
        { ...second.prepare("SELECT key, value FROM settings").get() },
        { key: "mode", value: "test" },
      )
    } finally {
      await second.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("SQLite enforces foreign keys", async () => {
  const database = createSqliteDatabase()
  await database.connect()

  try {
    database.exec(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY);
      CREATE TABLE children (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parents(id)
      )
    `)

    assert.throws(
      () => database.prepare("INSERT INTO children (parent_id) VALUES (?)").run(404),
      /FOREIGN KEY constraint failed/,
    )
  } finally {
    await database.close()
  }
})

test("SQLite rejects invalid options", () => {
  assert.throws(() => createSqliteDatabase({ filename: "" }), /filename/)
  assert.throws(() => createSqliteDatabase({ timeout: -1 }), /timeout/)
  assert.throws(() => createSqliteDatabase({ timeout: 1.5 }), /timeout/)
})

test("SQLite operations require an open connection", async () => {
  const database = createSqliteDatabase()

  assert.throws(() => database.exec("SELECT 1"), /connected/)
  assert.throws(() => database.prepare("SELECT 1"), /connected/)

  await database.connect()
  await database.close()

  assert.throws(() => database.exec("SELECT 1"), /connected/)
  assert.throws(() => database.prepare("SELECT 1"), /connected/)
})
