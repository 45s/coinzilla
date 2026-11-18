import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
        {
          version: 1,
          name: "create-records",
        },
        {
          version: 2,
          name: "add-status",
        },
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
      {
        version: 1,
        name: "one",
        up() {},
      },
      {
        version: 1,
        name: "duplicate",
        up() {},
      },
    ]), /unique positive integer versions/)

    await assert.rejects(database.migrate([
      {
        version: 0,
        name: "zero",
        up() {},
      },
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
      {
        version: 1,
        name: "",
        up() {},
      },
    ]), /name/)

    await assert.rejects(database.migrate([
      {
        version: 1,
        name: "missing-up",
      },
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


test("migrations reject duplicate names even when their versions differ", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    await assert.rejects(
      database.migrate([
        {
          version: 1,
          name: "duplicate-name",
          up() {},
        },
        {
          version: 2,
          name: "duplicate-name",
          up() {},
        },
      ]),
      /names must be non-empty and unique/,
      "Distinct migration versions must not reuse one migration identity name",
    )
    assert.throws(
      () => database.prepare("SELECT * FROM schema_migrations"),
      /no such table/,
      "Invalid duplicate migration definitions must fail before creating the migration history table",
    )
  } finally {
    await database.close()
  }
})

test("migration thenable inspection failures roll back schema changes", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()
  const thenFailure = new Error("migration then getter failed")
  const thenable = Object.defineProperty({}, "then", {
    get() {
      throw thenFailure
    },
  })

  try {
    await assert.rejects(
      database.migrate([{
        version: 1,
        name: "thenable-inspection",
        up(transaction) {
          transaction.exec("CREATE TABLE temporary_records (id INTEGER PRIMARY KEY)")
          return thenable
        },
      }]),
      (error) => error === thenFailure,
      "A throwing migration then getter must preserve its cause and abort migration execution",
    )
    assert.deepEqual(
      database.prepare("SELECT version FROM schema_migrations").all(),
      [],
      "A migration that fails thenable inspection must not be recorded as applied",
    )
    assert.throws(
      () => database.prepare("SELECT * FROM temporary_records").all(),
      /no such table/,
      "Schema changes from a migration with a throwing then getter must roll back",
    )
  } finally {
    await database.close()
  }
})


test("independent SQLite connections applying the same migrations record each version once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coinzilla-db-migration-concurrency-"))
  const filename = join(directory, "shared.sqlite")
  const first = createSqliteDatabase({ filename })
  const second = createSqliteDatabase({ filename })
  let migrationExecutions = 0
  const migrations = [{
    version: 1,
    name: "create-shared-records",
    up(transaction) {
      migrationExecutions += 1
      transaction.exec("CREATE TABLE shared_records (id INTEGER PRIMARY KEY)")
    },
  }]
  await first.connect()
  await second.connect()

  try {
    const results = await Promise.all([
      first.migrate(migrations),
      second.migrate(migrations),
    ])

    assert.deepEqual(
      results,
      [[1], []],
      "Concurrent independent migration requests must apply a shared version once and report no duplicate work",
    )
    assert.equal(
      migrationExecutions,
      1,
      "The migration callback must execute exactly once across independent SQLite connections",
    )
    assert.equal(
      second.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count,
      1,
      "Both connections must observe one durable migration-history record",
    )
  } finally {
    await Promise.all([first.close(), second.close()])
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("rejected migration promises are consumed while the migration transaction rolls back", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()
  const rejectedMigration = Promise.reject(new Error("deferred migration rejection"))

  try {
    await assert.rejects(
      database.migrate([{
        version: 1,
        name: "rejected-promise-migration",
        up(transaction) {
          transaction.exec("CREATE TABLE rejected_records (id INTEGER PRIMARY KEY)")
          return rejectedMigration
        },
      }]),
      /must be synchronous/,
      "A rejected promise returned from a migration must still reject the synchronous migration contract",
    )
    await Promise.resolve()
    assert.deepEqual(
      database.prepare("SELECT version FROM schema_migrations").all(),
      [],
      "A rejected migration promise must not leave a migration history record",
    )
    assert.throws(
      () => database.prepare("SELECT * FROM rejected_records").all(),
      /no such table/,
      "A rejected migration promise must roll back its schema changes",
    )
  } finally {
    await database.close()
  }
})
