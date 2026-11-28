import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { gzipSync, gunzipSync } from "node:zlib"
import { publishArchive } from "./archive-debug-session.js"
import { runHarvesterDebugArchivePublication } from "./archive-debug-publication.js"

const execFileAsync = promisify(execFile)
const ARCHIVE_NAME = "2026-11-28T12-00-00Z_123e4567_debug"
const REMOTE = "https://github.com/45s/coinzilla-archive.git"

function createActiveSnapshotLockFiles(startedAt) {
  const fingerprint = "a".repeat(64)
  return [
    {
      name: `.harvester-trading-${fingerprint}.lock`,
      namespace: "application",
      fingerprint,
      startedAt,
    },
    {
      name: `.binance-harvester-trading-${fingerprint}.lock`,
      namespace: "host",
      broker: "binance",
      fingerprint,
      startedAt,
    },
  ]
}

function createSourceFileEntries() {
  return [
    {
      sourcePath: "logs/sessions/fixture/harvester.log",
      archivePath: "logs/sessions/fixture/harvester.log.gz",
      content: "debug stream evidence\n",
    },
    {
      sourcePath: "logs/sessions/fixture/trace.log",
      archivePath: "logs/sessions/fixture/trace.log.gz",
      content: "trace stream evidence\n",
    },
    {
      sourcePath: "logs/sessions/fixture/terminal.log",
      archivePath: "logs/sessions/fixture/terminal.log.gz",
      content: "terminal session evidence\n",
    },
  ]
}

function createLifecycleSourceFileEntries({ runtimeId, runtimeTradingMode = "testnet" } = {}) {
  return [
    {
      sourcePath: "logs/sessions/fixture/process-identity.json",
      archivePath: "logs/sessions/fixture/process-identity.json.gz",
      content: `${JSON.stringify({
        formatVersion: 1,
        application: "harvester",
        environment: runtimeTradingMode,
        runtimeSessionId: runtimeId,
        startedAt: "2026-11-28T11:00:00.000Z",
        processId: 24680,
      })}\n`,
    },
    {
      sourcePath: "logs/sessions/fixture/process-completed.json",
      archivePath: "logs/sessions/fixture/process-completed.json.gz",
      content: `${JSON.stringify({
        formatVersion: 1,
        application: "harvester",
        runtimeSessionId: runtimeId,
        startedAt: "2026-11-28T11:00:00.000Z",
        endedAt: "2026-11-28T11:10:00.000Z",
        processId: 24680,
        exitCode: 0,
        signal: null,
        loggerStreamsComplete: true,
        terminalCaptureComplete: true,
        logStreamsComplete: true,
      })}\n`,
    },
    {
      sourcePath: "logs/sessions/fixture/log-streams-completed.json",
      archivePath: "logs/sessions/fixture/log-streams-completed.json.gz",
      content: `${JSON.stringify({
        formatVersion: 1,
        application: "harvester",
        runtimeSessionId: runtimeId,
        endedAt: "2026-11-28T11:10:00.000Z",
        logStreamsComplete: true,
        streams: {
          harvesterLog: true,
          traceLog: true,
        },
      })}\n`,
    },
  ]
}

function createRecoveryFixture(runtimeId) {
  const processIdentity = {
    application: "harvester",
    version: "1.0.001",
    runtimeSessionId: runtimeId,
    processId: 24680,
    startedAt: "2026-11-28T11:00:00.000Z",
    source: {
      branch: "develop",
      commit: "a".repeat(40),
      workingTree: "clean",
    },
  }
  const recoveryDigest = "a".repeat(64)
  const facts = [
    JSON.stringify({
      sequence: "0",
      digest: "0".repeat(64),
      factType: "PROCESS_STARTED",
      runtimeSessionId: runtimeId,
      data: { processIdentity },
    }),
    JSON.stringify({
      sequence: "1",
      digest: recoveryDigest,
      runtimeSessionId: runtimeId,
      factType: "CHECKPOINT",
    }),
  ]
  const checkpoints = [
    JSON.stringify({
      sequence: "0",
      recordCount: "1",
      lastCommittedDigest: "0".repeat(64),
    }),
    JSON.stringify({
      sequence: "1",
      recordCount: "2",
      lastCommittedDigest: recoveryDigest,
    }),
  ]
  return {
    processIdentity,
    recoveryDigest,
    files: [
      {
        path: "recovery-facts/facts.jsonl",
        content: `${facts.join("\n")}\n`,
      },
      {
        path: "recovery-facts/manifest.jsonl",
        content: `${checkpoints.join("\n")}\n`,
      },
      {
        path: "data_commit_hash",
        content: `${recoveryDigest}\n`,
      },
    ],
  }
}

function createStreamEvidence({ item, runtimeId } = {}) {
  const sourceBytes = Buffer.from(item.content)
  const archiveBytes = gzipSync(sourceBytes)
  const sourceSize = sourceBytes.length
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex")
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex")
  return {
    sourcePath: item.sourcePath,
    archivePath: item.archivePath,
    actualRuntimeId: runtimeId,
    sourceSize,
    archiveSize: archiveBytes.length,
    sourceSha256,
    archiveSha256,
    compression: "source-gzip-preserved",
    rotationIndex: 0,
    result: "collected",
    reason: null,
  }
}

async function appendFixtureFile({
  archiveDirectory,
  files,
  relativePath,
  sourcePath = relativePath,
  content,
} = {}) {
  const sourceBytes = Buffer.from(content)
  const archiveBytes = relativePath.endsWith(".gz") ? gzipSync(sourceBytes) : sourceBytes
  await writeFile(path.join(archiveDirectory, relativePath), archiveBytes)
  files.push({
    path: relativePath,
    sourcePath,
    size: archiveBytes.length,
    sha256: createHash("sha256").update(archiveBytes).digest("hex"),
  })
}

function createSessionInventoryFixture({ runtimeId, runtimeTradingMode = "testnet" } = {}) {
  return [{
    sessionName: "fixture",
    relativePath: "logs/sessions/fixture",
    processIdentityPath: "logs/sessions/fixture/process-identity.json",
    processCompletionPath: "logs/sessions/fixture/process-completed.json",
    loggerCompletionPath: "logs/sessions/fixture/log-streams-completed.json",
    runtimeSessionId: runtimeId,
    environment: runtimeTradingMode,
    completionStatus: "complete",
    loggerCompletionStatus: "complete",
    startedAt: "2026-11-28T11:00:00.000Z",
    endedAt: "2026-11-28T11:10:00.000Z",
    processId: 24680,
    logStreamsComplete: true,
    loggerStreamsComplete: true,
  }]
}

function createEvidenceIntegrityFixture({ runtimeId, sourceFiles } = {}) {
  return {
    status: "matched",
    validForPublication: true,
    expectedRuntimeId: runtimeId,
    recoveryProcessIdentityStatus: "matched",
    streams: {
      harvesterLog: {
        status: "matched",
        expectedRuntimeId: runtimeId,
        actualRuntimeIds: [runtimeId],
        fileCount: 1,
        totalBytes: Buffer.byteLength(sourceFiles[0].content),
        files: [createStreamEvidence({
          item: sourceFiles[0],
          runtimeId,
        })],
      },
      traceLog: {
        status: "matched",
        expectedRuntimeId: runtimeId,
        actualRuntimeIds: [runtimeId],
        fileCount: 1,
        totalBytes: Buffer.byteLength(sourceFiles[1].content),
        files: [createStreamEvidence({
          item: sourceFiles[1],
          runtimeId,
        })],
      },
    },
    mismatches: [],
  }
}

function createArchiveManifest({ runtimeId, recovery, sourceFiles, files, runtimeTradingMode = "testnet" } = {}) {
  return {
    formatVersion: 2,
    application: "harvester",
    runtimeTradingMode,
    createdAt: "2026-11-28T12:00:00.000Z",
    includedDirectories: ["logs", "recovery-facts"],
    excludedPaths: ["data/** (all databases and backups)", "logs/cumulative/**"],
    recoveryRuntimeSessionId: runtimeId,
    logRuntimeSessionId: runtimeId,
    matchingTradingLogsAvailable: true,
    runtimeIdentity: {
      status: "matched",
      correlation: "same-runtime-session",
    },
    dataCommitHash: recovery.recoveryDigest,
    tradingRuntime: {
      runtimeSessionId: runtimeId,
      processIdentity: recovery.processIdentity,
    },
    sessionInventory: createSessionInventoryFixture({
      runtimeId,
      runtimeTradingMode,
    }),
    evidenceIntegrity: createEvidenceIntegrityFixture({
      runtimeId,
      sourceFiles,
    }),
    files,
  }
}

async function createArchiveFixture({ root, archiveName = ARCHIVE_NAME, runtimeTradingMode = "testnet" } = {}) {
  const archiveDirectory = path.join(root, "archive-output", archiveName)
  await mkdir(path.join(archiveDirectory, "logs", "sessions", "fixture"), { recursive: true })
  await mkdir(path.join(archiveDirectory, "recovery-facts"), { recursive: true })
  const runtimeId = "ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c"
  const sourceFiles = [...createSourceFileEntries(), ...createLifecycleSourceFileEntries({
    runtimeId,
    runtimeTradingMode,
  })]
  const recovery = createRecoveryFixture(runtimeId)
  const files = []
  for (const item of sourceFiles) {
    await appendFixtureFile({
      archiveDirectory,
      files,
      relativePath: item.archivePath,
      sourcePath: item.sourcePath,
      content: item.content,
    })
  }
  for (const item of recovery.files) {
    await appendFixtureFile({
      archiveDirectory,
      files,
      relativePath: item.path,
      content: item.content,
    })
  }
  const manifest = createArchiveManifest({
    runtimeId,
    recovery,
    sourceFiles,
    files,
    runtimeTradingMode,
  })
  await writeFile(path.join(archiveDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return archiveDirectory
}

async function snapshotDirectory(directory) {
  const files = new Map()
  async function visit({ current, relative = "" } = {}) {
    for (const name of await readdir(current)) {
      const child = relative ? path.join(relative, name) : name
      const filename = path.join(current, name)
      const stats = await lstat(filename)
      assert.equal(stats.isSymbolicLink(), false, "Archive fixture must not contain symlinks")
      if (stats.isDirectory()) {
        await visit({
          current: filename,
          relative: child,
        })
      } else {
        files.set(child, await readFile(filename))
      }
    }
  }
  await visit({
    current: directory,
  })
  return files
}

async function createFixture({ t, runtimeTradingMode = "testnet" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-archive-publication-"))
  t.after(() => rm(root, {
    recursive: true,
    force: true,
  }))
  const archiveDirectory = await createArchiveFixture({
    root,
    runtimeTradingMode,
  })
  const lockDirectory = path.join(root, "process-locks")
  await mkdir(lockDirectory)
  const lockPath = path.join(lockDirectory, ".binance-harvester-trading-test.lock")
  await writeFile(lockPath, "active trading process lock")
  return {
    root,
    archiveDirectory,
    lockPath,
  }
}

async function runGit(...parameters) {
  const [args, options = {}] = parameters
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
  })
  return stdout.trim()
}

async function createTemporaryArchiveRemote({ root } = {}) {
  const bareRemote = path.join(root, "archive-remote.git")
  const seedRepository = path.join(root, "seed")
  await mkdir(seedRepository)
  await execFileAsync("git", ["init", "--bare", "--initial-branch=main", bareRemote])
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: seedRepository,
  })
  await execFileAsync("git", ["config", "user.name", "Archive Test"], {
    cwd: seedRepository,
  })
  await execFileAsync("git", ["config", "user.email", "archive-test@example.invalid"], {
    cwd: seedRepository,
  })
  await writeFile(path.join(seedRepository, "README.md"), "temporary archive repository\n")
  await execFileAsync("git", ["add", "README.md"], {
    cwd: seedRepository,
  })
  await execFileAsync("git", ["commit", "-m", "initialize archive repository"], {
    cwd: seedRepository,
  })
  await execFileAsync("git", ["remote", "add", "origin", bareRemote], {
    cwd: seedRepository,
  })
  await execFileAsync("git", ["push", "-u", "origin", "main"], {
    cwd: seedRepository,
  })
  return bareRemote
}

test("publishes with an active process lock, retries interrupted push, and is idempotent", async (t) => {
  const fixture = await createFixture({ t })
  const bareRemote = await createTemporaryArchiveRemote({
    root: fixture.root,
  })
  const sourceBefore = await snapshotDirectory(fixture.archiveDirectory)
  let interrupted = false
  const failFirstPush = async (...parameters) => {
    const [args, options = {}] = parameters
    if (args[0] === "push" && !interrupted) {
      interrupted = true
      await runGit(args, options)
      throw new Error("simulated connection loss after remote accepted push")
    }
    return runGit(args, options)
  }
  await assert.rejects(
    publishArchive({
      directory: fixture.archiveDirectory,
      archiveName: ARCHIVE_NAME,
      remote: bareRemote,
      runGit: failFirstPush,
    }),
    /simulated connection loss after remote accepted push/,
    "An interrupted push must fail without modifying the source archive",
  )
  const retry = await publishArchive({
    directory: fixture.archiveDirectory,
    archiveName: ARCHIVE_NAME,
    remote: bareRemote,
  })
  assert.equal(retry.alreadyPublished, true, "Retry must verify the commit accepted before the connection was interrupted")
  assert.match(retry.commit, /^[a-f0-9]{40}$/, "Retry must return the published commit SHA")
  const repeated = await publishArchive({
    directory: fixture.archiveDirectory,
    archiveName: ARCHIVE_NAME,
    remote: bareRemote,
  })
  assert.equal(repeated.alreadyPublished, true, "Repeated publication must verify the existing archive")
  assert.equal(repeated.commit, retry.commit, "Idempotent publication must return the same commit")
  assert.deepEqual(await snapshotDirectory(fixture.archiveDirectory), sourceBefore, "Publication must not modify source archive files")
  assert.equal(await readFile(fixture.lockPath, "utf8"), "active trading process lock", "Publication must not modify the active process lock")
})

test("publication command accepts a completed LIVE runtime archive", async (t) => {
  const fixture = await createFixture({
    t,
    runtimeTradingMode: "live",
  })
  const bareRemote = await createTemporaryArchiveRemote({ root: fixture.root })
  const runGitWithLocalRemote = async (...parameters) => {
    const [args, options = {}] = parameters
    const mappedArgs = [...args]
    const remoteIndex = mappedArgs.indexOf(REMOTE)
    if (remoteIndex >= 0) {
      mappedArgs[remoteIndex] = bareRemote
    }
    return runGit(mappedArgs, options)
  }
  const result = await runHarvesterDebugArchivePublication({
    args: ["--archive", fixture.archiveDirectory],
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    runGit: runGitWithLocalRemote,
  })
  assert.match(result.remoteCommit, /^[a-f0-9]{40}$/)
  assert.equal(result.archiveName, ARCHIVE_NAME)
})

test("publication command publishes to a temporary Git remote while a process lock exists", async (t) => {
  const fixture = await createFixture({ t })
  const bareRemote = await createTemporaryArchiveRemote({
    root: fixture.root,
  })
  const sourceBefore = await snapshotDirectory(fixture.archiveDirectory)
  const runGitWithLocalRemote = async (...parameters) => {
    const [args, options = {}] = parameters
    const mappedArgs = [...args]
    const remoteIndex = mappedArgs.indexOf(REMOTE)
    if (remoteIndex >= 0) {
      mappedArgs[remoteIndex] = bareRemote
    }
    return runGit(mappedArgs, options)
  }
  const result = await runHarvesterDebugArchivePublication({
    args: ["--archive", fixture.archiveDirectory],
    env: {
      HARVESTER_ARCHIVE_REMOTE: REMOTE,
    },
    runGit: runGitWithLocalRemote,
  })
  assert.match(result.remoteCommit, /^[a-f0-9]{40}$/, "The command must return its verified remote commit")
  assert.equal(result.archiveName, ARCHIVE_NAME, "The command must preserve the archive naming convention")
  assert.equal(result.alreadyPublished, false, "The first publication must create the remote archive")
  assert.deepEqual(await snapshotDirectory(fixture.archiveDirectory), sourceBefore, "The command must leave source archive files unchanged")
  assert.equal(
    await readFile(fixture.lockPath, "utf8"),
    "active trading process lock",
    "The command must leave the active Harvester process lock untouched",
  )
})

test("publication leaves source archive bytes unchanged", async (t) => {
  const fixture = await createFixture({ t })
  const before = await snapshotDirectory(fixture.archiveDirectory)
  await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: {
      HARVESTER_ARCHIVE_REMOTE: REMOTE,
    },
    publishArchiveFn: async ({ directory }) => {
      assert.notEqual(directory, fixture.archiveDirectory, "Publication must operate on its own immutable snapshot copy.")
      assert.equal(path.basename(directory), ARCHIVE_NAME, "The publication snapshot must preserve the archive name.")
      assert.deepEqual(await snapshotDirectory(directory), before, "The publication snapshot must match the completed source archive.")
      return {
        commit: "b".repeat(40),
        fileCount: 2,
      }
    },
  })
  assert.deepEqual(await snapshotDirectory(fixture.archiveDirectory), before, "Publication must not modify any source archive file")
})

test("rejects checksum mismatches before calling the publisher", async (t) => {
  const fixture = await createFixture({ t })
  await writeFile(path.join(fixture.archiveDirectory, "logs/sessions/fixture/terminal.log.gz"), "tampered")
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: {
        HARVESTER_ARCHIVE_REMOTE: REMOTE,
      },
      publishArchiveFn: async () => assert.fail("Invalid archive must never reach publication"),
    }),
    /checksum|size|inventory/i,
    "Checksum mismatch must be rejected before remote publication",
  )
})

test("rejects unsafe manifest paths before calling the publisher", async (t) => {
  const fixture = await createFixture({ t })
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.files[0].path = "../outside.txt"
  await writeFile(manifestPath, JSON.stringify(manifest))
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: {
        HARVESTER_ARCHIVE_REMOTE: REMOTE,
      },
      publishArchiveFn: async () => assert.fail("Unsafe manifest must never reach publication"),
    }),
    /manifest|path|inventory/i,
    "Unsafe manifest paths must be rejected",
  )
})

test("selects the latest completed archive without reading live process state", async (t) => {
  const fixture = await createFixture({ t })
  const latestName = "2026-11-28T13-00-00Z_223e4567_debug"
  await createArchiveFixture({
    root: fixture.root,
    archiveName: latestName,
  })
  const result = await runHarvesterDebugArchivePublication({
    packageDirectory: fixture.root,
    env: {
      HARVESTER_ARCHIVE_REMOTE: REMOTE,
    },
    publishArchiveFn: async ({ archiveName }) => ({
      commit: "c".repeat(40),
      fileCount: 2,
      archiveName,
    }),
  })
  assert.equal(result.archiveName, latestName, "Default selection must choose the latest valid completed archive")
})

test("publisher can run without a trading mode and never invokes trading dependencies", async (t) => {
  const fixture = await createFixture({ t })
  let publisherCalled = false
  await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: {
      HARVESTER_ARCHIVE_REMOTE: REMOTE,
    },
    publishArchiveFn: async () => {
      publisherCalled = true
      return {
        commit: "e".repeat(40),
        fileCount: 2,
      }
    },
  })
  assert.equal(publisherCalled, true, "Publication must work without TRADING_MODE or a running trading process")
})


test("rejects a mismatched runtime evidence manifest before invoking the publisher", async (t) => {
  const fixture = await createFixture({ t })
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.runtimeIdentity = {
    status: "mismatched",
    correlation: "independent-evidence-do-not-correlate",
  }
  manifest.matchingTradingLogsAvailable = false
  manifest.recoveryRuntimeSessionId = "4b827393-0738-4de0-a2a8-a3942e7b7bec"
  manifest.logRuntimeSessionId = null
  manifest.evidenceIntegrity = {
    status: "mismatched",
    validForPublication: false,
    expectedRuntimeId: "4b827393-0738-4de0-a2a8-a3942e7b7bec",
    streams: {
      harvesterLog: {
        status: "mismatched",
        fileCount: 2,
      },
      traceLog: {
        status: "mismatched",
        fileCount: 2,
      },
    },
    mismatches: [{
      expectedRuntimeId: "4b827393-0738-4de0-a2a8-a3942e7b7bec",
      actualRuntimeId: "9da4dfdf-d8d5-4087-b5cb-502e7606af44",
      sourcePath: "logs/sessions/other-runtime",
    }],
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  let publisherCalled = false
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
      publishArchiveFn: async () => {
        publisherCalled = true
        return {
          commit: "f".repeat(40),
          fileCount: 1,
        }
      },
    }),
    /mismatched|integrity|runtime/i,
    "The publisher must reject a runtime mismatch even when file hashes and inventory are valid",
  )
  assert.equal(publisherCalled, false, "Invalid evidence must be rejected before any Git publication operation")
})

 
test("rejects an archive with a missing required stream before invoking the publisher", async (t) => {
  const fixture = await createFixture({ t })
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.evidenceIntegrity.streams.traceLog.status = "missing"
  manifest.evidenceIntegrity.streams.traceLog.fileCount = 0
  manifest.evidenceIntegrity.streams.traceLog.totalBytes = 0
  manifest.evidenceIntegrity.streams.traceLog.files = []
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  let publisherCalled = false
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
      publishArchiveFn: async () => {
        publisherCalled = true
        return {
          commit: "f".repeat(40),
          fileCount: 1,
        }
      },
    }),
    /TRACE LOG evidence is not complete/i,
    "The publisher must independently reject missing TRACE evidence",
  )
  assert.equal(publisherCalled, false, "Missing streams must be rejected before Git publication")
})
test("rejects a completed archive when session PID disagrees with the committed recovery process identity", async (t) => {
  const fixture = await createFixture({ t })
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const session = manifest.sessionInventory.find(({ runtimeSessionId }) => runtimeSessionId === manifest.recoveryRuntimeSessionId)
  const identityEntry = manifest.files.find(({ sourcePath }) => sourcePath === session.processIdentityPath)
  const identityPath = path.join(fixture.archiveDirectory, identityEntry.path)
  const identity = JSON.parse(gunzipSync(await readFile(identityPath)).toString("utf8"))
  identity.processId = 99999
  const changedIdentity = gzipSync(Buffer.from(JSON.stringify(identity)))
  await writeFile(identityPath, changedIdentity)
  identityEntry.size = changedIdentity.length
  identityEntry.sha256 = createHash("sha256").update(changedIdentity).digest("hex")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  let publisherCalled = false
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
      publishArchiveFn: async () => {
        publisherCalled = true
        return {
          commit: "f".repeat(40),
          fileCount: 1,
        }
      },
    }),
    /process ID|process identity|PID/i,
    "The publisher must compare the archived session identity PID with the committed PROCESS_STARTED PID.",
  )
  assert.equal(publisherCalled, false, "A PID-mismatched archive must be rejected before publication.")
})


test("publishes a verified active-process snapshot without requiring completion records", async (t) => {
  const fixture = await createFixture({ t })
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const [session] = manifest.sessionInventory
  session.completionStatus = "active"
  session.loggerCompletionStatus = "active"
  session.activeSnapshotPath = "logs/sessions/fixture/active-process-snapshot.json"
  session.logStreamsComplete = false
  session.loggerStreamsComplete = false

  const completionPaths = [
    "logs/sessions/fixture/process-completed.json.gz",
    "logs/sessions/fixture/log-streams-completed.json.gz",
  ]
  for (const relativePath of completionPaths) {
    await rm(path.join(fixture.archiveDirectory, relativePath))
    manifest.files = manifest.files.filter((entry) => entry.path !== relativePath)
  }

  const marker = {
    formatVersion: 1,
    snapshotType: "active-harvester-process",
    runtimeSessionId: manifest.recoveryRuntimeSessionId,
    processId: session.processId,
    hostname: os.hostname(),
    lockStartedAt: session.startedAt,
    lockFiles: createActiveSnapshotLockFiles(session.startedAt),
    processStartedAt: session.startedAt,
    recoveryDataCommitHash: manifest.dataCommitHash,
    capturedAt: new Date().toISOString(),
    streams: {
      harvesterLog: true,
      traceLog: true,
    },
  }
  const markerPath = path.join(fixture.archiveDirectory, session.activeSnapshotPath)
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`)
  const markerBytes = await readFile(markerPath)
  manifest.files.push({
    path: session.activeSnapshotPath,
    size: markerBytes.length,
    sha256: createHash("sha256").update(markerBytes).digest("hex"),
  })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  let publisherCalled = false
  const result = await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    publishArchiveFn: async () => {
      publisherCalled = true
      return {
        commit: "e".repeat(40),
        fileCount: manifest.files.length,
      }
    },
  })
  assert.equal(publisherCalled, true, "A verified active-process snapshot must be eligible for publication.")
  assert.equal(result.archiveName, ARCHIVE_NAME, "The publisher must retain the original immutable archive identity.")
})

 
test("publishes a verified active-runtime snapshot without process-completion files", async (t) => {
  const fixture = await createFixture({ t })
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const [session] = manifest.sessionInventory
  const completionArchivePaths = [
    "logs/sessions/fixture/process-completed.json.gz",
    "logs/sessions/fixture/log-streams-completed.json.gz",
  ]
  for (const archivePath of completionArchivePaths) {
    await rm(path.join(fixture.archiveDirectory, archivePath))
  }
  manifest.files = manifest.files.filter((entry) => !completionArchivePaths.includes(entry.path))
  const activeSnapshotPath = "logs/sessions/fixture/active-process-snapshot.json"
  const marker = {
    formatVersion: 1,
    snapshotType: "active-harvester-process",
    runtimeSessionId: manifest.recoveryRuntimeSessionId,
    processId: 24680,
    hostname: "test-host",
    lockStartedAt: "2026-11-28T11:00:01.000Z",
    lockFiles: createActiveSnapshotLockFiles("2026-11-28T11:00:01.000Z"),
    processStartedAt: "2026-11-28T11:00:00.000Z",
    capturedAt: "2026-11-28T11:05:00.000Z",
    recoveryDataCommitHash: manifest.dataCommitHash,
    streams: {
      harvesterLog: true,
      traceLog: true,
    },
  }
  const markerContent = `${JSON.stringify(marker, null, 2)}\n`
  await writeFile(path.join(fixture.archiveDirectory, activeSnapshotPath), markerContent)
  manifest.files.push({
    path: activeSnapshotPath,
    size: Buffer.byteLength(markerContent),
    sha256: createHash("sha256").update(markerContent).digest("hex"),
  })
  session.completionStatus = "active"
  session.loggerCompletionStatus = "active"
  session.activeSnapshotPath = activeSnapshotPath
  session.logStreamsComplete = false
  session.loggerStreamsComplete = false
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  let publisherCalled = false
  const result = await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    publishArchiveFn: async () => {
      publisherCalled = true
      return {
        commit: "f".repeat(40),
        fileCount: manifest.files.length,
      }
    },
  })
  assert.equal(publisherCalled, true, "A verified immutable active snapshot must be publishable while the process remains active.")
  assert.equal(result.remoteCommit, "f".repeat(40))
})
