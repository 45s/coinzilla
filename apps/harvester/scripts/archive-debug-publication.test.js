import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { publishArchive } from "./archive-debug-session.js"
import { runHarvesterDebugArchivePublication } from "./archive-debug-publication.js"

const execFileAsync = promisify(execFile)
const ARCHIVE_NAME = "2026-11-28T12-00-00Z_123e4567_debug"
const REMOTE = "https://github.com/45s/coinzilla-archive.git"

async function createArchiveFixture({ root, archiveName = ARCHIVE_NAME } = {}) {
  const archiveDirectory = path.join(root, "archive-output", archiveName)
  const sessionDirectory = path.join(archiveDirectory, "logs", "sessions", "fixture")
  await mkdir(sessionDirectory, { recursive: true })
  await mkdir(path.join(archiveDirectory, "recovery-facts"), { recursive: true })
  const runtimeId = "ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c"
  const sourceFiles = [
    { sourcePath: "logs/sessions/fixture/harvester.log", archivePath: "logs/sessions/fixture/harvester.log.gz", content: "debug stream evidence\n" },
    { sourcePath: "logs/sessions/fixture/trace.log", archivePath: "logs/sessions/fixture/trace.log.gz", content: "trace stream evidence\n" },
    { sourcePath: "logs/sessions/fixture/terminal.log", archivePath: "logs/sessions/fixture/terminal.log.gz", content: "terminal session evidence\n" },
  ]
  const files = []
  for (const item of sourceFiles) {
    await writeFile(path.join(archiveDirectory, item.archivePath), item.content)
    files.push({
      path: item.archivePath,
      size: Buffer.byteLength(item.content),
      sha256: createHash("sha256").update(item.content).digest("hex"),
    })
  }
  const streamEvidence = (item) => ({
    sourcePath: item.sourcePath,
    archivePath: item.archivePath,
    actualRuntimeId: runtimeId,
    sourceSize: Buffer.byteLength(item.content),
    archiveSize: Buffer.byteLength(item.content),
    sourceSha256: createHash("sha256").update(item.content).digest("hex"),
    archiveSha256: createHash("sha256").update(item.content).digest("hex"),
    compression: "source-gzip-preserved",
    rotationIndex: 0,
    result: "collected",
    reason: null,
  })
  const manifest = {
    formatVersion: 2,
    application: "harvester",
    commandTradingMode: "testnet",
    createdAt: "2026-11-28T12:00:00.000Z",
    includedDirectories: ["logs", "recovery-facts"],
    excludedPaths: ["data/** (all databases and backups)", "logs/cumulative/**"],
    recoveryRuntimeSessionId: runtimeId,
    logRuntimeSessionId: runtimeId,
    matchingTradingLogsAvailable: true,
    runtimeIdentity: { status: "matched", correlation: "same-runtime-session" },
    tradingRuntime: { runtimeSessionId: runtimeId, processIdentity: { runtimeSessionId: runtimeId } },
    sessionInventory: [{ runtimeSessionId: runtimeId, completionStatus: "complete" }],
    evidenceIntegrity: {
      status: "matched",
      validForPublication: true,
      expectedRuntimeId: runtimeId,
      recoveryProcessIdentityStatus: "matched",
      streams: {
        harvesterLog: { status: "matched", expectedRuntimeId: runtimeId, actualRuntimeIds: [runtimeId], fileCount: 1, totalBytes: Buffer.byteLength(sourceFiles[0].content), files: [streamEvidence(sourceFiles[0])] },
        traceLog: { status: "matched", expectedRuntimeId: runtimeId, actualRuntimeIds: [runtimeId], fileCount: 1, totalBytes: Buffer.byteLength(sourceFiles[1].content), files: [streamEvidence(sourceFiles[1])] },
      },
      mismatches: [],
    },
    files,
  }
  await writeFile(path.join(archiveDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
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

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-archive-publication-"))
  t.after(() => rm(root, {
    recursive: true,
    force: true,
  }))
  const archiveDirectory = await createArchiveFixture({ root })
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
  const fixture = await createFixture(t)
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

test("publication command publishes to a temporary Git remote while a process lock exists", async (t) => {
  const fixture = await createFixture(t)
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
  const fixture = await createFixture(t)
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
  const fixture = await createFixture(t)
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
  const fixture = await createFixture(t)
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
  const fixture = await createFixture(t)
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
  const fixture = await createFixture(t)
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
  const fixture = await createFixture(t)
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
      harvesterLog: { status: "mismatched", fileCount: 2 },
      traceLog: { status: "mismatched", fileCount: 2 },
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
        return { commit: "f".repeat(40), fileCount: 1 }
      },
    }),
    /mismatched|integrity|runtime/i,
    "The publisher must reject a runtime mismatch even when file hashes and inventory are valid",
  )
  assert.equal(publisherCalled, false, "Invalid evidence must be rejected before any Git publication operation")
})
