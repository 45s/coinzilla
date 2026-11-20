import assert from "node:assert/strict"
import { appendFile, writeFile } from "node:fs/promises"
import test from "node:test"
import {
  createBackupService,
  createFixture,
  readManifest,
} from "./test-support.js"

test("rejects a TESTNET backup when the verifier selects LIVE", async (t) => {
  const fixture = await createFixture({ testContext: t })
  const result = await fixture.service.createBackup()
  const liveService = createBackupService({
    env: {
      ...fixture.env,
      TRADING_MODE: "live",
    },
  })
  await assert.rejects(
    liveService.verifyBackup({
      backupFilename: result.backupFilename,
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
  )
})

test("rejects backup bytes that no longer match the sidecar digest", async (t) => {
  const fixture = await createFixture({ testContext: t })
  const result = await fixture.service.createBackup()
  await appendFile(result.backupFilename, "tampered")
  await assert.rejects(
    fixture.service.verifyBackup({
      backupFilename: result.backupFilename,
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_DIGEST_MISMATCH",
  )
})

test("rejects a manifest whose declared environment has been changed", async (t) => {
  const fixture = await createFixture({ testContext: t })
  const result = await fixture.service.createBackup()
  const manifest = await readManifest(result.manifestFilename)
  manifest.environment = "live"
  await writeFile(result.manifestFilename, JSON.stringify(manifest))
  await assert.rejects(
    fixture.service.verifyBackup({
      backupFilename: result.backupFilename,
    }),
    (error) => error.code === "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
  )
})
