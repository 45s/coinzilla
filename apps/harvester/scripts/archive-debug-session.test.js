import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { gunzipSync } from "node:zlib"
import {
  createHarvesterArchiveDirectoryName,
  runHarvesterDebugArchive,
} from "./archive-debug-session.js"

const ARCHIVE_REMOTE = "https://github.com/45s/coinzilla-archive.git"
const CREATED_AT = "2026-11-24T18:30:00.123Z"
const ARCHIVE_ID = "123e4567-e89b-42d3-a456-426614174000"
const REMOTE_COMMIT = "a".repeat(40)
const DATA_COMMIT_HASH = "154720ef4b575e5a189fc6aa78fd9575917537d02e808403593ab4c09c8dd4b8"
const RUNTIME_SESSION_ID = "ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c"
const OTHER_SESSION_ID = "a1e2c3d4-e5f6-4789-8123-123456789abc"

function jsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

async function createFixture() {
  const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-debug-archive-test-"))
  const lockDirectory = path.join(packageDirectory, "process-locks")
  await mkdir(lockDirectory)
  const files = {
    "logs/sessions/2026-11-20_old/terminal.log": "old session",
    "logs/sessions/2026-11-24_testnet/terminal.log": "selected TESTNET session evidence",
    "logs/sessions/2026-11-24_testnet/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "testnet",
      runtimeSessionId: RUNTIME_SESSION_ID,
    }),
    "logs/sessions/2026-11-24_testnet/process-completed.json": JSON.stringify({
      runtimeSessionId: RUNTIME_SESSION_ID,
      logStreamsComplete: true,
    }),
    "logs/sessions/2026-11-25_live/terminal.log": "LIVE session must not be included",
    "logs/sessions/2026-11-25_live/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "live",
      runtimeSessionId: OTHER_SESSION_ID,
    }),
    "logs/sessions/2026-11-25_live/process-completed.json": JSON.stringify({
      runtimeSessionId: OTHER_SESSION_ID,
      logStreamsComplete: true,
    }),
    "logs/cumulative/harvester.log": "CUMULATIVE LOG MUST NOT BE INCLUDED",
    "logs/cumulative/terminal.log": "TERMINAL LOG MUST NOT BE INCLUDED",
    "data/testnet/harvester.db": "DATABASE MUST NOT BE INCLUDED",
    "data/production/harvester.db": "PRODUCTION DATABASE MUST NOT BE INCLUDED",
    "recovery-facts/facts.jsonl": jsonLines([
      {
        sequence: "0",
        digest: "0".repeat(64),
        runtimeSessionId: RUNTIME_SESSION_ID
      },
      {
        sequence: "1",
        digest: DATA_COMMIT_HASH,
        runtimeSessionId: RUNTIME_SESSION_ID
      },
    ]),
    "recovery-facts/manifest.jsonl": jsonLines([
      {
        sequence: "0",
        recordCount: "1",
        lastCommittedDigest: "0".repeat(64)
      },
      {
        sequence: "1",
        recordCount: "2",
        lastCommittedDigest: DATA_COMMIT_HASH
      },
    ]),
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(packageDirectory, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content, "utf8")
  }
  return {
    packageDirectory,
    lockDirectory,
    files
  }
}

function archiveDependencies({ fixture, overrides = {} } = {}) {
  return {
    packageDirectory: fixture.packageDirectory,
    lockDirectory: fixture.lockDirectory,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_ARCHIVE_REMOTE: ARCHIVE_REMOTE,
      OPERATIONAL_STATE_DIRECTORY: path.join(fixture.packageDirectory, "recovery-facts"),
      ...overrides,
    },
    args: [],
    now: () => new Date(CREATED_AT),
    createArchiveId: () => ARCHIVE_ID,
    publishArchiveFn: async ({
      directory,
      remote
    }) => {
      assert.equal(remote, ARCHIVE_REMOTE)
      const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
      assert.deepEqual(manifest.includedDirectories, ["logs", "recovery-facts"])
      assert.deepEqual(manifest.excludedPaths, [
        "data/** (all databases and backups)",
        "logs/cumulative/**",
      ])
      assert.equal(manifest.logRuntimeSessionId, RUNTIME_SESSION_ID)
      assert.equal(manifest.recoveryRuntimeSessionId, RUNTIME_SESSION_ID)
      assert.equal(manifest.dataCommitHash, DATA_COMMIT_HASH)
      assert.deepEqual(manifest.logSelection, {
        cumulative: "excluded",
        sessions: "newest-completed-TESTNET-session-only; gzip-compressed",
      })
      assert.equal(
        await readFile(path.join(directory, "data_commit_hash"), "utf8"),
        `${DATA_COMMIT_HASH}\n`,
      )
      assert.equal(
        gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-24_testnet/terminal.log.gz"))).toString("utf8"),
        "selected TESTNET session evidence",
      )
      await assert.rejects(readdir(path.join(directory, "logs/sessions/2026-11-20_old")), { code: "ENOENT" })
      await assert.rejects(readdir(path.join(directory, "logs/sessions/2026-11-25_live")), { code: "ENOENT" })
      await assert.rejects(readdir(path.join(directory, "logs/cumulative")), { code: "ENOENT" })
      await assert.rejects(readdir(path.join(directory, "data")), { code: "ENOENT" })
      return {
        commit: REMOTE_COMMIT,
        fileCount: manifest.files.length + 1
      }
    },
  }
}

test("adds _debug to the existing timestamp and archive-ID directory name", () => {
  assert.equal(
    createHarvesterArchiveDirectoryName({
      createdAt: CREATED_AT,
      archiveId: ARCHIVE_ID
    }),
    "2026-11-24T18-30-00Z_123e4567_debug",
  )
})

test("publishes only the selected TESTNET session and recovery facts", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const result = await runHarvesterDebugArchive(archiveDependencies({ fixture }))
  assert.equal(result.archiveName, "2026-11-24T18-30-00Z_123e4567_debug")
  assert.equal(result.remoteCommit, REMOTE_COMMIT)
  for (const [relativePath, expected] of Object.entries(fixture.files)) {
    assert.equal(
      await readFile(path.join(fixture.packageDirectory, relativePath), "utf8"),
      expected,
      `Source evidence must remain unchanged: ${relativePath}`,
    )
  }
})

test("refuses to combine logs and recovery facts from different runtime sessions", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const filename = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(filename, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = OTHER_SESSION_ID
  await writeFile(filename, jsonLines(facts), "utf8")
  await assert.rejects(
    runHarvesterDebugArchive(archiveDependencies({ fixture })),
    /runtime identities do not match/i,
  )
})

test("refuses to archive while a Harvester process lock exists", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  await writeFile(path.join(fixture.lockDirectory, ".harvester-trading-test.lock"), "active")
  await assert.rejects(runHarvesterDebugArchive(archiveDependencies({ fixture })), /process lock exists/i)
  await assert.rejects(readdir(path.join(fixture.packageDirectory, "archive-output")), { code: "ENOENT" })
})

test("rejects LIVE mode before creating an archive", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  await assert.rejects(
    runHarvesterDebugArchive(archiveDependencies({ fixture, overrides: { TRADING_MODE: "live" } })),
    /TRADING_MODE=testnet/,
  )
  await assert.rejects(readdir(path.join(fixture.packageDirectory, "archive-output")), { code: "ENOENT" })
})
