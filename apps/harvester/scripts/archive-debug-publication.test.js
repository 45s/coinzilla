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
  await mkdir(path.join(archiveDirectory, "logs", "sessions", "fixture"), {
    recursive: true,
  })
  const content = "immutable completed session evidence\n"
  await writeFile(path.join(archiveDirectory, "logs", "sessions", "fixture", "terminal.log.gz"), content)
  const files = [{
    path: "logs/sessions/fixture/terminal.log.gz",
    size: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  }]
  const manifest = {
    formatVersion: 1,
    application: "harvester",
    commandTradingMode: "testnet",
    createdAt: "2026-11-28T12:00:00.000Z",
    includedDirectories: ["logs", "recovery-facts"],
    excludedPaths: ["data/** (all databases and backups)", "logs/cumulative/**"],
    files,
  }
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
      throw new Error("simulated connection loss during push")
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
    /simulated connection loss/,
    "An interrupted push must fail without modifying the source archive",
  )
  const retry = await publishArchive({
    directory: fixture.archiveDirectory,
    archiveName: ARCHIVE_NAME,
    remote: bareRemote,
  })
  assert.equal(retry.alreadyPublished, false, "Retry must create the archive commit")
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

test("publication command accepts a completed archive while a process lock exists", async (t) => {
  const fixture = await createFixture(t)
  const result = await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: {
      HARVESTER_ARCHIVE_REMOTE: REMOTE,
    },
    publishArchiveFn: async ({ archiveName, directory, remote }) => {
      assert.equal(archiveName, ARCHIVE_NAME, "Publication must preserve the archive directory name")
      assert.equal(directory, fixture.archiveDirectory, "Publication must use the selected completed archive")
      assert.equal(remote, REMOTE, "Publication must target the configured archive repository")
      return {
        commit: "a".repeat(40),
        fileCount: 2,
        alreadyPublished: false,
      }
    },
  })
  assert.equal(result.remoteCommit, "a".repeat(40), "Publication must return its verified remote commit")
  assert.equal(await readFile(fixture.lockPath, "utf8"), "active trading process lock", "Publication must leave the active process lock untouched")
})

test("publication leaves source archive bytes unchanged", async (t) => {
  const fixture = await createFixture(t)
  const before = await snapshotDirectory(fixture.archiveDirectory)
  await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: {
      HARVESTER_ARCHIVE_REMOTE: REMOTE,
    },
    publishArchiveFn: async () => ({
      commit: "b".repeat(40),
      fileCount: 2,
    }),
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
