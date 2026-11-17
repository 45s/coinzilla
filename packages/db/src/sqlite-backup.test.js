import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createSqliteDatabase } from "../src/index.js"

async function createTemporaryDirectory() {
  return mkdtemp(join(tmpdir(), "coinzilla-db-backup-"))
}

async function readDatabaseValue({ filename, query, parameters = [] }) {
  const database = createSqliteDatabase({ filename })
  await database.connect()

  try {
    return database.prepare(query).get(...parameters)
  } finally {
    await database.close()
  }
}

test("file-backed SQLite backup includes committed WAL data and restores into a new database", async () => {
  const directory = await createTemporaryDirectory()
  const sourceFilename = join(directory, "source.sqlite")
  const backupFilename = join(directory, "backup.sqlite")
  const restoredFilename = join(directory, "restored.sqlite")
  const source = createSqliteDatabase({ filename: sourceFilename })
  await source.connect()

  try {
    source.exec("PRAGMA wal_autocheckpoint = 0")
    source.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    source.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("mode", "testnet")

    const copiedPages = await source.backup({
      destination: backupFilename,
      rate: 1,
    })

    assert.ok(
      Number.isSafeInteger(copiedPages) && copiedPages > 0,
      "A successful SQLite backup must report the positive number of pages copied",
    )
  } finally {
    await source.close()
  }

  try {
    const { restoreSqliteDatabase } = await import("../src/index.js")
    await restoreSqliteDatabase({
      backupFilename,
      filename: restoredFilename,
    })

    const restoredSetting = await readDatabaseValue({
      filename: restoredFilename,
      query: "SELECT value FROM settings WHERE key = ?",
      parameters: ["mode"],
    })

    assert.equal(
      restoredSetting.value,
      "testnet",
      "Restoring a backup must preserve committed records that were still in the source WAL",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("in-memory SQLite databases can be backed up to a restorable file", async () => {
  const directory = await createTemporaryDirectory()
  const backupFilename = join(directory, "memory-backup.sqlite")
  const database = createSqliteDatabase({ filename: ":memory:" })
  await database.connect()

  try {
    database.exec("CREATE TABLE memory_values (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    database.prepare("INSERT INTO memory_values (value) VALUES (?)").run("retained")

    const copiedPages = await database.backup({
      destination: backupFilename,
    })

    assert.ok(
      copiedPages > 0,
      "Backing up an in-memory SQLite database must create a non-empty persistent backup",
    )
  } finally {
    await database.close()
  }

  try {
    const { restoreSqliteDatabase } = await import("../src/index.js")
    const restoredFilename = join(directory, "memory-restored.sqlite")
    await restoreSqliteDatabase({
      backupFilename,
      filename: restoredFilename,
    })

    const restoredValue = await readDatabaseValue({
      filename: restoredFilename,
      query: "SELECT value FROM memory_values",
    })

    assert.equal(
      restoredValue.value,
      "retained",
      "A backup created from an in-memory database must restore the original rows",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite backup rejects invalid destinations and never backs up over its source", async () => {
  const directory = await createTemporaryDirectory()
  const filename = join(directory, "source.sqlite")
  const database = createSqliteDatabase({ filename })
  await database.connect()

  try {
    database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)")

    await assert.rejects(
      database.backup({ destination: filename }),
      /source.*destination/i,
      "A backup must reject a destination that resolves to the live source database",
    )
    await assert.rejects(
      database.backup({ destination: "" }),
      /destination/i,
      "A backup must reject an empty destination path before touching the filesystem",
    )
    await assert.rejects(
      database.backup({
        destination: join(directory, "invalid-rate.sqlite"),
        rate: 0,
      }),
      /rate/i,
      "A backup must reject a non-positive page transfer rate",
    )
    await assert.rejects(
      database.backup({
        destination: join(directory, "invalid-progress.sqlite"),
        progress: true,
      }),
      /progress/i,
      "A backup must reject a non-function progress callback",
    )
  } finally {
    await database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("failed SQLite backup preserves an existing backup and removes temporary artifacts", async () => {
  const directory = await createTemporaryDirectory()
  const sourceFilename = join(directory, "source.sqlite")
  const backupFilename = join(directory, "existing-backup.sqlite")
  const source = createSqliteDatabase({ filename: sourceFilename })
  const existingBackup = createSqliteDatabase({ filename: backupFilename })
  await source.connect()
  await existingBackup.connect()

  try {
    source.exec("CREATE TABLE source_records (id INTEGER PRIMARY KEY)")
    source.prepare("INSERT INTO source_records (id) VALUES (?)").run(1)
    existingBackup.exec("CREATE TABLE preserved_records (id INTEGER PRIMARY KEY)")
    existingBackup.prepare("INSERT INTO preserved_records (id) VALUES (?)").run(42)
  } finally {
    await existingBackup.close()
  }

  const progressFailure = new Error("stop backup from progress callback")

  try {
    await assert.rejects(
      source.backup({
        destination: backupFilename,
        rate: 1,
        progress() {
          throw progressFailure
        },
      }),
      (error) => error === progressFailure,
      "A caller progress-callback failure must reject the backup without being replaced by a provider error",
    )

    const preservedRecord = await readDatabaseValue({
      filename: backupFilename,
      query: "SELECT id FROM preserved_records",
    })

    assert.equal(
      preservedRecord.id,
      42,
      "A failed replacement backup must leave the previously valid backup untouched",
    )

    const directoryEntries = await readdir(directory)
    assert.deepEqual(
      directoryEntries.sort(),
      ["existing-backup.sqlite", "source.sqlite"],
      "A failed backup must remove every temporary directory and partial backup file",
    )
  } finally {
    await source.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite restore refuses to overwrite an existing destination", async () => {
  const directory = await createTemporaryDirectory()
  const backupFilename = join(directory, "backup.sqlite")
  const destinationFilename = join(directory, "existing.sqlite")
  const source = createSqliteDatabase({ filename: backupFilename })
  const destination = createSqliteDatabase({ filename: destinationFilename })
  await source.connect()
  await destination.connect()

  try {
    source.exec("CREATE TABLE backup_values (value TEXT NOT NULL)")
    source.prepare("INSERT INTO backup_values (value) VALUES (?)").run("backup")
    destination.exec("CREATE TABLE existing_values (value TEXT NOT NULL)")
    destination.prepare("INSERT INTO existing_values (value) VALUES (?)").run("keep")
  } finally {
    await source.close()
    await destination.close()
  }

  try {
    const { restoreSqliteDatabase } = await import("../src/index.js")
    await assert.rejects(
      restoreSqliteDatabase({
        backupFilename,
        filename: destinationFilename,
      }),
      /already exists/i,
      "Restore must refuse to replace an existing database file by default",
    )

    const retainedValue = await readDatabaseValue({
      filename: destinationFilename,
      query: "SELECT value FROM existing_values",
    })

    assert.equal(
      retainedValue.value,
      "keep",
      "A rejected restore must leave the pre-existing destination database unchanged",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite restore rejects corrupt backup files and does not publish a destination", async () => {
  const directory = await createTemporaryDirectory()
  const backupFilename = join(directory, "corrupt.sqlite")
  const destinationFilename = join(directory, "restored.sqlite")
  await writeFile(backupFilename, "not a SQLite database")

  try {
    const { restoreSqliteDatabase } = await import("../src/index.js")
    await assert.rejects(
      restoreSqliteDatabase({
        backupFilename,
        filename: destinationFilename,
      }),
      /restore|sqlite|database/i,
      "Restore must reject a corrupt or non-SQLite backup instead of publishing it",
    )

    await assert.rejects(
      stat(destinationFilename),
      (error) => error.code === "ENOENT",
      "A rejected restore must not publish any destination file",
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("SQLite close drains an active backup and rejects new backup requests", async () => {
  const directory = await createTemporaryDirectory()
  const sourceFilename = join(directory, "source.sqlite")
  const backupFilename = join(directory, "backup.sqlite")
  const rejectedBackupFilename = join(directory, "rejected.sqlite")
  const database = createSqliteDatabase({ filename: sourceFilename })
  await database.connect()
  let closePromise
  let backupAfterClosePromise

  try {
    database.exec("CREATE TABLE large_records (payload BLOB NOT NULL)")
    database.prepare("INSERT INTO large_records (payload) VALUES (?)").run(
      Buffer.alloc(2 * 1024 * 1024, 7),
    )

    const backupPromise = database.backup({
      destination: backupFilename,
      rate: 1,
      progress() {
        if (!closePromise) {
          closePromise = database.close()
          backupAfterClosePromise = assert.rejects(
            database.backup({
              destination: rejectedBackupFilename,
            }),
            /closing|closed/i,
            "The database must reject a new backup after shutdown has started",
          )
        }
      },
    })

    const copiedPages = await backupPromise
    assert.ok(
      closePromise instanceof Promise,
      "The backup progress callback must be able to begin closing while backup work is active",
    )
    await closePromise

    assert.ok(
      copiedPages > 0,
      "The in-flight backup must finish successfully before database shutdown completes",
    )
    await backupAfterClosePromise
    assert.equal(
      database.state,
      "closed",
      "The database must reach the closed state after its active backup has drained",
    )
  } finally {
    if (database.state !== "closed") {
      await database.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
