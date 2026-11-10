import assert from "node:assert/strict"
import test from "node:test"

import { createSqliteDatabase } from "../src/index.js"

test("migrations run in ascending version order and are recorded", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    const applied = await database.migrate([
      {
        version: 2,
        name: "add-status",
        up(transaction) {
          transaction.exec("ALTER TABLE records ADD COLUMN status TEXT NOT NULL DEFAULT 'new'")
        },
      },
      {
        version: 1,
        name: "create-records",
        up(transaction) {
          transaction.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
        },
      },
    ])

    assert.deepEqual(applied, [1, 2])
    assert.deepEqual(
      database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()
        .map((row) => ({ ...row })),
      [
        { version: 1, name: "create-records" },
        { version: 2, name: "add-status" },
      ],
    )
    assert.deepEqual(database.prepare("PRAGMA table_info(records)").all().map(({ name }) => name), [
      "id",
      "value",
      "status",
    ])
  } finally {
    await database.close()
  }
})

test("migrations are idempotent and only newly pending versions are applied", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()
  let executions = 0

  const migrations = [{
    version: 1,
    name: "create-records",
    up(transaction) {
      executions += 1
      transaction.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)")
    },
  }]

  try {
    assert.deepEqual(await database.migrate(migrations), [1])
    assert.deepEqual(await database.migrate(migrations), [])
    assert.equal(executions, 1)
  } finally {
    await database.close()
  }
})

test("a failed migration rolls back schema changes and migration records", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    await assert.rejects(
      database.migrate([
        {
          version: 1,
          name: "create-records",
          up(transaction) {
            transaction.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)")
          },
        },
        {
          version: 2,
          name: "fail",
          up() {
            throw new Error("migration failed")
          },
        },
      ]),
      /migration failed/,
    )

    assert.deepEqual(
      database.prepare("SELECT version FROM schema_migrations").all(),
      [],
    )
    assert.throws(() => database.prepare("SELECT * FROM records").all(), /no such table/)
  } finally {
    await database.close()
  }
})

test("migrations reject duplicate or invalid versions before changing the database", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    await assert.rejects(database.migrate([
      { version: 1, name: "one", up() {} },
      { version: 1, name: "duplicate", up() {} },
    ]), /unique positive integer versions/)

    await assert.rejects(database.migrate([
      { version: 0, name: "zero", up() {} },
    ]), /positive safe integer/)

    assert.throws(() => database.prepare("SELECT * FROM schema_migrations"), /no such table/)
  } finally {
    await database.close()
  }
})

test("migrations reject missing names and migration functions", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    await assert.rejects(database.migrate([
      { version: 1, name: "", up() {} },
    ]), /name/)

    await assert.rejects(database.migrate([
      { version: 1, name: "missing-up" },
    ]), /up function/)

    assert.throws(() => database.prepare("SELECT * FROM schema_migrations"), /no such table/)
  } finally {
    await database.close()
  }
})

test("migration history mismatches fail instead of silently changing applied schema", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    const migration = {
      version: 1,
      name: "create-records",
      up(transaction) {
        transaction.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)")
      },
    }

    await database.migrate([migration])
    database.prepare("UPDATE schema_migrations SET name = ? WHERE version = 1").run("renamed")

    await assert.rejects(database.migrate([migration]), /history mismatch at version 1/)
  } finally {
    await database.close()
  }
})

test("migration validation rejects non-arrays and non-object entries", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    await assert.rejects(database.migrate(null), /must be an array/)
    await assert.rejects(database.migrate([null]), /must be an object/)
    assert.throws(() => database.prepare("SELECT * FROM schema_migrations"), /no such table/)
  } finally {
    await database.close()
  }
})

test("async migration functions are rejected before execution", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()
  let invoked = false

  try {
    await assert.rejects(database.migrate([{
      version: 1,
      name: "async-migration",
      async up() {
        invoked = true
      },
    }]), /must be synchronous/)

    assert.equal(invoked, false)
    assert.throws(() => database.prepare("SELECT * FROM schema_migrations"), /no such table/)
  } finally {
    await database.close()
  }
})

test("promise-returning migration functions roll back the migration", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    await assert.rejects(database.migrate([{
      version: 1,
      name: "promise-migration",
      up(transaction) {
        transaction.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)")
        return Promise.resolve()
      },
    }]), /must be synchronous/)

    assert.deepEqual(database.prepare("SELECT version FROM schema_migrations").all(), [])
    assert.throws(() => database.prepare("SELECT * FROM records").all(), /no such table/)
  } finally {
    await database.close()
  }
})
