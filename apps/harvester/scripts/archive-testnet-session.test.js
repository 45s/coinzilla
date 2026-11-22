import assert from "node:assert/strict"
import test from "node:test"
import { createHarvesterArchiveDirectoryName } from "./archive-testnet-session.js"

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
