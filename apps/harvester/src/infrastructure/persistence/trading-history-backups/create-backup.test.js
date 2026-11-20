import assert from "node:assert/strict"
import { access, lstat, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  assertBackupContainsRecord,
  assertFileMissing,
  assertManifest,
  assertSourceUnchanged,
  createEmptyFixture,
  createFixture,
  readBackupFiles,
} from "./test-support.js"

test("creates and restore-verifies an environment-scoped backup including committed WAL data", async (t) => {
  const fixture = await createFixture(t)
  const journalMode = fixture.source.database.prepare("PRAGMA journal_mode").get().journal_mode
  assert.equal(journalMode, "wal")

  const result = await fixture.service.createBackup({
    keep: 30,
  })
  assert.equal(result.environment, "testnet")
  assert.equal(path.basename(path.dirname(result.backupFilename)), "testnet")
  assert.equal(result.verified, true)
  const manifest = await assertManifest({
    result,
  })
  assert.equal(manifest.schemaVersion, 3)

  const restoreResult = await fixture.service.verifyBackup({
    backupFilename: result.backupFilename,
  })
  assert.equal(restoreResult.environment, "testnet")
  assert.equal(restoreResult.schemaVersion, 3)
  assert.equal(restoreResult.verified, true)
  await assertBackupContainsRecord({
    backupFilename: result.backupFilename,
  })
  await assertSourceUnchanged({
    database: fixture.source.database,
  })

  const files = await readBackupFiles({
    directory: fixture.backupDirectory,
  })
  assert.deepEqual(
    files,
    [path.basename(result.backupFilename), path.basename(result.manifestFilename)].sort(),
  )
})

test("does not create an empty source database when the configured file is missing", async (t) => {
  const fixture = await createEmptyFixture(t)
  await assert.rejects(
    fixture.service.createBackup(),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_SOURCE_UNAVAILABLE",
  )
  await assertFileMissing(fixture.sourceFilename)
})

test("does not overwrite a timestamped backup when the generated name collides", async (t) => {
  const fixture = await createFixture(t)
  const first = await fixture.service.createBackup()
  const originalBytes = await readFile(first.backupFilename)
  await assert.rejects(
    fixture.service.createBackup(),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_DESTINATION_CONFLICT",
  )
  assert.deepEqual(await readFile(first.backupFilename), originalBytes)
  await access(first.manifestFilename)
})

test("creates owner-only backup files and directories on POSIX systems", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows ACLs are configured by the service account, not POSIX mode bits.")
    return
  }
  const fixture = await createFixture(t)
  const result = await fixture.service.createBackup()
  const directoryStats = await lstat(fixture.backupDirectory)
  const fileStats = await lstat(result.backupFilename)
  assert.equal(directoryStats.mode & 0o777, 0o700)
  assert.equal(fileStats.mode & 0o777, 0o600)
})
