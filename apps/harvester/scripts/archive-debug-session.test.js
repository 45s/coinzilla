import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import {
  appendFile,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { gzipSync, gunzipSync } from "node:zlib"
import {
  assertSourceFileStable,
  copyFileRange,
  createHarvesterArchiveDirectoryName,
  runHarvesterDebugArchive,
} from "./archive-debug-session.js"

const CREATED_AT = "2026-11-24T18:30:00.123Z"
const ARCHIVE_ID = "123e4567-e89b-42d3-a456-426614174000"
const REMOTE_COMMIT = "a".repeat(40)
const DATA_COMMIT_HASH = "154720ef4b575e5a189fc6aa78fd9575917537d02e808403593ab4c09c8dd4b8"
const RUNTIME_SESSION_ID = "ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c"
const OTHER_SESSION_ID = "a1e2c3d4-e5f6-4789-8123-123456789abc"

function jsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

function createMatchingTestnetFixtureFiles() {
  return {
    "logs/sessions/2026-11-20_old/terminal.log": "old session",
    "logs/sessions/2026-11-24_testnet/terminal.log": "selected runtime session evidence",
    "logs/sessions/2026-11-24_testnet/harvester.log": "matching debug stream",
    "logs/sessions/2026-11-24_testnet/trace.log": "matching trace stream",
    "logs/sessions/2026-11-24_testnet/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "testnet",
      startedAt: "2026-11-24T18:20:00.000Z",
      runtimeSessionId: RUNTIME_SESSION_ID,
      processId: 24680,
      source: {
        branch: "develop",
        commit: "a".repeat(40),
        shortCommit: "a".repeat(8),
        commitMessage: "feat(harvester): test process provenance",
        commitDate: "2026-11-24T18:00:00.000Z",
        workingTree: "clean",
        metadataSource: "git",
      },
    }),
    "logs/sessions/2026-11-24_testnet/process-completed.json": JSON.stringify({
      runtimeSessionId: RUNTIME_SESSION_ID,
      endedAt: "2026-11-24T18:29:00.000Z",
      exitCode: 0,
      signal: null,
      logStreamsComplete: true,
    }),
    "logs/sessions/2026-11-24_testnet/log-streams-completed.json": JSON.stringify({
      runtimeSessionId: RUNTIME_SESSION_ID,
      endedAt: "2026-11-24T18:29:00.000Z",
      logStreamsComplete: true,
      streams: {
        harvesterLog: true,
        traceLog: true,
      },
    }),
  }
}

function createIndependentSessionFixtureFiles() {
  return {
    "logs/sessions/2026-11-25_live/terminal.log": "independent LIVE session evidence",
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
  }
}

function createRecoveryFactsFixtureFiles() {
  return {
    "recovery-facts/facts.jsonl": jsonLines([
      {
        sequence: "0",
        digest: "0".repeat(64),
        factId: `process-started:${RUNTIME_SESSION_ID}`,
        factType: "PROCESS_STARTED",
        runtimeSessionId: RUNTIME_SESSION_ID,
        data: {
          processIdentity: {
            application: "harvester",
            version: "1.0.001",
            runtimeSessionId: RUNTIME_SESSION_ID,
            processId: 24680,
            startedAt: "2026-11-24T18:20:00.000Z",
            source: {
              branch: "develop",
              commit: "a".repeat(40),
              workingTree: "clean",
              metadataSource: "git",
            },
          },
        },
      },
      {
        sequence: "1",
        digest: DATA_COMMIT_HASH,
        runtimeSessionId: RUNTIME_SESSION_ID,
      },
    ]),
    "recovery-facts/manifest.jsonl": jsonLines([
      {
        sequence: "0",
        recordCount: "1",
        lastCommittedDigest: "0".repeat(64),
      },
      {
        sequence: "1",
        recordCount: "2",
        lastCommittedDigest: DATA_COMMIT_HASH,
      },
    ]),
  }
}

function createFixtureFiles() {
  return {
    ...createMatchingTestnetFixtureFiles(),
    ...createIndependentSessionFixtureFiles(),
    ...createRecoveryFactsFixtureFiles(),
  }
}

async function createFixture() {
  const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "harvester-debug-archive-test-"))
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

function assertArchiveRuntimeIdentity({ manifest, expectedIdentityStatus } = {}) {
  assert.equal(manifest.matchingTradingLogsAvailable, expectedIdentityStatus === "matched", "The archive must report whether a unique complete log session matches the recovery-facts runtime.")
  assert.equal(manifest.logRuntimeSessionId, expectedIdentityStatus === "matched" ? RUNTIME_SESSION_ID : null, "Only a unique exact runtime match may be labelled as the selected runtime logs.")
  assert.equal(manifest.tradingRuntime.runtimeSessionId, manifest.recoveryRuntimeSessionId, "The trading-runtime inventory must be bound to the durable recovery-facts session identity.")
  if (expectedIdentityStatus === "matched") {
    assert.equal(manifest.tradingRuntime.processIdentity.processId, 24680, "The durable process-start fact must preserve the original process ID.")
    assert.equal(manifest.tradingRuntime.processIdentity.source.commit, "a".repeat(40), "The durable process-start fact must preserve the source revision.")
    assert.equal(manifest.tradingRuntime.processIdentity.source.workingTree, "clean", "The durable process-start fact must preserve worktree state.")
  } else {
    assert.equal(manifest.tradingRuntime.processIdentity, null, "A process identity from a different runtime must not be borrowed for the selected recovery runtime.")
  }
  assert.equal(manifest.runtimeIdentity.status, expectedIdentityStatus, "Archive manifest must explicitly state whether the log and recovery evidence share a runtime identity")
  assert.equal(manifest.runtimeIdentity.correlation, expectedIdentityStatus === "matched" ? "same-runtime-session" : "independent-evidence-do-not-correlate", "Mismatched evidence must never be represented as one correlated runtime session")
  assert.equal(manifest.recoveryRuntimeSessionId, expectedIdentityStatus === "matched" ? RUNTIME_SESSION_ID : OTHER_SESSION_ID)
}

async function assertCollectedArchive({ directory, expectedIdentityStatus, expectedTradingMode = "testnet" } = {}) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.runtimeTradingMode, expectedTradingMode, "Runtime trading mode must be inferred from the exact matched session identity.")
  assert.deepEqual(manifest.includedDirectories, ["logs", "recovery-facts"], "Debug archives must contain only logs and recovery facts")
  assert.deepEqual(manifest.excludedPaths, [
    "data/** (all databases and backups)",
    "logs/cumulative/**",
  ], "Debug archives must declare databases and cumulative logs excluded")
  assertArchiveRuntimeIdentity({
    manifest,
    expectedIdentityStatus,
  })
  assert.equal(manifest.dataCommitHash, DATA_COMMIT_HASH, "Archive manifest must preserve the latest committed recovery checkpoint digest")
  assert.deepEqual(manifest.logSelection, {
    cumulative: "excluded",
    sessions: "all-identified-Harvester-sessions-preserved-independently; exact-runtime-id-match-required; completed sessions or active-process snapshots; gzip-compressed",
    selectionReason: expectedIdentityStatus === "matched" ? "exact-runtime-id-match" : expectedIdentityStatus,
  }, "Debug archive manifest must preserve testnet and live sessions independently and require an exact runtime identity match.")
  assert.equal(
    await readFile(path.join(directory, "data_commit_hash"), "utf8"),
    `${DATA_COMMIT_HASH}\n`,
    "Published checkpoint identity file must match the recovery-facts manifest",
  )
  const selectedSessionName = expectedTradingMode === "live" ? "2026-11-24_live" : "2026-11-24_testnet"
  assert.equal(
    gunzipSync(await readFile(path.join(directory, `logs/sessions/${selectedSessionName}/terminal.log.gz`))).toString("utf8"),
    "selected runtime session evidence",
    "The selected runtime log must be preserved in gzip form",
  )
  await assert.rejects(readdir(path.join(directory, "logs/sessions/2026-11-20_old")), {
    code: "ENOENT",
  }, "Older sessions must not be copied into the debug archive")
  assert.equal(
    gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-25_live/terminal.log.gz"))).toString("utf8"),
    "independent LIVE session evidence",
    "An unrelated live session must be preserved separately and never substituted for the selected runtime.",
  )
  await assert.rejects(readdir(path.join(directory, "logs/cumulative")), {
    code: "ENOENT",
  }, "Cumulative logs must be excluded from the debug archive")
  await assert.rejects(readdir(path.join(directory, "data")), {
    code: "ENOENT",
  }, "Database and backup data must be excluded from the debug archive")
  return {
    commit: REMOTE_COMMIT,
    fileCount: manifest.files.length + 1,
  }
}

function archiveDependencies({ fixture, overrides = {}, expectedIdentityStatus = "matched", expectedTradingMode = "testnet" } = {}) {
  return {
    packageDirectory: fixture.packageDirectory,
    lockDirectory: fixture.lockDirectory,
    env: {
      TRADING_MODE: "testnet",
      OPERATIONAL_STATE_DIRECTORY: path.join(fixture.packageDirectory, "recovery-facts"),
      ...overrides,
    },
    args: [],
    now: () => new Date(CREATED_AT),
    createArchiveId: () => ARCHIVE_ID,
    onArchiveCreatedFn: ({ directory }) => assertCollectedArchive({
      directory,
      expectedIdentityStatus,
      expectedTradingMode,
    }),
  }
}

test("copies only bytes present at the snapshot boundary when an append-only log grows", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sourcePath = path.join(fixture.packageDirectory, "growing.log")
  const destinationPath = path.join(fixture.packageDirectory, "snapshot.log.gz")
  const snapshotBytes = Buffer.from("bytes present at the snapshot boundary\n")
  await writeFile(sourcePath, snapshotBytes)
  const sourceBefore = await lstat(sourcePath)
  const sourceSha256Before = createHash("sha256").update(snapshotBytes).digest("hex")
  await appendFile(sourcePath, "bytes appended after the snapshot boundary\n")
  const sourceSha256After = await assertSourceFileStable({
    sourcePath,
    sourceBefore,
    sourceSha256Before,
  })
  assert.equal(sourceSha256After, sourceSha256Before, "An append must not change the captured prefix hash.")
  await copyFileRange({
    sourcePath,
    destinationPath,
    size: sourceBefore.size,
    compressed: true,
  })
  assert.deepEqual(gunzipSync(await readFile(destinationPath)), snapshotBytes)
})


test("rejects a source file replaced after its snapshot identity was captured", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sourcePath = path.join(fixture.packageDirectory, "replaced.log")
  const replacementPath = path.join(fixture.packageDirectory, "replacement.log")
  const originalBytes = Buffer.from("original-content")
  await writeFile(sourcePath, originalBytes)
  const sourceBefore = await lstat(sourcePath)
  const sourceSha256Before = createHash("sha256").update(originalBytes).digest("hex")
  await writeFile(replacementPath, Buffer.from("replaced--content"))
  await rm(sourcePath)
  await rename(replacementPath, sourcePath)
  await assert.rejects(assertSourceFileStable({
    sourcePath,
    sourceBefore,
    sourceSha256Before,
  }), /replaced, truncated, or modified/i)
})


test("rejects a source file truncated after its snapshot identity was captured", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sourcePath = path.join(fixture.packageDirectory, "truncated.log")
  const originalBytes = Buffer.from("original-log-content")
  await writeFile(sourcePath, originalBytes)
  const sourceBefore = await lstat(sourcePath)
  const sourceSha256Before = createHash("sha256").update(originalBytes).digest("hex")
  await writeFile(sourcePath, Buffer.from("short"))
  await assert.rejects(assertSourceFileStable({
    sourcePath,
    sourceBefore,
    sourceSha256Before,
  }), /replaced, truncated, or modified/i)
})

test("adds _debug to the existing timestamp and archive-ID directory name", () => {
  assert.equal(
    createHarvesterArchiveDirectoryName({
      createdAt: CREATED_AT,
      archiveId: ARCHIVE_ID
    }),
    "2026-11-24T18-30-00Z_123e4567_debug",
    "Debug archive directory must retain the established timestamp/ID format with the debug suffix",
  )
})


test("collects a verified archive without requiring GitHub publication configuration", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  let collectionCompleted = false
  const result = await runHarvesterDebugArchive({
    ...archiveDependencies({
      fixture,
      overrides: { HARVESTER_ARCHIVE_REMOTE: undefined },
    }),
    onArchiveCreatedFn: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      assert.ok(manifest.files.length > 0, "Collection must finish writing the archive manifest before returning.")
      collectionCompleted = true
    },
  })
  assert.equal(collectionCompleted, true, "Collection must complete without invoking a publication step.")
  assert.equal(result.archiveName, "2026-11-24T18-30-00Z_123e4567_debug", "Collection must return its local immutable archive identity.")
})

test("preserves testnet and live session inventory without changing source evidence", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const result = await runHarvesterDebugArchive(archiveDependencies({ fixture }))
  assert.equal(result.archiveName, "2026-11-24T18-30-00Z_123e4567_debug", "Published archive must use the deterministic debug directory name")
  assert.equal(result.localArchive.endsWith(result.archiveName), true, "Collection must return the completed local archive directory")
  for (const [relativePath, expected] of Object.entries(fixture.files)) {
    assert.equal(
      await readFile(path.join(fixture.packageDirectory, relativePath), "utf8"),
      expected,
      `Source evidence must remain unchanged: ${relativePath}`,
    )
  }
})

test("retains an unverifiable recovery checkpoint only as local diagnostic evidence", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const filename = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(filename, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = OTHER_SESSION_ID
  const mismatchedFactsContent = jsonLines(facts)
  await writeFile(filename, mismatchedFactsContent, "utf8")
  let diagnosticDirectory
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: async ({ directory }) => {
        diagnosticDirectory = directory
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.runtimeIdentity.status, "unverifiable", "The diagnostic archive must identify the inconsistent recovery checkpoint.")
        assert.equal(manifest.evidenceIntegrity.validForPublication, false, "Mismatched evidence must not be publishable.")
      },
    }),
    /unverifiable|evidence integrity/i,
    "An unverifiable recovery checkpoint must fail collection after retaining local diagnostics",
  )
  assert.ok(diagnosticDirectory, "The diagnostic archive must remain available locally.")
  assert.equal(await readFile(filename, "utf8"), mismatchedFactsContent, "Collection must leave source recovery facts unchanged.")
})

test("still rejects an invalid recovery-facts checkpoint instead of publishing mismatched evidence", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const filename = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const originalFacts = await readFile(filename, "utf8")
  const facts = originalFacts.trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).digest = "f".repeat(64)
  const invalidFactsContent = jsonLines(facts)
  await writeFile(filename, invalidFactsContent, "utf8")
  await assert.rejects(
    runHarvesterDebugArchive(archiveDependencies({
      fixture,
      expectedIdentityStatus: "mismatched",
    })),
    /latest recovery-facts manifest does not match/i,
    "An identity mismatch must not weaken recovery-facts integrity validation",
  )
  assert.equal(
    await readFile(filename, "utf8"),
    invalidFactsContent,
    "Archive failure must leave the invalid source ledger unchanged for diagnosis",
  )
})

async function prepareActiveRuntimeFixture({ fixture } = {}) {
  const sessionDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet")
  const identityPath = path.join(sessionDirectory, "process-identity.json")
  const identity = JSON.parse(await readFile(identityPath, "utf8"))
  identity.processId = process.pid
  await writeFile(identityPath, JSON.stringify(identity), "utf8")
  await rm(path.join(sessionDirectory, "process-completed.json"))
  await rm(path.join(sessionDirectory, "log-streams-completed.json"))
  const factsPath = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts[0].data.processIdentity.processId = process.pid
  await writeFile(factsPath, jsonLines(facts), "utf8")
  const lockOwner = {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: identity.startedAt,
    token: "active-test-lock-token",
  }
  const lockFingerprint = "a".repeat(64)
  const lockPath = path.join(fixture.lockDirectory, `.harvester-trading-${lockFingerprint}.lock`)
  const hostLockPath = path.join(fixture.lockDirectory, `.binance-harvester-trading-${lockFingerprint}.lock`)
  await writeFile(lockPath, JSON.stringify(lockOwner), "utf8")
  await writeFile(hostLockPath, JSON.stringify({
    ...lockOwner,
    token: "active-host-lock-token",
  }), "utf8")
  return {
    lockPath,
    hostLockPath,
    lockOwner,
  }
}

test("uses the durable PROCESS_STARTED PID to verify a matching active session with legacy session metadata", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await prepareActiveRuntimeFixture({ fixture })
  const identityPath = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/process-identity.json")
  const sessionIdentity = JSON.parse(await readFile(identityPath, "utf8"))
  delete sessionIdentity.processId
  await writeFile(identityPath, JSON.stringify(sessionIdentity), "utf8")

  const result = await runHarvesterDebugArchive({
    ...archiveDependencies({ fixture }),
    onArchiveCreatedFn: undefined,
  })
  const manifest = await readArchiveManifest(result.localArchive)
  const matchingSession = manifest.sessionInventory.find(({ runtimeSessionId }) => runtimeSessionId === RUNTIME_SESSION_ID)

  assert.equal(result.matchingTradingLogsAvailable, true, "The exact durable process-start PID and live lock must establish ownership when a legacy session identity lacks its duplicated PID.")
  assert.equal(matchingSession.processId, process.pid, "The session inventory must use the PID from the exact matching durable PROCESS_STARTED fact.")
  assert.equal(matchingSession.completionStatus, "active", "The matching live lock must classify this session as active without requiring completion files.")
  assert.equal(manifest.evidenceIntegrity.validForPublication, true, "A uniquely matched active runtime with durable identity and verified lock ownership must be publishable.")
})

test("does not replace an explicit session PID that conflicts with durable process identity", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await prepareActiveRuntimeFixture({ fixture })
  const identityPath = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/process-identity.json")
  const sessionIdentity = JSON.parse(await readFile(identityPath, "utf8"))
  sessionIdentity.processId = process.pid + 1
  await writeFile(identityPath, JSON.stringify(sessionIdentity), "utf8")

  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: undefined,
    }),
    /evidence integrity failed|mismatched/i,
    "An explicit session PID that conflicts with durable PROCESS_STARTED identity must remain an integrity failure.",
  )
})

test("does not borrow a durable PID when the session start timestamp differs", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await prepareActiveRuntimeFixture({ fixture })
  const identityPath = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/process-identity.json")
  const sessionIdentity = JSON.parse(await readFile(identityPath, "utf8"))
  delete sessionIdentity.processId
  sessionIdentity.startedAt = "2026-11-24T18:21:00.000Z"
  await writeFile(identityPath, JSON.stringify(sessionIdentity), "utf8")

  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: undefined,
    }),
    /evidence integrity failed|incomplete/i,
    "A durable PID must not be borrowed unless the session's original start timestamp also matches exactly.",
  )
})

test("collects and marks the exact active runtime without stopping or clearing its process lock", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const { lockPath, hostLockPath, lockOwner } = await prepareActiveRuntimeFixture({ fixture })
  const result = await runHarvesterDebugArchive({
    ...archiveDependencies({ fixture }),
    onArchiveCreatedFn: undefined,
  })
  const manifest = await readArchiveManifest(result.localArchive)
  const matchingSession = manifest.sessionInventory.find(({ runtimeSessionId }) => runtimeSessionId === RUNTIME_SESSION_ID)
  assert.equal(result.matchingTradingLogsAvailable, true, "An active process must not block collection when its process lock and durable runtime identity match.")
  assert.equal(matchingSession.completionStatus, "active", "The archive must distinguish a live snapshot from a completed process.")
  assert.equal(matchingSession.loggerCompletionStatus, "active", "The archive must not invent logger completion for a running process.")
  assert.equal(matchingSession.activeSnapshotPath, "logs/sessions/2026-11-24_testnet/active-process-snapshot.json", "The archive must record the active snapshot provenance path.")
  const snapshotMarker = JSON.parse(await readFile(path.join(result.localArchive, matchingSession.activeSnapshotPath), "utf8"))
  assert.equal(snapshotMarker.runtimeSessionId, RUNTIME_SESSION_ID, "The active snapshot marker must identify the recovery runtime.")
  assert.equal(snapshotMarker.processId, process.pid, "The active snapshot marker must identify the locked process.")
  assert.equal(snapshotMarker.recoveryDataCommitHash, DATA_COMMIT_HASH, "The active snapshot marker must bind to the copied recovery checkpoint.")
  assert.deepEqual(snapshotMarker.streams, {
    harvesterLog: true,
    traceLog: true,
  }, "The active snapshot marker must confirm both runtime-owned streams.")
  assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, lockOwner.token, "Collection must not modify or remove the Journal process lock.")
  assert.equal(JSON.parse(await readFile(hostLockPath, "utf8")).token, "active-host-lock-token", "Collection must not modify or remove the host process lock.")
  assert.equal(manifest.evidenceIntegrity.validForPublication, true, "A uniquely identified active runtime snapshot is publishable.")
})

test("archives stable logs for a stopped runtime when legacy completion markers are absent", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await prepareActiveRuntimeFixture({ fixture })
  const legacySessionDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-09_legacy-without-identity")
  await mkdir(legacySessionDirectory, { recursive: true })
  await writeFile(path.join(legacySessionDirectory, "harvester.log"), "unrelated legacy evidence", "utf8")
  const result = await runHarvesterDebugArchive({
    ...archiveDependencies({ fixture }),
    isProcessAlive: () => false,
    onArchiveCreatedFn: undefined,
  })
  const manifest = await readArchiveManifest(result.localArchive)
  const session = manifest.sessionInventory.find(({ runtimeSessionId }) => runtimeSessionId === RUNTIME_SESSION_ID)
  assert.equal(result.matchingTradingLogsAvailable, true, "Exact runtime identity plus a confirmed stopped PID must select the preserved logs.")
  assert.equal(session.completionStatus, "stopped-unconfirmed", "A stopped process without completion metadata must not be mislabeled as cleanly completed.")
  assert.equal(session.loggerCompletionStatus, "stopped-unconfirmed", "Missing logger-flush metadata must remain explicit.")
  assert.equal(session.stoppedSnapshotPath, "logs/sessions/2026-11-24_testnet/stopped-process-snapshot.json")
  const marker = JSON.parse(await readFile(path.join(result.localArchive, session.stoppedSnapshotPath), "utf8"))
  assert.equal(marker.runtimeSessionId, RUNTIME_SESSION_ID)
  assert.equal(marker.processId, process.pid)
  assert.equal(marker.processAliveAtCapture, false)
  assert.equal(marker.completionConfirmed, false)
  assert.deepEqual(marker.streams, {
    harvesterLog: true,
    traceLog: true,
  })
  assert.equal(manifest.evidenceIntegrity.validForPublication, true, "A byte-stable, runtime-matched stopped-process snapshot is publishable as explicitly unconfirmed evidence.")
  assert.ok(manifest.evidenceIntegrity.unverifiableSessions.includes("logs/sessions/2026-11-09_legacy-without-identity"), "Unidentified historical sessions must remain independent and must not block a proven exact-runtime snapshot.")
  assert.ok(manifest.warnings.some(({ code }) => code === "STOPPED_RUNTIME_COMPLETION_UNCONFIRMED"), "The archive must make the unconfirmed process exit and logger flush visible.")
  assert.ok(manifest.warnings.some(({ code }) => code === "SESSION_COMPLETION_RECORD_MISSING"))
  assert.ok(manifest.warnings.some(({ code }) => code === "SESSION_LOGGER_COMPLETION_RECORD_MISSING"))
})

test("does not classify a PID as stopped when it remains alive without its process locks", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const { lockPath, hostLockPath } = await prepareActiveRuntimeFixture({ fixture })
  await Promise.all([rm(lockPath), rm(hostLockPath)])
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      isProcessAlive: () => true,
      onArchiveCreatedFn: undefined,
    }),
    /incomplete|evidence integrity|COLLECTION FAILED/i,
    "A missing lock pair must not turn a still-live PID into a stopped-process snapshot.",
  )
})

test("leaves stale process locks untouched while collecting the TESTNET debug archive", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const staleOwner = {
    pid: 2_000_000_000,
    hostname: os.hostname(),
    startedAt: "2026-11-24T17:12:22.255Z",
    token: "stale-owner-token",
  }
  const lockPaths = [
    path.join(fixture.lockDirectory, ".harvester-trading-test.lock"),
    path.join(fixture.lockDirectory, ".binance-harvester-trading-test.lock"),
  ]
  await Promise.all(lockPaths.map((lockPath) => writeFile(lockPath, JSON.stringify(staleOwner), "utf8")))

  const result = await runHarvesterDebugArchive(archiveDependencies({ fixture }))

  assert.equal(result.archiveName, "2026-11-24T18-30-00Z_123e4567_debug", "A stale lock must not block a read-only archive snapshot.")
  for (const lockPath of lockPaths) {
    assert.equal(await readFile(lockPath, "utf8"), JSON.stringify(staleOwner), "Archive collection must never reclaim or mutate process locks.")
  }
})


test("collection rejects symbolic links instead of archiving their targets", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const externalPath = path.join(fixture.packageDirectory, "external-terminal.log")
  await writeFile(externalPath, "external data must not be followed", "utf8")
  const terminalPath = path.join(
    fixture.packageDirectory,
    "logs/sessions/2026-11-24_testnet/terminal.log",
  )
  await rm(terminalPath)
  try {
    await symlink(externalPath, terminalPath)
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip("This platform does not permit creating symbolic links for the test.")
      return
    }
    throw error
  }
  await assert.rejects(
    runHarvesterDebugArchive(archiveDependencies({ fixture })),
    /symbolic link/i,
    "Collection must reject a symlink rather than following it into the archive.",
  )
  assert.equal(
    await readFile(externalPath, "utf8"),
    "external data must not be followed",
    "The external target must remain untouched.",
  )
})

test("collects a LIVE runtime without requiring TRADING_MODE", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const sessionsDirectory = path.join(fixture.packageDirectory, "logs", "sessions")
  const testnetSessionDirectory = path.join(sessionsDirectory, "2026-11-24_testnet")
  const liveSessionDirectory = path.join(sessionsDirectory, "2026-11-24_live")
  await rm(liveSessionDirectory, {
    recursive: true,
    force: true,
  })
  await rename(testnetSessionDirectory, liveSessionDirectory)
  const identityPath = path.join(liveSessionDirectory, "process-identity.json")
  const identity = JSON.parse(await readFile(identityPath, "utf8"))
  identity.environment = "live"
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`)
  const dependencies = archiveDependencies({
    fixture,
    expectedTradingMode: "live",
    overrides: {
      TRADING_MODE: undefined,
    },
  })
  const result = await runHarvesterDebugArchive(dependencies)
  const manifest = JSON.parse(await readFile(
    path.join(result.localArchive, "manifest.json"),
    "utf8",
  ))
  assert.equal(manifest.runtimeTradingMode, "live")
  assert.equal(manifest.logRuntimeSessionId, RUNTIME_SESSION_ID)
  assert.equal(manifest.evidenceIntegrity.validForPublication, true)
})

async function writeTestnetSession({
  fixture,
  sessionName,
  runtimeSessionId,
  complete = true,
  exitCode = 0,
  terminalContent = "independent TESTNET session evidence",
  includeIdentity = true,
  sourceCommit = "b".repeat(40),
} = {}) {
  const sessionDirectory = path.join(fixture.packageDirectory, "logs/sessions", sessionName)
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(path.join(sessionDirectory, "terminal.log"), terminalContent, "utf8")
  await writeFile(path.join(sessionDirectory, "harvester.log"), `debug stream for ${runtimeSessionId}`, "utf8")
  await writeFile(path.join(sessionDirectory, "trace.log"), `trace stream for ${runtimeSessionId}`, "utf8")
  await writeFile(path.join(sessionDirectory, "log-streams-completed.json"), JSON.stringify({
    runtimeSessionId,
    endedAt: "2026-11-25T18:29:00.000Z",
    logStreamsComplete: true,
    streams: {
        harvesterLog: true,
        traceLog: true,
      },
  }), "utf8")
  if (includeIdentity) {
    await writeFile(path.join(sessionDirectory, "process-identity.json"), JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "testnet",
      startedAt: "2026-11-25T10:00:00.000Z",
      runtimeSessionId,
      source: {
        branch: "develop",
        commit: sourceCommit,
        shortCommit: sourceCommit.slice(0, 8),
        commitMessage: "test independent runtime",
        commitDate: "2026-11-25T09:00:00.000Z",
        workingTree: "dirty",
        metadataSource: "git",
      },
    }), "utf8")
  }
  await writeFile(path.join(sessionDirectory, "process-completed.json"), JSON.stringify({
    runtimeSessionId,
    endedAt: "2026-11-25T10:05:00.000Z",
    exitCode,
    signal: null,
    logStreamsComplete: complete,
  }), "utf8")
  return sessionDirectory
}

async function readArchiveManifest(directory) {
  return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
}

function archiveWithoutPublishing({ fixture, inspectArchive }) {
  return {
    ...archiveDependencies({ fixture }),
    onArchiveCreatedFn: async ({ directory }) => inspectArchive({ directory }),
  }
}

test("selects the exact trading-runtime session instead of a newer unrelated TESTNET startup", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await writeTestnetSession({
    fixture,
    sessionName: "2026-11-25_newer-unrelated",
    runtimeSessionId: OTHER_SESSION_ID,
    terminalContent: "newer unrelated startup failure",
    exitCode: 1,
  })

  const result = await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      assert.equal(manifest.matchingTradingLogsAvailable, true, "A unique complete session with the exact recovery runtime ID must be reported as available.")
      assert.equal(manifest.logRuntimeSessionId, RUNTIME_SESSION_ID, "A newer unrelated runtime must never replace the exact trading-runtime log match.")
      assert.equal(manifest.runtimeIdentity.status, "matched", "Exact runtime identity must be the only basis for a matched correlation status.")
      assert.equal(manifest.logSelection.selectionReason, "exact-runtime-id-match", "The manifest must explain why the matching session was selected.")
      assert.equal(
        gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-24_testnet/terminal.log.gz"))).toString("utf8"),
        "selected runtime session evidence",
        "The exact matching session's terminal output must be archived.",
      )
      assert.equal(
        gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-25_newer-unrelated/terminal.log.gz"))).toString("utf8"),
        "newer unrelated startup failure",
        "A newer unrelated session may be preserved only as independent evidence.",
      )
      const unrelated = manifest.sessionInventory.find(({ sessionName }) => sessionName === "2026-11-25_newer-unrelated")
      assert.equal(unrelated.selectionReason, "independent-evidence-not-selected", "The newer unrelated session must not be represented as the selected trading-runtime logs.")
      assert.equal(unrelated.processOutcome.status, "failed", "The unrelated failed-startup outcome must remain visible in the inventory.")
    },
  }))
  assert.equal(result.matchingTradingLogsAvailable, true, "The archive command result must expose exact runtime log coverage.")
})

test("fails collection when only an unrelated runtime's log streams are available", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const factsPath = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = OTHER_SESSION_ID
  await writeFile(factsPath, jsonLines(facts), "utf8")
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "mismatched", "The local diagnostic must distinguish mismatched from missing logs.")
        assert.equal(manifest.evidenceIntegrity.expectedRuntimeId, OTHER_SESSION_ID, "Expected runtime must come from recovery facts.")
        assert.ok(manifest.evidenceIntegrity.mismatches.some(({ actualRuntimeId }) => actualRuntimeId === RUNTIME_SESSION_ID), "Every unrelated stream owner must be identified.")
      },
    })),
    /mismatched|evidence integrity/i,
    "The collector must not complete an archive with another runtime's logs",
  )
})

test("fails closed when two session directories claim the same runtime identity", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await writeTestnetSession({
    fixture,
    sessionName: "2026-11-25_duplicate-runtime",
    runtimeSessionId: RUNTIME_SESSION_ID,
  })
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "unverifiable", "Ambiguous runtime ownership must be unverifiable.")
        assert.equal(manifest.matchingSessionCandidates.length, 2, "Both competing owners must remain named in the diagnostic.")
      },
    })),
    /evidence integrity|COLLECTION FAILED/i,
    "Ambiguous ownership must never create a publishable archive",
  )
})

test("detects identical source log content while retaining every source path", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sessionDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet")
  const identicalLogContent = "same startup-failure record"
  await writeFile(path.join(sessionDirectory, "harvester.log"), identicalLogContent, "utf8")
  await writeFile(path.join(sessionDirectory, "trace.log"), identicalLogContent, "utf8")
  const expectedHash = createHash("sha256").update(identicalLogContent).digest("hex")

  await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      const duplicate = manifest.duplicateArtifacts.find(({ sourceSha256 }) => sourceSha256 === expectedHash)
      assert.ok(duplicate, "Identical source bytes must be reported as a duplicate-artifact group.")
      assert.deepEqual(
        duplicate.sourcePaths.sort(),
        [
          "logs/sessions/2026-11-24_testnet/harvester.log",
          "logs/sessions/2026-11-24_testnet/trace.log",
        ],
        "Duplicate detection must preserve every original source-path provenance entry.",
      )
      assert.deepEqual(
        duplicate.archivePaths.sort(),
        [
          "logs/sessions/2026-11-24_testnet/harvester.log.gz",
          "logs/sessions/2026-11-24_testnet/trace.log.gz",
        ],
        "Every duplicate source path must remain traceable to its separately archived artifact.",
      )
    },
  }))
})

test("reports missing durable process identity as unverifiable diagnostic evidence", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const factsPath = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  delete facts[0].data.processIdentity
  await writeFile(factsPath, jsonLines(facts), "utf8")
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "unverifiable", "Missing durable process identity must block publication.")
        assert.equal(manifest.tradingRuntime.processIdentity, null, "No identity may be inferred from session metadata.")
      },
    })),
    /unverifiable|evidence integrity/i,
    "Missing process identity must fail closed",
  )
})

test("retains incomplete failed-startup logs only in a non-publishable diagnostic archive", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const completionPath = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/process-completed.json")
  await writeFile(completionPath, JSON.stringify({
    runtimeSessionId: RUNTIME_SESSION_ID,
    endedAt: "2026-11-24T18:29:00.000Z",
    exitCode: 1,
    signal: null,
    logStreamsComplete: false,
  }), "utf8")
  let diagnosticDirectory
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: async ({ directory }) => {
        diagnosticDirectory = directory
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "incomplete", "Incomplete log stream closure must make evidence incomplete.")
        assert.equal(manifest.evidenceIntegrity.validForPublication, false, "Incomplete logs must never be publishable.")
      },
    }),
    /incomplete|evidence integrity/i,
    "A crashed or unflushed process must not produce a completed archive",
  )
  assert.ok(diagnosticDirectory, "The incomplete evidence must remain available locally.")
})

test("retains a mismatched runtime archive only as diagnostic evidence and fails collection", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const factsPath = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = OTHER_SESSION_ID
  await writeFile(factsPath, jsonLines(facts), "utf8")
  let diagnosticDirectory

  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: async ({ directory }) => {
        diagnosticDirectory = directory
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "mismatched", "The diagnostic manifest must explicitly classify the runtime mismatch.")
        assert.equal(manifest.evidenceIntegrity.validForPublication, false, "Mismatched evidence must never be marked publishable.")
        assert.equal(manifest.evidenceIntegrity.expectedRuntimeId, OTHER_SESSION_ID, "The expected runtime must come from the recovery-facts checkpoint.")
        assert.deepEqual([...new Set(manifest.evidenceIntegrity.mismatches.map(({ actualRuntimeId }) => actualRuntimeId))], [RUNTIME_SESSION_ID], "The manifest must identify the actual runtime owning the retained log files.")
      },
    }),
    /TRACE LOG COLLECTION FAILED|runtime mismatch|evidence integrity/i,
    "A runtime mismatch must produce a non-zero collection result after preserving a diagnostic archive",
  )
  assert.ok(diagnosticDirectory, "The failed collection must retain its local diagnostic archive.")
  assert.equal(path.basename(diagnosticDirectory).endsWith("_debug"), true, "The diagnostic directory must remain distinguishable from an ordinary archive.")
})

test("reports missing required log streams as incomplete instead of accepting files from another stream", async (t) => {
  const fixture = await createFixture()
  await rm(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/harvester.log"))
  await rm(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/trace.log"))
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  let diagnosticDirectory
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: async ({ directory }) => {
        diagnosticDirectory = directory
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "incomplete", "Missing required streams must make the evidence incomplete.")
        assert.equal(manifest.evidenceIntegrity.validForPublication, false, "Incomplete evidence must not be publishable.")
        assert.equal(manifest.evidenceIntegrity.streams.harvesterLog.status, "missing", "A missing Harvester log must be explicit.")
        assert.equal(manifest.evidenceIntegrity.streams.traceLog.status, "missing", "A missing trace log must be explicit.")
      },
    }),
    /HARVESTER LOG COLLECTION FAILED|TRACE LOG COLLECTION FAILED|evidence integrity/i,
    "A session containing only terminal output must not be accepted as complete trading evidence",
  )
  assert.ok(diagnosticDirectory, "An incomplete local diagnostic archive must be retained.")
})

 
test("collects every rotated and pre-compressed DEBUG and TRACE file for the exact runtime", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sessionDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet")
  const rotatedDebug = "older rotated debug evidence"
  const rotatedTrace = gzipSync(Buffer.from("pre-compressed trace evidence"))
  await writeFile(path.join(sessionDirectory, "harvester.log.1"), rotatedDebug)
  await writeFile(path.join(sessionDirectory, "trace.log.1.gz"), rotatedTrace)
  await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      const debugFile = manifest.evidenceIntegrity.streams.harvesterLog.files.find(({ sourcePath }) => sourcePath.endsWith("harvester.log.1"))
      const traceFile = manifest.evidenceIntegrity.streams.traceLog.files.find(({ sourcePath }) => sourcePath.endsWith("trace.log.1.gz"))
      assert.ok(debugFile, "The rotated DEBUG file must be inventoried.")
      assert.ok(traceFile, "The already-compressed rotated TRACE file must be inventoried.")
      assert.equal(debugFile.rotationIndex, 1, "Rotation metadata must preserve the numeric generation.")
      assert.equal(traceFile.rotationIndex, 1, "Compressed rotation metadata must preserve the numeric generation.")
      assert.equal(traceFile.compression, "source-gzip-preserved", "An existing gzip file must not be compressed a second time.")
      assert.deepEqual(await readFile(path.join(directory, traceFile.archivePath)), rotatedTrace, "The original compressed bytes and filename must be preserved.")
      assert.equal(gunzipSync(await readFile(path.join(directory, traceFile.archivePath))).toString("utf8"), "pre-compressed trace evidence", "A preserved compressed rotation must contain readable gzip data.")
    },
  }))
})

test("rejects source log names that collide after gzip archive naming", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sessionDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet")
  await writeFile(
    path.join(sessionDirectory, "harvester.log.gz"),
    gzipSync(Buffer.from("a separately rotated compressed DEBUG generation")),
  )
  await assert.rejects(
    runHarvesterDebugArchive(archiveDependencies({ fixture })),
    /archive path collision|duplicate archive path|already exists/i,
    "The collector must reject two source files that map to one archive path instead of silently overwriting forensic evidence.",
  )
})

test("rejects an unreadable pre-compressed rotated log instead of archiving corrupt gzip bytes", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const sessionDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet")
  await writeFile(path.join(sessionDirectory, "trace.log.1.gz"), Buffer.from("not a gzip stream"))
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async () => assert.fail("ARCHIVE_CALLBACK_REACHED"),
    })),
    /gzip|compressed|decompress/i,
    "The collector must reject a .gz rotation whose contents cannot be decompressed.",
  )
})


async function assertActiveSnapshotRejectsChangedLock({ namespace, testContext } = {}) {
  const fixture = await createFixture()
  testContext.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const { lockPath, hostLockPath, lockOwner } = await prepareActiveRuntimeFixture({ fixture })
  const changedLockPath = namespace === "host" ? hostLockPath : lockPath
  let lockChanged = false
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: undefined,
      onProgress(message) {
        if (!lockChanged && message.includes("retained/copied")) {
          lockChanged = true
          writeFileSync(changedLockPath, JSON.stringify({
            ...lockOwner,
            token: "externally-replaced-lock-token",
          }), "utf8")
        }
      },
    }),
    /lock changed|ownership changed|snapshot.*not publishable/i,
    "The collector must reject a snapshot when either owned lock namespace changes.",
  )
  assert.equal(lockChanged, true, "The test must replace the selected lock after the snapshot copy has started.")
  const archiveDirectory = path.join(fixture.packageDirectory, "archive-output", "2026-11-24T18-30-00Z_123e4567_debug")
  const incompleteMarker = JSON.parse(await readFile(path.join(archiveDirectory, "collection-incomplete.json"), "utf8"))
  assert.equal(incompleteMarker.status, "incomplete", "A failed active snapshot must remain explicitly marked incomplete.")
  assert.equal(incompleteMarker.runtimeSessionId, RUNTIME_SESSION_ID, "The incomplete marker must identify the affected runtime.")
}


test("marks an active snapshot incomplete when the selected process exits during collection", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const { lockPath, hostLockPath } = await prepareActiveRuntimeFixture({ fixture })
  const applicationLockBefore = await readFile(lockPath)
  const hostLockBefore = await readFile(hostLockPath)
  let processAlive = true
  let processExitSimulated = false
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: undefined,
      isProcessAlive: (processId) => processAlive && processId === process.pid,
      onProgress(message) {
        if (!processExitSimulated && message.includes("retained/copied")) {
          processExitSimulated = true
          processAlive = false
        }
      },
    }),
    /process exited|snapshot.*not publishable/i,
    "A process that exits after the snapshot boundary must not produce a publishable archive.",
  )
  assert.equal(processExitSimulated, true, "The test must simulate process exit after evidence copying begins.")
  assert.deepEqual(await readFile(lockPath), applicationLockBefore, "The collector must not modify the application lock after process exit.")
  assert.deepEqual(await readFile(hostLockPath), hostLockBefore, "The collector must not modify the host lock after process exit.")
  const archiveDirectory = path.join(fixture.packageDirectory, "archive-output", "2026-11-24T18-30-00Z_123e4567_debug")
  const incompleteMarker = JSON.parse(await readFile(path.join(archiveDirectory, "collection-incomplete.json"), "utf8"))
  assert.equal(incompleteMarker.status, "incomplete", "Process exit during collection must leave an explicit incomplete marker.")
  assert.equal(incompleteMarker.reason, "process-exited-during-collection", "The incomplete marker must explain why the active snapshot was rejected.")
  await assert.rejects(
    readFile(path.join(archiveDirectory, "logs/sessions/2026-11-24_testnet/active-process-snapshot.json")),
    { code: "ENOENT" },
    "A failed active snapshot must not receive a completed active-snapshot marker.",
  )
})


test("rejects ambiguous ownership when multiple Harvester processes are alive", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const { lockPath, hostLockPath, lockOwner } = await prepareActiveRuntimeFixture({ fixture })
  const additionalFingerprint = "b".repeat(64)
  const additionalHostLockPath = path.join(fixture.lockDirectory, `.bitunix-harvester-trading-${additionalFingerprint}.lock`)
  const additionalApplicationLockPath = path.join(fixture.lockDirectory, `.harvester-trading-${additionalFingerprint}.lock`)
  const additionalLockOwner = {
    ...lockOwner,
    pid: lockOwner.pid + 100000,
    token: "second-live-process-token",
  }
  await writeFile(additionalHostLockPath, JSON.stringify(additionalLockOwner), "utf8")
  await writeFile(additionalApplicationLockPath, JSON.stringify(additionalLockOwner), "utf8")
  const applicationLockBefore = await readFile(lockPath)
  const hostLockBefore = await readFile(hostLockPath)
  const additionalHostLockBefore = await readFile(additionalHostLockPath)
  const additionalApplicationLockBefore = await readFile(additionalApplicationLockPath)
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: undefined,
      isProcessAlive: () => true,
    }),
    /multiple active process owners/i,
    "Multiple live PIDs must be rejected rather than selecting the newest or most convenient runtime.",
  )
  assert.deepEqual(await readFile(lockPath), applicationLockBefore, "Ambiguous ownership must not modify the application lock.")
  assert.deepEqual(await readFile(hostLockPath), hostLockBefore, "Ambiguous ownership must not modify the host lock.")
  assert.deepEqual(await readFile(additionalHostLockPath), additionalHostLockBefore, "Ambiguous ownership must not modify the second host process lock.")
  assert.deepEqual(await readFile(additionalApplicationLockPath), additionalApplicationLockBefore, "Ambiguous ownership must not modify the second application process lock.")
})


test("rejects an active process when one of its required lock namespaces is missing", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const { lockPath, hostLockPath } = await prepareActiveRuntimeFixture({ fixture })
  await rm(hostLockPath)
  const applicationLockBefore = await readFile(lockPath)
  await assert.rejects(
    runHarvesterDebugArchive({
      ...archiveDependencies({ fixture }),
      onArchiveCreatedFn: undefined,
    }),
    /lock namespace.*incomplete|both.*lock namespaces/i,
    "A running Harvester process must have both its host and application lock records.",
  )
  assert.deepEqual(await readFile(lockPath), applicationLockBefore, "Rejecting an incomplete lock pair must not modify the remaining lock.")
})


test("rejects an active snapshot when the application process-lock namespace changes during collection", async (t) => {
  await assertActiveSnapshotRejectsChangedLock({
    namespace: "application",
    testContext: t,
  })
})


test("rejects an active snapshot when the host process-lock namespace changes during collection", async (t) => {
  await assertActiveSnapshotRejectsChangedLock({
    namespace: "host",
    testContext: t,
  })
})


test("rejects empty TRACE streams and records the empty source file", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await writeFile(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/trace.log"), "")
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "incomplete", "An empty required stream must make the archive incomplete.")
        const emptyFile = manifest.evidenceIntegrity.streams.traceLog.files.find(({ sourcePath }) => sourcePath.endsWith("/trace.log"))
        assert.equal(emptyFile.result, "empty", "The manifest must distinguish an empty stream from a missing stream.")
        assert.equal(emptyFile.sourceSize, 0, "The empty source size must be explicit.")
      },
    })),
    /incomplete|COLLECTION FAILED/i,
    "An empty TRACE file must not satisfy stream completeness",
  )
})

test("rejects missing process-completion metadata even when both log files exist", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await rm(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/process-completed.json"))
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.status, "incomplete", "A missing completion record must make evidence incomplete.")
        const session = manifest.sessionInventory.find(({ sessionName }) => sessionName === "2026-11-24_testnet")
        assert.ok(session.missingFieldWarnings.includes("COMPLETION_RECORD_MISSING"), "The missing completion record must be named.")
      },
    })),
    /incomplete|COLLECTION FAILED/i,
    "Log file presence alone must not prove successful process completion",
  )
})

 
test("fails when only the Harvester DEBUG stream is missing", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await rm(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/harvester.log"))
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.streams.harvesterLog.status, "missing")
        assert.equal(manifest.evidenceIntegrity.streams.traceLog.status, "matched")
      },
    })),
    /HARVESTER LOG COLLECTION FAILED/i,
    "Missing DEBUG evidence must have a stream-specific failure",
  )
})

test("fails when only the TRACE stream is missing", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await rm(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/trace.log"))
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        assert.equal(manifest.evidenceIntegrity.streams.harvesterLog.status, "matched")
        assert.equal(manifest.evidenceIntegrity.streams.traceLog.status, "missing")
      },
    })),
    /TRACE LOG COLLECTION FAILED/i,
    "Missing TRACE evidence must have a stream-specific failure",
  )
})

 
test("rejects missing logger-flush metadata even when process completion exists", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  await rm(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/log-streams-completed.json"))
  await assert.rejects(
    runHarvesterDebugArchive(archiveWithoutPublishing({
      fixture,
      inspectArchive: async ({ directory }) => {
        const manifest = await readArchiveManifest(directory)
        const session = manifest.sessionInventory.find(({ sessionName }) => sessionName === "2026-11-24_testnet")
        assert.equal(session.completionStatus, "incomplete")
        assert.equal(session.loggerCompletionStatus, "incomplete")
        assert.ok(session.missingFieldWarnings.includes("LOGGER_COMPLETION_RECORD_MISSING"))
      },
    })),
    /incomplete|COLLECTION FAILED/i,
    "Process completion cannot substitute for proof that DEBUG and TRACE streams flushed",
  )
})
