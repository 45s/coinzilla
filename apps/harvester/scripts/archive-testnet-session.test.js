import assert from "node:assert/strict"
import test from "node:test"
import { createHarvesterArchiveDirectoryName, runHarvesterArchivePush } from "./archive-testnet-session.js"

const identity = {
  formatVersion: 1,
  application: "harvester",
  environment: "testnet",
  startedAt: "2026-11-22T14:43:00.123Z",
  runtimeSessionId: "123e4567-e89b-42d3-a456-426614174000",
  source: {
    branch: "feat/harvester-local-dev-reset-archive",
    commit: "a1b2c3d4".padEnd(40, "e"),
    shortCommit: "a1b2c3d4",
    commitMessage: "feat(harvester): capture process provenance",
    commitDate: "2026-11-22T14:40:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
  },
}

test("names the archive from the immutable process-start timestamp and source commit", () => {
  assert.equal(
    createHarvesterArchiveDirectoryName(identity),
    "2026-11-22T14-43-00Z_a1b2c3d4",
    "the folder name must use process-start UTC time and the captured short source SHA",
  )
})

test("does not accept a missing startup commit and cannot fall back to current HEAD", () => {
  assert.throws(
    () => createHarvesterArchiveDirectoryName({
      ...identity,
      source: { ...identity.source, commit: null, shortCommit: null },
    }),
    /process-start identity and full source commit/,
    "an unavailable process-start commit must fail closed instead of using the archive command checkout",
  )
})

test("rejects a non-TESTNET process identity", () => {
  assert.throws(
    () => createHarvesterArchiveDirectoryName({
      ...identity,
      environment: "live",
    }),
    /process-start identity and full source commit/,
    "LIVE process identity must never produce a TESTNET archive name",
  )
})

test("rejects LIVE and unspecified modes before inspecting sessions or creating backups", async () => {
  await assert.rejects(
    runHarvesterArchivePush({
      args: [],
      env: {
        TRADING_MODE: "live",
        HARVESTER_ARCHIVE_REMOTE: "https://github.com/45s/coinzilla-archive.git",
      },
      backupServiceFactory: () => {
        throw new Error("The backup service must not be constructed for LIVE mode.")
      },
    }),
    /requires TRADING_MODE=testnet/,
    "the archive command must reject LIVE before touching session or database state",
  )
  await assert.rejects(
    runHarvesterArchivePush({
      args: [],
      env: {
        HARVESTER_ARCHIVE_REMOTE: "https://github.com/45s/coinzilla-archive.git",
      },
    }),
    /requires TRADING_MODE=testnet/,
    "an unspecified trading mode must fail closed before any filesystem or database work",
  )
})

test("refuses to publish to any repository other than the configured private archive repository", async () => {
  await assert.rejects(
    runHarvesterArchivePush({
      args: [],
      env: {
        TRADING_MODE: "testnet",
        HARVESTER_ARCHIVE_REMOTE: "https://github.com/45s/coinzilla.git",
      },
    }),
    /must target the private/,
    "operational data must never be published to the source repository or an arbitrary GitHub remote",
  )
})
