import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase, restoreSqliteDatabase } from "../src/index.js"

async function createTemporaryDirectory() {
  return mkdtemp(join(tmpdir(), "coinzilla-db-backup-concurrency-"))
}

async function readRestoredValue({ filename, query, parameters = [] }) {
  const database = createSqliteDatabase({ filename })
  await database.connect()

  try {
    return database.prepare(query).get(...parameters)
  } finally {
    await database.close()
  }
}

async function createRestoreBackup({ backupFilename }) {
  const source = createSqliteDatabase({ filename: backupFilename })
  await source.connect()

  try {
    source.exec("CREATE TABLE restore_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
    source.prepare("INSERT INTO restore_records (id, value) VALUES (?, ?)").run(
      "retained",
      "complete-backup",
    )
  } finally {
    await source.close()
  }
}

async function verifyConcurrentRestoreAttempts({ backupFilename, destinationFilename }) {
  const restoreAttempts = await Promise.allSettled([
    restoreSqliteDatabase({
      backupFilename,
      filename: destinationFilename,
      rate: 1,
    }),
    restoreSqliteDatabase({
      backupFilename,
      filename: destinationFilename,
      rate: 1,
    }),
  ])
  const successfulRestores = restoreAttempts.filter(
    (attempt) => attempt.status === "fulfilled",
  )
  const rejectedRestores = restoreAttempts.filter(
    (attempt) => attempt.status === "rejected",
  )

  assert.equal(
    successfulRestores.length,
    1,
    "Concurrent no-overwrite restore attempts targeting one path must publish exactly one winner",
  )
  assert.equal(
    rejectedRestores.length,
    1,
    "The losing concurrent restore must reject instead of replacing the published database",
  )
  assert.ok(
    rejectedRestores[0].reason instanceof TypeError,
    "A destination race must be reported as an explicit existing-destination conflict",
  )

  const restoredRecord = await readRestoredValue({
    filename: destinationFilename,
    query: "SELECT id, value FROM restore_records WHERE id = ?",
    parameters: ["retained"],
  })
  assert.deepEqual(
    {
      id: restoredRecord.id,
      value: restoredRecord.value,
    },
    {
      id: "retained",
      value: "complete-backup",
    },
    "The winning restore must publish the complete validated backup without partial or mixed contents",
  )
}

test("SQLite online backup includes a committed WAL write made while backup pages are copied", async () => {
  const directory = await createTemporaryDirectory()
  const sourceFilename = join(directory, "source.sqlite")
  const backupFilename = join(directory, "backup.sqlite")
  const source = createSqliteDatabase({ filename: sourceFilename })
  await source.connect()
  const writer = new DatabaseSync(sourceFilename, { timeout: 5_000 })
  let concurrentWriteCommitted = false

  try {
    source.exec("PRAGMA wal_autocheckpoint = 0")
    source.exec("CREATE TABLE backup_records (id TEXT PRIMARY KEY, payload BLOB)")
    source.prepare("INSERT INTO backup_records (id, payload) VALUES (?, ?)").run(
      "initial",
      Buffer.alloc(2 * 1024 * 1024, 1),
    )

    const copiedPages = await source.backup({
      destination: backupFilename,
      rate: 1,
      progress(state) {
        assert.ok(
          Object.isFrozen(state),
          "SQLite backup progress snapshots must be immutable",
        )
        const { remainingPages } = state
        if (remainingPages > 0 && !concurrentWriteCommitted) {
          writer.prepare(
            "INSERT INTO backup_records (id, payload) VALUES (?, ?)",
          ).run("concurrent", Buffer.from("committed-during-backup"))
          concurrentWriteCommitted = true
        }
      },
    })

    assert.ok(
      copiedPages > 0,
      "The online backup must copy real SQLite pages from the WAL-backed source database",
    )
    assert.equal(
      concurrentWriteCommitted,
      true,
      "The controlled progress callback must commit a second-connection write before the online backup finishes",
    )

    const copiedRecord = await readRestoredValue({
      filename: backupFilename,
      query: "SELECT id, payload FROM backup_records WHERE id = ?",
      parameters: ["concurrent"],
    })
    assert.equal(
      copiedRecord.id,
      "concurrent",
      "A successful online backup must represent a consistent source state that includes a write committed during the backup",
    )
    assert.equal(
      Buffer.from(copiedRecord.payload).toString(),
      "committed-during-backup",
      "The concurrently committed WAL record must retain its complete payload in the published backup",
    )
  } finally {
    writer.close()
    await source.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("concurrent SQLite restores publish exactly one complete database without overwriting the winner", async () => {
  const directory = await createTemporaryDirectory()
  const backupFilename = join(directory, "backup.sqlite")
  const destinationFilename = join(directory, "restored.sqlite")

  try {
    await createRestoreBackup({ backupFilename })
    await verifyConcurrentRestoreAttempts({
      backupFilename,
      destinationFilename,
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


async function createBackupSource({ filename, origin }) {
  const database = createSqliteDatabase({ filename })
  await database.connect()
  database.exec("CREATE TABLE backup_origins (origin TEXT PRIMARY KEY, payload BLOB NOT NULL)")
  database.prepare("INSERT INTO backup_origins (origin, payload) VALUES (?, ?)").run(
    origin,
    Buffer.from(`${origin}-complete-snapshot`),
  )
  return database
}

async function verifyConcurrentBackupDestination({ first, second, destination }) {
  const copiedPages = await Promise.all([
    first.backup({
      destination,
      rate: 1,
    }),
    second.backup({
      destination,
      rate: 1,
    }),
  ])
  assert.ok(
    copiedPages.every((pages) => Number.isSafeInteger(pages) && pages > 0),
    "Each concurrent backup must report a positive number of copied SQLite pages",
  )

  const record = await readRestoredValue({
    filename: destination,
    query: "SELECT origin, payload FROM backup_origins",
  })
  assert.ok(
    ["first", "second"].includes(record.origin),
    "The shared destination must contain one complete source snapshot rather than mixed data",
  )
  assert.equal(
    Buffer.from(record.payload).toString(),
    `${record.origin}-complete-snapshot`,
    "The final atomically published backup must retain the winning source's complete payload",
  )
}

test("concurrent SQLite backups to one destination publish one complete validated snapshot", async () => {
  const directory = await createTemporaryDirectory()
  const first = await createBackupSource({
    filename: join(directory, "first.sqlite"),
    origin: "first",
  })
  const second = await createBackupSource({
    filename: join(directory, "second.sqlite"),
    origin: "second",
  })
  const destination = join(directory, "shared-backup.sqlite")

  try {
    await verifyConcurrentBackupDestination({
      first,
      second,
      destination,
    })
  } finally {
    await Promise.all([first.close(), second.close()])
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
