import assert from "node:assert/strict"
import { access, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSqliteDatabase } from "@coinzilla/db"
import { resolveHarvesterDatabaseFilename } from "../resolve-harvester-database-filename.js"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "../relational-migrations.js"
import * as backupOperations from "./index.js"

const CREATED_AT = new Date("2026-11-20T04:15:30.000Z")
const BACKUP_ID = "00000000-0000-4000-8000-000000000001"
const LEGACY_RECORD = Object.freeze({
  id: "legacy-order-001",
  marker: "committed-in-wal",
})

async function createRelationalSource({ directory, tradingMode = "testnet" } = {}) {
  const env = {
    HARVESTER_DATABASE_DIRECTORY: directory,
    NODE_ENV: "production",
  }
  const filename = resolveHarvesterDatabaseFilename({
    tradingMode,
    env,
  })
  await mkdir(path.dirname(filename), { recursive: true })
  const database = createSqliteDatabase({ filename })
  await database.connect()
  await database.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
  database.exec(`
    CREATE TABLE db_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      record TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    )
  `)
  database.prepare(
    "INSERT INTO db_records (collection, id, record) VALUES (?, ?, ?)",
  ).run("harvester_orders", LEGACY_RECORD.id, JSON.stringify(LEGACY_RECORD))
  return { database, env, filename }
}

test("creates and restore-verifies an environment-scoped backup including committed WAL data", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-backup-"))
  let sourceDatabase
  t.after(async () => {
    await sourceDatabase?.close()
    await rm(directory, { recursive: true, force: true })
  })

  const source = await createRelationalSource({ directory })
  sourceDatabase = source.database
  const journalMode = sourceDatabase.prepare("PRAGMA journal_mode").get().journal_mode
  assert.equal(
    journalMode,
    "wal",
    "The source fixture must use WAL so this test proves committed WAL records are included in the online backup.",
  )

  assert.equal(
    typeof backupOperations.createHarvesterTradingHistoryBackupService,
    "function",
    "Harvester must expose an application-owned service for verified relational-history backups and restore checks.",
  )

  const service = backupOperations.createHarvesterTradingHistoryBackupService({
    env: {
      ...source.env,
      TRADING_MODE: "testnet",
    },
    now: () => CREATED_AT,
    createId: () => BACKUP_ID,
  })
  const result = await service.createBackup({ keep: 30 })

  assert.equal(
    result.environment,
    "testnet",
    "A TESTNET backup must retain its explicit trading environment even when NODE_ENV says production.",
  )
  assert.equal(
    path.basename(path.dirname(result.backupFilename)),
    "testnet",
    "A TESTNET backup must be stored below its dedicated environment directory.",
  )
  assert.equal(
    result.verified,
    true,
    "A backup must not be reported as complete until its restore verification succeeds.",
  )
  await access(result.backupFilename)
  await access(result.manifestFilename)

  const manifest = JSON.parse(await readFile(result.manifestFilename, "utf8"))
  assert.equal(manifest.formatVersion, 1, "The backup manifest must carry an explicit format version.")
  assert.equal(manifest.environment, "testnet", "The manifest must bind the backup to the selected trading environment.")
  assert.equal(manifest.createdAt, CREATED_AT.toISOString(), "The manifest must preserve the backup creation time in UTC.")
  assert.equal(manifest.filename, path.basename(result.backupFilename), "The manifest must identify only the backup filename, not an absolute source path.")
  assert.equal(manifest.schemaVersion, 3, "The manifest must record the latest applied Harvester relational migration.")
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/, "The manifest must contain a SHA-256 digest for the completed backup.")

  const restoredCheck = await service.verifyBackup({
    backupFilename: result.backupFilename,
  })
  assert.equal(restoredCheck.environment, "testnet", "A restore check must reject cross-environment backups and report the verified environment.")
  assert.equal(restoredCheck.schemaVersion, 3, "A restore check must validate the registered Harvester relational schema.")
  assert.equal(restoredCheck.verified, true, "A restore check must report success only after a temporary restored database passes validation.")

  const backupDatabase = createSqliteDatabase({
    filename: result.backupFilename,
  })
  await backupDatabase.connect()
  try {
    const copiedRecord = backupDatabase.prepare(
      "SELECT record FROM db_records WHERE collection = ? AND id = ?",
    ).get("harvester_orders", LEGACY_RECORD.id)
    assert.deepEqual(
      JSON.parse(copiedRecord.record),
      LEGACY_RECORD,
      "The backup must contain the committed source record that was still in the live WAL when backup began.",
    )
  } finally {
    await backupDatabase.close()
  }

  const sourceRecord = sourceDatabase.prepare(
    "SELECT record FROM db_records WHERE collection = ? AND id = ?",
  ).get("harvester_orders", LEGACY_RECORD.id)
  assert.deepEqual(
    JSON.parse(sourceRecord.record),
    LEGACY_RECORD,
    "Creating and verifying a backup must leave the configured source database unchanged.",
  )

  const backupFiles = await readdir(path.dirname(result.backupFilename))
  assert.deepEqual(
    backupFiles.sort(),
    [path.basename(result.backupFilename), path.basename(result.manifestFilename)].sort(),
    "A successful restore drill must clean its temporary candidate and leave only the verified backup pair.",
  )
})
