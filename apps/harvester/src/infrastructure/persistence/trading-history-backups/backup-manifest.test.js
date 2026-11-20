import assert from "node:assert/strict"
import {
  appendFile,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  calculateSha256,
  createBackupManifest,
  readAndValidateManifest,
} from "./backup-manifest.js"

const BACKUP_FILENAME = "harvester-testnet-20261120T041530000Z-00000000-0000-4000-8000-000000000001.sqlite"
const CREATED_AT = new Date("2026-11-20T04:15:30.000Z")

async function createManifestFixture({ testContext } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-backup-manifest-"))
  testContext.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const backupFilename = path.join(directory, BACKUP_FILENAME)
  await writeFile(backupFilename, "verified sqlite backup bytes")
  const sha256 = await calculateSha256(backupFilename)
  const manifest = createBackupManifest({
    environment: "testnet",
    createdAt: CREATED_AT,
    backupFilename,
    schemaVersion: 3,
    sha256,
  })
  const manifestFilename = `${backupFilename}.manifest.json`
  await writeFile(manifestFilename, JSON.stringify(manifest))
  return {
    directory,
    backupFilename,
    manifestFilename,
    manifest,
  }
}

test("creates a minimal manifest and validates its backup digest", async (t) => {
  const fixture = await createManifestFixture({
    testContext: t,
  })
  const validated = await readAndValidateManifest({
    backupFilename: fixture.backupFilename,
    backupDirectory: fixture.directory,
    environment: "testnet",
  })
  assert.deepEqual(validated.manifest, fixture.manifest)
  assert.equal(validated.manifest.createdAt, CREATED_AT.toISOString())
  assert.equal(JSON.stringify(validated.manifest).includes(fixture.directory), false)
})

test("rejects backup bytes that no longer match the manifest digest", async (t) => {
  const fixture = await createManifestFixture({
    testContext: t,
  })
  await appendFile(fixture.backupFilename, "tampered")
  await assert.rejects(
    readAndValidateManifest({
      backupFilename: fixture.backupFilename,
      backupDirectory: fixture.directory,
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_DIGEST_MISMATCH",
  )
})

test("rejects a manifest from a different environment", async (t) => {
  const fixture = await createManifestFixture({
    testContext: t,
  })
  await assert.rejects(
    readAndValidateManifest({
      backupFilename: fixture.backupFilename,
      backupDirectory: fixture.directory,
      environment: "live",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
  )
})

test("rejects malformed manifest metadata", async (t) => {
  const fixture = await createManifestFixture({
    testContext: t,
  })
  await writeFile(fixture.manifestFilename, JSON.stringify({
    formatVersion: 1,
    environment: "testnet",
  }))
  await assert.rejects(
    readAndValidateManifest({
      backupFilename: fixture.backupFilename,
      backupDirectory: fixture.directory,
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
  )
})
