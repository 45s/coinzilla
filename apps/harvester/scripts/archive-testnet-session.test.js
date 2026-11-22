import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { gunzipSync } from "node:zlib"
import {
  createHarvesterArchiveDirectoryName,
  runHarvesterArchivePush,
} from "./archive-testnet-session.js"

const ARCHIVE_REMOTE = "https://github.com/45s/coinzilla-archive.git"
const CREATED_AT = "2026-11-22T18:30:00.123Z"
const ARCHIVE_ID = "123e4567-e89b-42d3-a456-426614174000"
const REMOTE_COMMIT = "a".repeat(40)
const DATA_COMMIT_HASH = "154720ef4b575e5a189fc6aa78fd9575917537d02e808403593ab4c09c8dd4b8"
const RUNTIME_SESSION_ID = "ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c"

async function createArchiveFixture() {
  const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-archive-test-"))
  const lockDirectory = path.join(packageDirectory, "process-locks")
  await mkdir(lockDirectory)
  const files = {
    "logs/sessions/2026-11-20_old/terminal.log": "older session must be excluded",
    "logs/sessions/2026-11-22_latest/terminal.log": "latest TESTNET session evidence",
    "logs/sessions/2026-11-22_latest/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "testnet",
      runtimeSessionId: RUNTIME_SESSION_ID,
    }),
    "logs/sessions/2026-11-22_latest/process-completed.json": JSON.stringify({
      runtimeSessionId: RUNTIME_SESSION_ID,
      logStreamsComplete: true,
    }),
    "logs/sessions/2026-11-23_live/terminal.log": "LIVE session must never be archived",
    "logs/sessions/2026-11-23_live/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "live",
      runtimeSessionId: "a1e2c3d4-e5f6-4789-8123-123456789abc",
    }),
    "logs/sessions/2026-11-23_live/process-completed.json": JSON.stringify({
      runtimeSessionId: "a1e2c3d4-e5f6-4789-8123-123456789abc",
      logStreamsComplete: true,
    }),
    "logs/cumulative/terminal.log": "x".repeat(100),
    "logs/cumulative/harvester.log": Array.from({ length: 20 }, (_, index) => JSON.stringify({
      context: { runtimeSessionId: index % 2 === 0 ? RUNTIME_SESSION_ID : "a1e2c3d4-e5f6-4789-8123-123456789abc" },
      data: { message: index % 2 === 0 ? "TESTNET_STRUCTURED_EVIDENCE" : "LIVE_STRUCTURED_SECRET" },
    })).join("\n") + "\n",
    "data/testnet/harvester.db": "sqlite main file",
    "data/testnet/harvester.db-wal": "sqlite wal evidence",
    "data/testnet/harvester.db-shm": "sqlite shm evidence",
    "data/production/harvester.db": "LIVE PRODUCTION SENTINEL MUST NEVER BE ARCHIVED",
    "data/operational-state/facts.jsonl": "operational facts",
    "recovery-facts/facts.jsonl": Array.from({ length: 49 }, (_, sequence) => JSON.stringify({
      sequence: String(sequence),
      digest: sequence === 48 ? DATA_COMMIT_HASH : String(sequence).padStart(64, "0"),
      runtimeSessionId: RUNTIME_SESSION_ID,
    })).join("\n") + "\n",
    "recovery-facts/manifest.jsonl": Array.from({ length: 49 }, (_, sequence) => JSON.stringify({
      sequence: String(sequence),
      recordCount: String(sequence + 1),
      lastCommittedDigest: sequence === 48 ? DATA_COMMIT_HASH : String(sequence).padStart(64, "0"),
    })).join("\n") + "\n",
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(packageDirectory, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content, "utf8")
  }
  return { packageDirectory, lockDirectory, files }
}

function createArchiveDependencies({ packageDirectory, publishArchiveFn, onProgress }) {
  return {
    packageDirectory,
    lockDirectory: path.join(packageDirectory, "process-locks"),
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_ARCHIVE_REMOTE: ARCHIVE_REMOTE,
      OPERATIONAL_STATE_DIRECTORY: path.join(packageDirectory, "recovery-facts"),
    },
    args: [],
    now: () => new Date(CREATED_AT),
    createArchiveId: () => ARCHIVE_ID,
    publishArchiveFn,
    onProgress,
  }
}

test("names each local snapshot from its UTC archive time and unique ID", () => {
  assert.equal(
    createHarvesterArchiveDirectoryName({ createdAt: CREATED_AT, archiveId: ARCHIVE_ID }),
    "2026-11-22T18-30-00Z_123e4567",
    "the archive name must be deterministic from its UTC timestamp and unique archive ID",
  )
})

test("archives only completed TESTNET session evidence and excludes LIVE data", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, { recursive: true, force: true }))
  let publishedDirectory
  let expectedFileCount
  const progressMessages = []
  const result = await runHarvesterArchivePush(createArchiveDependencies({
    packageDirectory: fixture.packageDirectory,
    onProgress: (message) => progressMessages.push(message),
    publishArchiveFn: async ({ directory, remote }) => {
      publishedDirectory = directory
      assert.equal(remote, ARCHIVE_REMOTE, "the archive must be sent only to the configured private repository")
      const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
      assert.equal(manifest.snapshotType, "selected-log-evidence", "the manifest must identify this as a selected-log evidence snapshot")
      assert.deepEqual(manifest.includedDirectories, ["logs", "data", "recovery-facts"], "the manifest must declare all included source trees")
      assert.deepEqual(manifest.excludedPaths, ["data/production", "logs/cumulative/terminal.log"], "The manifest must list every production/unclassified source exclusion.")
      assert.deepEqual(manifest.logSelection, { cumulative: "final-5-percent-of-selected-TESTNET-session-structured-records", sessions: "newest-completed-TESTNET-session-only; gzip-compressed" }, "the manifest must describe the reduced log selection")
      assert.equal(manifest.logRuntimeSessionId, RUNTIME_SESSION_ID, "The archive manifest must identify the completed TESTNET log session.")
      assert.equal(manifest.dataCommitHash, DATA_COMMIT_HASH, "the archive manifest must identify the last committed recovery-facts digest")
      assert.equal(manifest.recoveryRuntimeSessionId, RUNTIME_SESSION_ID, "the archive manifest must identify the session owning the last committed fact")
      assert.equal(await readFile(path.join(directory, "data_commit_hash"), "utf8"), DATA_COMMIT_HASH + "\n", "the archive must contain the standalone data_commit_hash file")
      await assert.rejects(
        readFile(path.join(directory, "logs/cumulative/terminal.log")),
        { code: "ENOENT" },
        "The shared terminal cumulative log must be omitted because it has no reliable environment marker.",
      )
      assert.equal(
        gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-22_latest/terminal.log.gz"))).toString("utf8"),
        "latest TESTNET session evidence",
        "the newest completed TESTNET session must be retained in full",
      )
      await assert.rejects(
        readFile(path.join(directory, "logs/sessions/2026-11-20_old/terminal.log")),
        { code: "ENOENT" },
        "older session directories must be excluded",
      )
      await assert.rejects(
        readFile(path.join(directory, "logs/sessions/2026-11-23_live/terminal.log.gz")),
        { code: "ENOENT" },
        "A newer LIVE session must not displace or enter the TESTNET archive.",
      )
      const structuredLog = await readFile(path.join(directory, "logs/cumulative/harvester.log"), "utf8")
      assert.match(structuredLog, /TESTNET_STRUCTURED_EVIDENCE/, "Cumulative structured logs must retain records for the selected TESTNET session.")
      assert.doesNotMatch(structuredLog, /LIVE_STRUCTURED_SECRET/, "Cumulative structured logs must filter out records from LIVE sessions.")
      await assert.rejects(
        readFile(path.join(directory, "data/production/harvester.db")),
        { code: "ENOENT" },
        "LIVE production database bytes must never enter a TESTNET archive",
      )
      for (const [relativePath, expected] of Object.entries(fixture.files)) {
        if (relativePath.startsWith("logs/") || relativePath.startsWith("data/production/")) continue
        assert.equal(
          await readFile(path.join(directory, relativePath), "utf8"),
          expected,
          "data and recovery facts must be copied unchanged",
        )
      }
      expectedFileCount = manifest.files.length + 1
      return { commit: REMOTE_COMMIT, fileCount: expectedFileCount }
    },
  }))
  assert.equal(
    await readFile(path.join(fixture.packageDirectory, "logs/cumulative/terminal.log"), "utf8"),
    "x".repeat(100),
    "source cumulative logs must remain untouched",
  )
  assert.equal(
    await readFile(path.join(fixture.packageDirectory, "logs/sessions/2026-11-20_old/terminal.log"), "utf8"),
    "older session must be excluded",
    "source older sessions must remain untouched",
  )
  assert.ok(progressMessages.some((message) => message.startsWith("Archive: selecting log evidence ")), "the operator must see the source-copy size and file count")
  assert.ok(progressMessages.some((message) => message.startsWith("Hashing ")), "the operator must see checksum-generation progress")
  assert.ok(progressMessages.includes("Local archive verified."), "the operator must see local verification completion")
  assert.equal(result.remoteCommit, REMOTE_COMMIT, "the command must return the verified remote commit")
  assert.equal(result.localArchive, publishedDirectory, "the verified local snapshot must be the published artifact")
  assert.equal(result.fileCount, expectedFileCount, "The published inventory must match the verified TESTNET-only archive manifest.")
})


test("refuses to archive while a Harvester process lock exists", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, { recursive: true, force: true }))
  await writeFile(path.join(fixture.lockDirectory, ".harvester-trading-test.lock"), "active")

  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
      publishArchiveFn: async () => {
        throw new Error("publication must not be reached while Harvester is active")
      },
    })),
    /process lock exists/i,
    "The archive must refuse a raw database/evidence copy while a Harvester process owns its locks.",
  )
})

test("keeps the completed local snapshot when remote publication fails", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, { recursive: true, force: true }))
  let attemptedDirectory
  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
      publishArchiveFn: async ({ directory }) => {
        attemptedDirectory = directory
        throw new Error("simulated remote push failure")
      },
    })),
    /simulated remote push failure/,
    "a remote failure must be reported to the operator",
  )
  assert.equal(
    await readFile(path.join(attemptedDirectory, "data_commit_hash"), "utf8"),
    DATA_COMMIT_HASH + "\n",
    "the complete local snapshot must retain the last committed data hash",
  )
  assert.equal(
    gunzipSync(await readFile(path.join(attemptedDirectory, "logs/sessions/2026-11-22_latest/terminal.log.gz"))).toString("utf8"),
    fixture.files["logs/sessions/2026-11-22_latest/terminal.log"],
    "the selected latest session must remain available after a failed push",
  )
})

test("rejects LIVE and unspecified trading modes before reading local folders", async () => {
  await assert.rejects(
    runHarvesterArchivePush({
      args: [],
      env: {
        TRADING_MODE: "live",
        HARVESTER_ARCHIVE_REMOTE: ARCHIVE_REMOTE,
      },
      packageDirectory: path.join(os.tmpdir(), "missing-harvester-folder"),
    }),
    /requires TRADING_MODE=testnet/,
    "LIVE mode must be rejected before local data is inspected",
  )
  await assert.rejects(
    runHarvesterArchivePush({
      args: [],
      env: { HARVESTER_ARCHIVE_REMOTE: ARCHIVE_REMOTE },
      packageDirectory: path.join(os.tmpdir(), "missing-harvester-folder"),
    }),
    /requires TRADING_MODE=testnet/,
    "an unspecified trading mode must be rejected before local data is inspected",
  )
})

test("refuses to publish to any repository other than the private archive repository", async () => {
  await assert.rejects(
    runHarvesterArchivePush({
      args: [],
      env: {
        TRADING_MODE: "testnet",
        HARVESTER_ARCHIVE_REMOTE: "https://github.com/45s/coinzilla.git",
      },
      packageDirectory: path.join(os.tmpdir(), "missing-harvester-folder"),
    }),
    /must target the private/,
    "operational data must never be published to the public source repository",
  )
})
