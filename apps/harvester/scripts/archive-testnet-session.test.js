import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
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
  const files = {
    "logs/sessions/legacy/terminal.log": "legacy run without process markers",
    "logs/cumulative/terminal.log": "cumulative terminal evidence",
    "data/testnet/harvester.db": "sqlite main file",
    "data/testnet/harvester.db-wal": "sqlite wal evidence",
    "data/testnet/harvester.db-shm": "sqlite shm evidence",
    "data/operational-state/facts.jsonl": "operational facts",
    "recovery-facts/facts.jsonl": Array.from({ length: 49 }, (_, sequence) => JSON.stringify({
      sequence: String(sequence),
      digest: sequence === 48 ? DATA_COMMIT_HASH : String(sequence).padStart(64, "0"),
      runtimeSessionId: RUNTIME_SESSION_ID,
    })).join("\\n") + "\\n",
    "recovery-facts/manifest.jsonl": Array.from({ length: 49 }, (_, sequence) => JSON.stringify({
      sequence: String(sequence),
      recordCount: String(sequence + 1),
      lastCommittedDigest: sequence === 48 ? DATA_COMMIT_HASH : String(sequence).padStart(64, "0"),
    })).join("\\n") + "\\n",
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(packageDirectory, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content, "utf8")
  }
  return { packageDirectory, files }
}

function createArchiveDependencies({ packageDirectory, publishArchiveFn }) {
  return {
    packageDirectory,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_ARCHIVE_REMOTE: ARCHIVE_REMOTE,
    },
    args: [],
    now: () => new Date(CREATED_AT),
    createArchiveId: () => ARCHIVE_ID,
    publishArchiveFn,
  }
}

test("names each local snapshot from its UTC archive time and unique ID", () => {
  assert.equal(
    createHarvesterArchiveDirectoryName({ createdAt: CREATED_AT, archiveId: ARCHIVE_ID }),
    "2026-11-22T18-30-00Z_123e4567",
    "the archive name must be deterministic from its UTC timestamp and unique archive ID",
  )
})

test("archives complete logs and data trees without requiring process markers", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, { recursive: true, force: true }))
  let publishedDirectory
  const result = await runHarvesterArchivePush(createArchiveDependencies({
    packageDirectory: fixture.packageDirectory,
    publishArchiveFn: async ({ directory, remote }) => {
      publishedDirectory = directory
      assert.equal(remote, ARCHIVE_REMOTE, "the archive must be sent only to the configured private repository")
      const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
      assert.equal(manifest.snapshotType, "raw-directory-copy", "the manifest must identify this as a raw evidence snapshot")
      assert.deepEqual(manifest.includedDirectories, ["logs", "data", "recovery-facts"], "the manifest must declare all copied source trees")
      assert.equal(manifest.dataCommitHash, DATA_COMMIT_HASH, "the archive manifest must identify the last committed recovery-facts digest")
      assert.equal(manifest.recoveryRuntimeSessionId, RUNTIME_SESSION_ID, "the archive manifest must identify the session owning the last committed fact")
      assert.equal(await readFile(path.join(directory, "data_commit_hash"), "utf8"), DATA_COMMIT_HASH + "\\n", "the archive must contain the standalone data_commit_hash file")
      for (const [relativePath, content] of Object.entries(fixture.files)) {
        assert.equal(
          await readFile(path.join(directory, relativePath), "utf8"),
          content,
          "every nested source file, including legacy logs, recovery facts and SQLite sidecars, must be copied unchanged",
        )
      }
      return { commit: REMOTE_COMMIT, fileCount: manifest.files.length + 1 }
    },
  }))
  assert.equal(result.remoteCommit, REMOTE_COMMIT, "the command must return the verified remote commit")
  assert.equal(result.localArchive, publishedDirectory, "the verified local snapshot must be the published artifact")
  assert.equal(result.fileCount, Object.keys(fixture.files).length + 2, "the published inventory must include all source files, data_commit_hash and the manifest")
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
    DATA_COMMIT_HASH + "\\n",
    "the complete local snapshot must retain the last committed data hash",
  )
  assert.equal(
    await readFile(path.join(attemptedDirectory, "logs/sessions/legacy/terminal.log"), "utf8"),
    fixture.files["logs/sessions/legacy/terminal.log"],
    "the complete local snapshot must remain available after a failed push",
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
