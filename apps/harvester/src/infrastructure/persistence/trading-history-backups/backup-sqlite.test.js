import assert from "node:assert/strict"
import {
  mkdtemp,
  rm,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSqliteDatabase } from "@coinzilla/db"
import {
  createRelationalSource,
  LEGACY_RECORD,
} from "./test-support.js"
import {
  createOnlineBackup,
  restoreAndValidate,
} from "./backup-sqlite.js"
import {
  calculateSha256,
  createBackupManifest,
} from "./backup-manifest.js"

const CREATED_AT = new Date("2026-11-20T04:15:30.000Z")
const BACKUP_ID = "00000000-0000-4000-8000-000000000001"

async function createBackupFixture({ testContext } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-backup-sqlite-"))
  const source = await createRelationalSource({
    directory,
  })
  const cleanup = {
    database: source.database,
  }
  testContext.after(async () => {
    await cleanup.database.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const backupFilename = path.join(
    directory,
    `harvester-testnet-20261120T041530000Z-${BACKUP_ID}.sqlite`,
  )
  const backup = await createOnlineBackup({
    sourceFilename: source.filename,
    destinationFilename: backupFilename,
    backupRate: 100,
    environment: "testnet",
  })
  const sha256 = await calculateSha256(backupFilename)
  const manifest = createBackupManifest({
    environment: "testnet",
    createdAt: CREATED_AT,
    backupFilename,
    schemaVersion: backup.schemaVersion,
    sha256,
  })
  return {
    directory,
    source,
    backupFilename,
    manifest,
  }
}

test("creates an online SQLite backup that includes committed WAL records", async (t) => {
  const fixture = await createBackupFixture({
    testContext: t,
  })
  const backupDatabase = createSqliteDatabase({
    filename: fixture.backupFilename,
  })
  await backupDatabase.connect()
  try {
    const row = backupDatabase.prepare(
      "SELECT record FROM db_records WHERE collection = ? AND id = ?",
    ).get("harvester_orders", LEGACY_RECORD.id)
    assert.deepEqual(JSON.parse(row.record), LEGACY_RECORD)
  } finally {
    await backupDatabase.close()
  }
  assert.equal(fixture.source.database.prepare("SELECT COUNT(*) AS count FROM db_records").get().count, 1)
})

test("restores a verified backup to an independent candidate and validates it", async (t) => {
  const fixture = await createBackupFixture({
    testContext: t,
  })
  const temporaryDirectory = await mkdtemp(path.join(fixture.directory, "restore-check-"))
  t.after(() => rm(temporaryDirectory, {
    recursive: true,
    force: true,
  }))
  const beforeDigest = await calculateSha256(fixture.backupFilename)
  const result = await restoreAndValidate({
    backupFilename: fixture.backupFilename,
    temporaryDirectory,
    manifest: fixture.manifest,
    environment: "testnet",
  })
  const afterDigest = await calculateSha256(fixture.backupFilename)
  assert.equal(result.verified, true)
  assert.equal(result.schemaVersion, 4)
  assert.equal(result.rowCounts.orders, 0)
  assert.equal(beforeDigest, afterDigest)
})
