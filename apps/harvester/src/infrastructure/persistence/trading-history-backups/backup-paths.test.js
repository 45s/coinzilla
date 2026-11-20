import assert from "node:assert/strict"
import {
  lstat,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertBackupDirectory,
  assertSourceFile,
  createBackupFilename,
  ensurePrivateDirectory,
  restrictFilePermissions,
  resolveBackupDirectory,
} from "./backup-paths.js"

const BACKUP_ID = "00000000-0000-4000-8000-000000000001"

test("resolves separate environment backup directories independently of NODE_ENV", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-backup-paths-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const env = {
    HARVESTER_DATABASE_DIRECTORY: directory,
    NODE_ENV: "production",
  }
  assert.equal(
    resolveBackupDirectory({
      tradingMode: "testnet",
      env,
    }),
    path.join(directory, "backups", "testnet"),
  )
  assert.equal(
    resolveBackupDirectory({
      tradingMode: "live",
      env,
    }),
    path.join(directory, "backups", "production"),
  )
})

test("builds a UTC timestamped environment-specific filename and rejects invalid IDs", () => {
  const filename = createBackupFilename({
    backupDirectory: "/data/backups/testnet",
    environment: "testnet",
    createdAt: new Date("2026-11-20T04:15:30.000Z"),
    backupId: BACKUP_ID,
  })
  assert.equal(
    path.basename(filename),
    "harvester-testnet-20261120T041530000Z-00000000-0000-4000-8000-000000000001.sqlite",
  )
  assert.throws(
    () => createBackupFilename({
      backupDirectory: "/data/backups/testnet",
      environment: "unknown",
      createdAt: new Date("2026-11-20T04:15:30.000Z"),
      backupId: BACKUP_ID,
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_INVALID_ENVIRONMENT",
  )
  assert.throws(
    () => createBackupFilename({
      backupDirectory: "/data/backups/testnet",
      environment: "testnet",
      createdAt: new Date("2026-11-20T04:15:30.000Z"),
      backupId: "../overwrite",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_INVALID_INPUT",
  )
})

test("restricts backup directories and files on POSIX systems", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows uses inherited NTFS ACLs rather than POSIX mode bits.")
    return
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-backup-permissions-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const backupDirectory = path.join(directory, "backups")
  await ensurePrivateDirectory({
    directory: backupDirectory,
    environment: "testnet",
  })
  const filename = path.join(backupDirectory, "backup.sqlite")
  await writeFile(filename, "backup")
  await restrictFilePermissions({
    filename,
  })
  assert.equal((await lstat(backupDirectory)).mode & 0o777, 0o700)
  assert.equal((await lstat(filename)).mode & 0o777, 0o600)
})

test("rejects missing and symbolic-link source files and symbolic-link backup directories", async (t) => {
  if (process.platform === "win32") {
    t.skip("The CI contract for symlink safety is exercised on POSIX.")
    return
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-backup-symlinks-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const source = path.join(directory, "source.sqlite")
  await writeFile(source, "source")
  const sourceLink = path.join(directory, "source-link.sqlite")
  await symlink(source, sourceLink)
  const directoryLink = path.join(directory, "backup-link")
  const fileAsDirectory = path.join(directory, "not-a-directory")
  await writeFile(fileAsDirectory, "not a directory")
  await symlink(directory, directoryLink)
  await assert.rejects(
    assertSourceFile({
      filename: path.join(directory, "missing.sqlite"),
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_SOURCE_UNAVAILABLE",
  )
  await assert.rejects(
    assertSourceFile({
      filename: sourceLink,
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_SOURCE_INVALID",
  )
  await assert.rejects(
    ensurePrivateDirectory({
      directory: fileAsDirectory,
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
  )
  await assert.rejects(
    assertBackupDirectory({
      directory: directoryLink,
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
  )
})
