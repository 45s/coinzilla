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
  await mkdir(path.dirname(filename), {
    recursive: true,
  })
  const database = createSqliteDatabase({
    filename,
  })
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
  return {
    database,
    env,
    filename,
  }
}

async function assertManifest({ result }) {
  await access(result.backupFilename)
  await access(result.manifestFilename)
  const manifest = JSON.parse(await readFile(result.manifestFilename, "utf8"))
  assert.equal(manifest.formatVersion, 1)
  assert.equal(manifest.environment, "testnet")
  assert.equal(manifest.createdAt, CREATED_AT.toISOString())
  assert.equal(manifest.filename, path.basename(result.backupFilename))
  assert.equal(manifest.schemaVersion, 3)
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/)
}

async function assertBackupContainsRecord({ backupFilename }) {
  const database = createSqliteDatabase({
    filename: backupFilename,
  })
  await database.connect()
  try {
    const row = database.prepare(
      "SELECT record FROM db_records WHERE collection = ? AND id = ?",
    ).get("harvester_orders", LEGACY_RECORD.id)
    assert.deepEqual(JSON.parse(row.record), LEGACY_RECORD)
  } finally {
    await database.close()
  }
}

async function assertSourceUnchanged({ database }) {
  const row = database.prepare(
    "SELECT record FROM db_records WHERE collection = ? AND id = ?",
  ).get("harvester_orders", LEGACY_RECORD.id)
  assert.deepEqual(JSON.parse(row.record), LEGACY_RECORD)
}

test("creates and restore-verifies an environment-scoped backup including committed WAL data", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-backup-"))
  const source = await createRelationalSource({
    directory,
  })
  t.after(async () => {
    await source.database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })

  const journalMode = source.database.prepare("PRAGMA journal_mode").get().journal_mode
  assert.equal(journalMode, "wal")
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
  const result = await service.createBackup({
    keep: 30,
  })
  assert.equal(result.environment, "testnet")
  assert.equal(path.basename(path.dirname(result.backupFilename)), "testnet")
  assert.equal(result.verified, true)

  await assertManifest({
    result,
  })
  const restoreResult = await service.verifyBackup({
    backupFilename: result.backupFilename,
  })
  assert.equal(restoreResult.environment, "testnet")
  assert.equal(restoreResult.schemaVersion, 3)
  assert.equal(restoreResult.verified, true)
  await assertBackupContainsRecord({
    backupFilename: result.backupFilename,
  })
  await assertSourceUnchanged({
    database: source.database,
  })

  const backupFiles = await readdir(path.dirname(result.backupFilename))
  assert.deepEqual(
    backupFiles.sort(),
    [path.basename(result.backupFilename), path.basename(result.manifestFilename)].sort(),
  )
})
