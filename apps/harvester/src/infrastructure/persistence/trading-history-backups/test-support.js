import assert from "node:assert/strict"
import { access, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSqliteDatabase } from "@coinzilla/db"
import { resolveHarvesterDatabaseFilename } from "../resolve-harvester-database-filename.js"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "../relational-migrations.js"
import * as backupOperations from "./index.js"

export const CREATED_AT = new Date("2026-11-20T04:15:30.000Z")
export const BACKUP_ID = "00000000-0000-4000-8000-000000000001"
export const LEGACY_RECORD = Object.freeze({
  id: "legacy-order-001",
  marker: "committed-in-wal",
})

export function createBackupService({ env, now, createId } = {}) {
  assert.equal(
    typeof backupOperations.createHarvesterTradingHistoryBackupService,
    "function",
    "Harvester must expose an application-owned service for verified relational-history backups and restore checks.",
  )
  return backupOperations.createHarvesterTradingHistoryBackupService({
    env,
    now,
    createId,
  })
}

export async function createRelationalSource({ directory, tradingMode = "testnet" } = {}) {
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

export async function createFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-backup-"))
  const cleanup = {
    database: null,
  }
  t.after(async () => {
    await cleanup.database?.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const tradingMode = options.tradingMode ?? "testnet"
  const source = await createRelationalSource({
    directory,
    tradingMode,
  })
  cleanup.database = source.database
  const env = {
    ...source.env,
    TRADING_MODE: tradingMode,
    BINANCE_API_KEY: "never-copy-this-secret",
  }
  const service = createBackupService({
    env,
    now: options.now ?? (() => CREATED_AT),
    createId: options.createId ?? (() => BACKUP_ID),
  })
  return {
    directory,
    env,
    source,
    service,
    backupDirectory: path.join(
      directory,
      "backups",
      tradingMode === "live" ? "production" : "testnet",
    ),
  }
}

export async function createEmptyFixture(t, { tradingMode = "testnet" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-history-empty-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const env = {
    HARVESTER_DATABASE_DIRECTORY: directory,
    NODE_ENV: "production",
    TRADING_MODE: tradingMode,
  }
  return {
    directory,
    env,
    sourceFilename: resolveHarvesterDatabaseFilename({
      tradingMode,
      env,
    }),
    service: createBackupService({ env }),
  }
}

export async function assertManifest({ result, directory } = {}) {
  await access(result.backupFilename)
  await access(result.manifestFilename)
  const manifest = JSON.parse(await readFile(result.manifestFilename, "utf8"))
  assert.equal(manifest.formatVersion, 1)
  assert.equal(manifest.environment, "testnet")
  assert.equal(manifest.createdAt, CREATED_AT.toISOString())
  assert.equal(manifest.filename, path.basename(result.backupFilename))
  assert.equal(manifest.schemaVersion, 3)
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(manifest).includes("never-copy-this-secret"), false)
  assert.equal(JSON.stringify(manifest).includes(directory), false)
  return manifest
}

export async function assertBackupContainsRecord({ backupFilename } = {}) {
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

export async function assertSourceUnchanged({ database } = {}) {
  const row = database.prepare(
    "SELECT record FROM db_records WHERE collection = ? AND id = ?",
  ).get("harvester_orders", LEGACY_RECORD.id)
  assert.deepEqual(JSON.parse(row.record), LEGACY_RECORD)
}

export async function readBackupFiles({ directory } = {}) {
  return (await readdir(directory)).sort()
}

export async function assertFileMissing(filename) {
  await assert.rejects(access(filename), {
    code: "ENOENT",
  })
}

export async function readManifest(filename) {
  return JSON.parse(await readFile(filename, "utf8"))
}
