import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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

function createMatchingTestnetFixtureFiles() {
  return {
    "logs/sessions/2026-11-20_old/terminal.log": "old session",
    "logs/sessions/2026-11-24_testnet/terminal.log": "selected TESTNET session evidence",
    "logs/sessions/2026-11-24_testnet/process-identity.json": JSON.stringify({
      formatVersion: 1,
      application: "harvester",
      environment: "testnet",
      startedAt: "2026-11-24T18:20:00.000Z",
      runtimeSessionId: RUNTIME_SESSION_ID,
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
  }
}

function createExcludedSessionFixtureFiles() {
  return {
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
    ...createExcludedSessionFixtureFiles(),
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

async function assertPublishedArchive({ directory, remote, expectedIdentityStatus } = {}) {
  assert.equal(remote, ARCHIVE_REMOTE, "Archive publication must target the configured private archive repository")
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  assert.deepEqual(manifest.includedDirectories, ["logs", "recovery-facts"], "Debug archives must contain only logs and recovery facts")
  assert.deepEqual(manifest.excludedPaths, [
    "data/** (all databases and backups)",
    "logs/cumulative/**",
  ], "Debug archives must declare databases and cumulative logs excluded")
  assert.equal(manifest.matchingTradingLogsAvailable, expectedIdentityStatus === "matched", "The archive must report whether a unique complete log session matches the recovery-facts runtime.")
  assert.equal(manifest.logRuntimeSessionId, expectedIdentityStatus === "matched" ? RUNTIME_SESSION_ID : null, "Only a unique exact runtime match may be labelled as the trading runtime's logs.")
  assert.equal(manifest.tradingRuntime.runtimeSessionId, manifest.recoveryRuntimeSessionId, "The trading-runtime inventory must be bound to the durable recovery-facts session identity.")
  if (expectedIdentityStatus === "matched") {
    assert.equal(manifest.tradingRuntime.processIdentity.processId, 24680, "The durable process-start fact must preserve the original process ID.")
    assert.equal(manifest.tradingRuntime.processIdentity.source.commit, "a".repeat(40), "The durable process-start fact must preserve the source revision.")
    assert.equal(manifest.tradingRuntime.processIdentity.source.workingTree, "clean", "The durable process-start fact must preserve worktree state.")
  } else {
    assert.equal(manifest.tradingRuntime.processIdentity, null, "A process identity from a different runtime must not be borrowed for the selected recovery runtime.")
  }
  assert.equal(
    manifest.runtimeIdentity.status,
    expectedIdentityStatus,
    "Archive manifest must explicitly state whether the log and recovery evidence share a runtime identity",
  )
  assert.equal(
    manifest.runtimeIdentity.correlation,
    expectedIdentityStatus === "matched"
      ? "same-runtime-session"
      : "independent-evidence-do-not-correlate",
    "Mismatched evidence must never be represented as one correlated runtime session",
  )
  assert.equal(manifest.recoveryRuntimeSessionId, expectedIdentityStatus === "matched" ? RUNTIME_SESSION_ID : OTHER_SESSION_ID)
  assert.equal(manifest.dataCommitHash, DATA_COMMIT_HASH, "Archive manifest must preserve the latest committed recovery checkpoint digest")
  assert.deepEqual(manifest.logSelection, {
    cumulative: "excluded",
    sessions: "all-identified-TESTNET-sessions-preserved-independently; exact-runtime-id-match-required; gzip-compressed",
    selectionReason: expectedIdentityStatus === "matched" ? "exact-runtime-id-match" : "no-exact-runtime-session",
  }, "Debug archive manifest must preserve TESTNET sessions independently and require an exact runtime identity match.")
  assert.equal(
    await readFile(path.join(directory, "data_commit_hash"), "utf8"),
    `${DATA_COMMIT_HASH}\n`,
    "Published checkpoint identity file must match the recovery-facts manifest",
  )
  assert.equal(
    gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-24_testnet/terminal.log.gz"))).toString("utf8"),
    "selected TESTNET session evidence",
    "Selected completed TESTNET log must be preserved in gzip form",
  )
  await assert.rejects(readdir(path.join(directory, "logs/sessions/2026-11-20_old")), { code: "ENOENT" }, "Older sessions must not be copied into the debug archive")
  await assert.rejects(readdir(path.join(directory, "logs/sessions/2026-11-25_live")), { code: "ENOENT" }, "LIVE session evidence must never enter a TESTNET debug archive")
  await assert.rejects(readdir(path.join(directory, "logs/cumulative")), { code: "ENOENT" }, "Cumulative logs must be excluded from the debug archive")
  await assert.rejects(readdir(path.join(directory, "data")), { code: "ENOENT" }, "Database and backup data must be excluded from the debug archive")
  return {
    commit: REMOTE_COMMIT,
    fileCount: manifest.files.length + 1,
  }
}

function archiveDependencies({ fixture, overrides = {}, expectedIdentityStatus = "matched" } = {}) {
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
    onArchiveCreatedFn: ({ directory }) => assertPublishedArchive({
      directory,
      remote: ARCHIVE_REMOTE,
      expectedIdentityStatus,
    }),
  }
}

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

test("preserves TESTNET session inventory and recovery facts without changing source evidence", async (t) => {
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

test("publishes mismatched log and recovery evidence as independent sources with an explicit warning", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  const filename = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(filename, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = OTHER_SESSION_ID
  const mismatchedFactsContent = jsonLines(facts)
  await writeFile(filename, mismatchedFactsContent, "utf8")
  const progressMessages = []
  const result = await runHarvesterDebugArchive({
    ...archiveDependencies({
      fixture,
      expectedIdentityStatus: "mismatched",
    }),
    onProgress: (message) => progressMessages.push(message),
  })
  assert.equal(result.archiveName, "2026-11-24T18-30-00Z_123e4567_debug", "Mismatched but valid evidence must still be collected")
  assert.ok(
    progressMessages.some((message) => message.includes("WARNING: matchingTradingLogsAvailable=false")),
    "The operator must be told explicitly that no matching trading-runtime logs are available.",
  )
  assert.equal(
    await readFile(filename, "utf8"),
    mismatchedFactsContent,
    "Publishing mismatched evidence must leave the original recovery-facts source unchanged",
  )
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

test("refuses to archive while a Harvester process lock exists", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  await writeFile(path.join(fixture.lockDirectory, ".harvester-trading-test.lock"), "active")
  await assert.rejects(runHarvesterDebugArchive(archiveDependencies({ fixture })), /process lock exists/i, "Archive must refuse to run while a Harvester process lock exists")
  await assert.rejects(readdir(path.join(fixture.packageDirectory, "archive-output")), { code: "ENOENT" }, "A rejected active-process preflight must not create archive output")
})

test("reclaims confirmed stale same-host locks before collecting the TESTNET debug archive", async (t) => {
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

  assert.equal(result.archiveName, "2026-11-24T18-30-00Z_123e4567_debug", "A confirmed stale lock must be reclaimed before collection.")
  for (const lockPath of lockPaths) {
    await assert.rejects(
      readFile(lockPath, "utf8"),
      { code: "ENOENT" },
      "Every confirmed stale lock namespace must be reclaimed before archive publication.",
    )
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

test("rejects LIVE mode before creating an archive", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true
  }))
  await assert.rejects(
    runHarvesterDebugArchive(archiveDependencies({
      fixture,
      overrides: {
        TRADING_MODE: "live",
      },
    })),
    /TRADING_MODE=testnet/,
    "Debug archive command must fail closed unless trading mode is explicitly TESTNET",
  )
  await assert.rejects(readdir(path.join(fixture.packageDirectory, "archive-output")), { code: "ENOENT" }, "LIVE mode rejection must happen before archive output is created")
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
        "selected TESTNET session evidence",
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

test("reports no matching trading logs and preserves a mismatched session independently", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const factsPath = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  facts.at(-1).runtimeSessionId = OTHER_SESSION_ID
  await writeFile(factsPath, jsonLines(facts), "utf8")

  const result = await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      assert.equal(manifest.matchingTradingLogsAvailable, false, "A different runtime ID must not be reported as trading-log coverage.")
      assert.equal(manifest.logRuntimeSessionId, null, "A mismatched session must never be assigned to the trading-facts runtime.")
      assert.equal(manifest.runtimeIdentity.status, "mismatched", "The manifest must classify retained unrelated logs as mismatched evidence.")
      assert.ok(
        manifest.warnings.some(({ code }) => code === "NO_MATCHING_TRADING_LOG_SESSION"),
        "The manifest must explicitly warn that the durable trading runtime has no matching log session.",
      )
      const independentSession = manifest.sessionInventory.find(({ runtimeSessionId }) => runtimeSessionId === RUNTIME_SESSION_ID)
      assert.equal(independentSession.selectionReason, "independent-evidence-no-runtime-match", "The mismatched runtime must remain independently identified.")
      await readFile(path.join(directory, "logs/sessions/2026-11-24_testnet/terminal.log.gz"))
    },
  }))
  assert.equal(result.matchingTradingLogsAvailable, false, "The command result must not imply log coverage when runtime identities differ.")
  assert.equal(result.unmatchedRuntimeSessionId, OTHER_SESSION_ID, "The command result must name the runtime whose matching logs are unavailable.")
})

test("marks multiple exact runtime candidates ambiguous instead of choosing the newest one", async (t) => {
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

  await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      assert.equal(manifest.matchingTradingLogsAvailable, false, "Multiple complete sessions for one runtime ID must not be silently reduced to one candidate.")
      assert.equal(manifest.logRuntimeSessionId, null, "An ambiguous runtime match must not expose a selected log runtime ID.")
      assert.equal(manifest.runtimeIdentity.status, "ambiguous", "The archive must distinguish ambiguous matching sessions from a missing session.")
      assert.equal(manifest.matchingSessionCandidates.length, 2, "Every exact runtime candidate must be named for manual forensic review.")
      assert.ok(
        await readFile(path.join(directory, "logs/sessions/2026-11-24_testnet/terminal.log.gz")),
        "The first candidate must remain archived as evidence.",
      )
      assert.ok(
        await readFile(path.join(directory, "logs/sessions/2026-11-25_duplicate-runtime/terminal.log.gz")),
        "The second candidate must remain archived as separate evidence.",
      )
    },
  }))
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

test("reports missing durable process identity, source revision, and session identity explicitly", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.packageDirectory, {
    recursive: true,
    force: true,
  }))
  const factsPath = path.join(fixture.packageDirectory, "recovery-facts/facts.jsonl")
  const facts = (await readFile(factsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  delete facts[0].data.processIdentity
  await writeFile(factsPath, jsonLines(facts), "utf8")
  const missingIdentityDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-26-missing-identity")
  await mkdir(missingIdentityDirectory, { recursive: true })
  await writeFile(path.join(missingIdentityDirectory, "terminal.log"), "unclassified source evidence", "utf8")
  const incompleteMetadataDirectory = path.join(fixture.packageDirectory, "logs/sessions/2026-11-26-incomplete-metadata")
  await mkdir(incompleteMetadataDirectory, { recursive: true })
  await writeFile(path.join(incompleteMetadataDirectory, "process-identity.json"), JSON.stringify({
    application: "harvester",
    formatVersion: 1,
    environment: "testnet",
    runtimeSessionId: "123e4567-e89b-12d3-a456-426614174000",
    source: {
      commit: null,
      workingTree: "unknown",
    },
  }), "utf8")
  await writeFile(path.join(incompleteMetadataDirectory, "terminal.log"), "incomplete metadata source evidence", "utf8")

  await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      assert.equal(manifest.tradingRuntime.processIdentity, null, "Missing process identity must remain null rather than being inferred from the archive command.")
      assert.ok(
        manifest.warnings.some(({ code }) => code === "TRADING_RUNTIME_PROCESS_IDENTITY_MISSING"),
        "The missing durable process identity must be an explicit manifest warning.",
      )
      assert.ok(
        manifest.warnings.some(({ code }) => code === "TRADING_RUNTIME_SOURCE_REVISION_MISSING"),
        "The unavailable trading-runtime source revision must be an explicit manifest warning.",
      )
      const unknownSession = manifest.sessionInventory.find(({ sessionName }) => sessionName === "2026-11-26-missing-identity")
      assert.equal(unknownSession.completionStatus, "identity-missing", "A session without process identity must be inventoried as unclassified.")
      assert.ok(
        unknownSession.missingFieldWarnings.includes("PROCESS_IDENTITY_MISSING"),
        "A session without identity must carry a specific missing-field warning.",
      )
      const incompleteMetadataSession = manifest.sessionInventory.find(({ sessionName }) => sessionName === "2026-11-26-incomplete-metadata")
      assert.equal(incompleteMetadataSession.completionStatus, "incomplete")
      for (const warning of ["PROCESS_ID_MISSING", "START_TIMESTAMP_MISSING", "SOURCE_REVISION_MISSING", "COMPLETION_RECORD_MISSING"]) {
        assert.ok(incompleteMetadataSession.missingFieldWarnings.includes(warning), `Missing session metadata must report ${warning}.`)
      }
    },
  }))
})

test("preserves incomplete failed-startup logs but does not count them as matching trading logs", async (t) => {
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
  const truncatedTerminal = "ERROR startup failed before the final diagnostic was written"
  await writeFile(path.join(fixture.packageDirectory, "logs/sessions/2026-11-24_testnet/terminal.log"), truncatedTerminal, "utf8")

  await runHarvesterDebugArchive(archiveWithoutPublishing({
    fixture,
    inspectArchive: async ({ directory }) => {
      const manifest = await readArchiveManifest(directory)
      assert.equal(manifest.matchingTradingLogsAvailable, false, "A session with incomplete log streams cannot prove matching trading-log coverage.")
      const incompleteSession = manifest.sessionInventory.find(({ sessionName }) => sessionName === "2026-11-24_testnet")
      assert.equal(incompleteSession.completionStatus, "incomplete", "The session inventory must expose incomplete stream capture.")
      assert.equal(incompleteSession.processOutcome.status, "failed", "The process exit failure must remain distinct from log-stream completeness.")
      assert.ok(
        incompleteSession.missingFieldWarnings.includes("LOG_STREAMS_INCOMPLETE"),
        "Incomplete terminal capture must be an explicit session warning.",
      )
      assert.equal(
        gunzipSync(await readFile(path.join(directory, "logs/sessions/2026-11-24_testnet/terminal.log.gz"))).toString("utf8"),
        truncatedTerminal,
        "Incomplete source bytes must be preserved unchanged for forensic review.",
      )
    },
  }))
})
