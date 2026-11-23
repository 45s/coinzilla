import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
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
const LIVE_SESSION_ID = "a1e2c3d4-e5f6-4789-8123-123456789abc"

function createJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

function createLogFixtureFiles() {
  const structuredRecords = createJsonLines(Array.from({ length: 20 }, (...parameters) => {
    const [, index] = parameters
    return {
      context: {
        runtimeSessionId: index % 2 === 0 ? RUNTIME_SESSION_ID : LIVE_SESSION_ID,
      },
      data: {
        message: index % 2 === 0 ? "TESTNET_STRUCTURED_EVIDENCE" : "LIVE_STRUCTURED_SECRET",
      },
    }
  }))
  return {
    "logs/sessions/2026-11-20_old/terminal.log": "older session must be excluded",
    "logs/sessions/2026-11-22_testnet/terminal.log": "latest TESTNET session evidence",
    "logs/sessions/2026-11-22_testnet/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "testnet",
      runtimeSessionId: RUNTIME_SESSION_ID,
    }),
    "logs/sessions/2026-11-22_testnet/process-completed.json": JSON.stringify({
      runtimeSessionId: RUNTIME_SESSION_ID,
      logStreamsComplete: true,
    }),
    "logs/sessions/2026-11-23_live/terminal.log": "LIVE session must never be archived",
    "logs/sessions/2026-11-23_live/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "live",
      runtimeSessionId: LIVE_SESSION_ID,
    }),
    "logs/sessions/2026-11-23_live/process-completed.json": JSON.stringify({
      runtimeSessionId: LIVE_SESSION_ID,
      logStreamsComplete: true,
    }),
    "logs/cumulative/terminal.log": "shared terminal output without environment markers",
    "logs/cumulative/harvester.log": structuredRecords,
  }
}

function createDataFixtureFiles() {
  const facts = [
    {
      sequence: "0",
      digest: "0".repeat(64),
      runtimeSessionId: RUNTIME_SESSION_ID,
    },
    {
      sequence: "1",
      digest: DATA_COMMIT_HASH,
      runtimeSessionId: RUNTIME_SESSION_ID,
    },
  ]
  const manifests = facts.map((...parameters) => {
    const [fact, index] = parameters
    return {
      sequence: fact.sequence,
      recordCount: String(index + 1),
      lastCommittedDigest: fact.digest,
    }
  })
  return {
    "data/testnet/harvester.db": "sqlite main file",
    "data/testnet/harvester.db-wal": "sqlite wal evidence",
    "data/testnet/harvester.db-shm": "sqlite shm evidence",
    "data/production/harvester.db": "LIVE PRODUCTION SENTINEL MUST NEVER BE ARCHIVED",
    "data/operational-state/facts.jsonl": "operational facts",
    "recovery-facts/facts.jsonl": createJsonLines(facts),
    "recovery-facts/manifest.jsonl": createJsonLines(manifests),
  }
}

function createFixtureFiles() {
  return {
    ...createLogFixtureFiles(),
    ...createDataFixtureFiles(),
  }
}

async function createArchiveFixture() {
  const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-archive-test-"))
  const lockDirectory = path.join(packageDirectory, "process-locks")
  await mkdir(lockDirectory)
  const files = createFixtureFiles()
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(packageDirectory, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content, "utf8")
  }
  return {
    packageDirectory,
    lockDirectory,
    files,
  }
}

function createArchiveDependencies({
  packageDirectory,
  lockDirectory = path.join(packageDirectory, "process-locks"),
  envOverrides = {},
  publishArchiveFn,
  onProgress,
} = {}) {
  return {
    packageDirectory,
    lockDirectory,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_ARCHIVE_REMOTE: ARCHIVE_REMOTE,
      OPERATIONAL_STATE_DIRECTORY: path.join(packageDirectory, "recovery-facts"),
      ...envOverrides,
    },
    args: [],
    now: () => new Date(CREATED_AT),
    createArchiveId: () => ARCHIVE_ID,
    publishArchiveFn,
    onProgress,
  }
}

async function assertArchiveManifest(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.snapshotType, "selected-log-evidence")
  assert.deepEqual(manifest.includedDirectories, ["logs", "data", "recovery-facts"])
  assert.deepEqual(manifest.excludedPaths, ["data/production", "logs/cumulative/terminal.log"])
  assert.equal(manifest.logRuntimeSessionId, RUNTIME_SESSION_ID)
  assert.equal(manifest.dataCommitHash, DATA_COMMIT_HASH)
  assert.equal(manifest.recoveryRuntimeSessionId, RUNTIME_SESSION_ID)
  assert.deepEqual(manifest.logSelection, {
    cumulative: "final-5-percent-of-selected-TESTNET-session-structured-records",
    sessions: "newest-completed-TESTNET-session-only; gzip-compressed",
  })
  assert.equal(
    await readFile(path.join(directory, "data_commit_hash"), "utf8"),
    `${DATA_COMMIT_HASH}\n`,
  )
  return manifest
}

async function assertArchiveContainsTestnetLogs(directory) {
  const selectedLog = await readFile(
    path.join(directory, "logs/sessions/2026-11-22_testnet/terminal.log.gz"),
  )
  assert.equal(gunzipSync(selectedLog).toString("utf8"), "latest TESTNET session evidence")
  await assert.rejects(
    readdir(path.join(directory, "logs/sessions/2026-11-20_old")),
    { code: "ENOENT" },
  )
  await assert.rejects(
    readdir(path.join(directory, "logs/sessions/2026-11-23_live")),
    { code: "ENOENT" },
  )
  await assert.rejects(
    readFile(path.join(directory, "logs/cumulative/terminal.log")),
    { code: "ENOENT" },
  )
  const cumulativeLog = await readFile(path.join(directory, "logs/cumulative/harvester.log"), "utf8")
  assert.match(cumulativeLog, /TESTNET_STRUCTURED_EVIDENCE/)
  assert.doesNotMatch(cumulativeLog, /LIVE_STRUCTURED_SECRET/)
}

async function assertArchiveContainsNoProductionData(directory) {
  await assert.rejects(
    readFile(path.join(directory, "data/production/harvester.db")),
    { code: "ENOENT" },
  )
  assert.equal(
    await readFile(path.join(directory, "data/testnet/harvester.db"), "utf8"),
    "sqlite main file",
  )
  assert.equal(
    await readFile(path.join(directory, "data/operational-state/facts.jsonl"), "utf8"),
    "operational facts",
  )
}

async function assertSourcesRemainUnchanged(fixture) {
  for (const [relativePath, expected] of Object.entries(fixture.files)) {
    assert.equal(
      await readFile(path.join(fixture.packageDirectory, relativePath), "utf8"),
      expected,
      `Archive publication must not modify source evidence: ${relativePath}`,
    )
  }
}

test("names each local snapshot from its UTC archive time and unique ID", () => {
  assert.equal(
    createHarvesterArchiveDirectoryName({
      createdAt: CREATED_AT,
      archiveId: ARCHIVE_ID,
    }),
    "2026-11-22T18-30-00Z_123e4567",
  )
})

test("archives only completed TESTNET evidence and excludes LIVE data", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const progressMessages = []
  let publishedDirectory
  let expectedFileCount = 0
  const result = await runHarvesterArchivePush(createArchiveDependencies({
    packageDirectory: fixture.packageDirectory,
    onProgress: (message) => progressMessages.push(message),
    publishArchiveFn: async ({ directory, remote }) => {
      publishedDirectory = directory
      assert.equal(remote, ARCHIVE_REMOTE)
      const manifest = await assertArchiveManifest(directory)
      await assertArchiveContainsTestnetLogs(directory)
      await assertArchiveContainsNoProductionData(directory)
      expectedFileCount = manifest.files.length + 1
      return {
        commit: REMOTE_COMMIT,
        fileCount: expectedFileCount,
      }
    },
  }))

  await assertSourcesRemainUnchanged(fixture)
  assert.ok(progressMessages.some((message) => message.startsWith("Archive: selecting the newest completed TESTNET session")))
  assert.ok(progressMessages.some((message) => message.startsWith("Hashing ")))
  assert.ok(progressMessages.includes("Local archive verified."))
  assert.equal(result.remoteCommit, REMOTE_COMMIT)
  assert.equal(result.localArchive, publishedDirectory)
  assert.equal(result.fileCount, expectedFileCount)
})


test("refuses to combine a TESTNET log session with different recovery-facts", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const factsFilename = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsFilename, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = LIVE_SESSION_ID
  await writeFile(factsFilename, createJsonLines(facts), "utf8")

  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
      publishArchiveFn: async () => {
        throw new Error("publication must not be reached for mixed-session evidence")
      },
    })),
    /runtime identities do not match/i,
  )
})

test("refuses to archive while a Harvester process lock exists", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await writeFile(path.join(fixture.lockDirectory, ".harvester-trading-test.lock"), "active")

  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
    })),
    /process lock exists/i,
  )
  await assert.rejects(
    readdir(path.join(fixture.packageDirectory, "archive-output")),
    { code: "ENOENT" },
  )
})

test("rejects LIVE mode before reading or copying local evidence", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))

  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
      envOverrides: { TRADING_MODE: "live" },
    })),
    /TRADING_MODE=testnet/,
  )
  await assert.rejects(
    readdir(path.join(fixture.packageDirectory, "archive-output")),
    { code: "ENOENT" },
  )
})



test("archives the configured external database directory", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const externalDatabaseDirectory = path.join(fixture.packageDirectory, "external-database")
  await rename(path.join(fixture.packageDirectory, "data"), externalDatabaseDirectory)

  await runHarvesterArchivePush(createArchiveDependencies({
    packageDirectory: fixture.packageDirectory,
    envOverrides: {
      HARVESTER_DATABASE_DIRECTORY: externalDatabaseDirectory,
    },
    publishArchiveFn: async ({ directory }) => {
      await assertArchiveContainsNoProductionData(directory)
      return {
        commit: REMOTE_COMMIT,
        fileCount: (JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))).files.length + 1,
      }
    },
  }))
  assert.equal(
    await readFile(path.join(externalDatabaseDirectory, "testnet/harvester.db"), "utf8"),
    "sqlite main file",
  )
})

test("rejects database archive paths that overlap logs or archive output", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))

  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
      envOverrides: {
        HARVESTER_DATABASE_DIRECTORY: fixture.packageDirectory,
      },
    })),
    /must not overlap/i,
  )
  await assert.rejects(
    readdir(path.join(fixture.packageDirectory, "archive-output")),
    { code: "ENOENT" },
  )
})

test("retains the verified local snapshot when remote publication fails", async (t) => {
  const fixture = await createArchiveFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))

  await assert.rejects(
    runHarvesterArchivePush(createArchiveDependencies({
      packageDirectory: fixture.packageDirectory,
      publishArchiveFn: async () => {
        throw new Error("remote publication unavailable")
      },
    })),
    /source folders were left unchanged/,
  )
  const archiveName = createHarvesterArchiveDirectoryName({
    createdAt: CREATED_AT,
    archiveId: ARCHIVE_ID,
  })
  const localArchive = path.join(fixture.packageDirectory, "archive-output", archiveName)
  assert.ok((await readdir(localArchive)).includes("manifest.json"))
  await assertSourcesRemainUnchanged(fixture)
})
