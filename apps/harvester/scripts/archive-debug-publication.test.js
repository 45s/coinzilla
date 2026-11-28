import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runHarvesterDebugArchivePublication } from "./archive-debug-publication.js"

const execFileAsync = promisify(execFile)
const ARCHIVE_NAME = "2026-11-28T12-00-00Z_123e4567_debug"
const REMOTE = "https://github.com/45s/coinzilla-archive.git"

async function createArchiveFixture(root) {
  const archiveDirectory = path.join(root, "archive-output", ARCHIVE_NAME)
  await mkdir(path.join(archiveDirectory, "logs", "sessions", "fixture"), { recursive: true })
  const content = "immutable completed session evidence\n"
  await writeFile(path.join(archiveDirectory, "logs", "sessions", "fixture", "terminal.log.gz"), content)
  const files = [{
    path: "logs/sessions/fixture/terminal.log.gz",
    size: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  }]
  await writeFile(path.join(archiveDirectory, "manifest.json"), JSON.stringify({
    formatVersion: 1,
    application: "harvester",
    commandTradingMode: "testnet",
    createdAt: "2026-11-28T12:00:00.000Z",
    includedDirectories: ["logs", "recovery-facts"],
    excludedPaths: ["data/** (all databases and backups)", "logs/cumulative/**"],
    files,
  }, null, 2) + "\n")
  return archiveDirectory
}

async function snapshotDirectory(directory) {
  const files = new Map()
  async function visit(current, relative = "") {
    const { readdir, lstat } = await import("node:fs/promises")
    for (const name of await readdir(current)) {
      const child = relative ? path.join(relative, name) : name
      const filename = path.join(current, name)
      const stats = await lstat(filename)
      assert.equal(stats.isSymbolicLink(), false, "Archive fixture must not contain symlinks")
      if (stats.isDirectory()) {
        await visit(filename, child)
      } else {
        files.set(child, await readFile(filename))
      }
    }
  }
  await visit(directory)
  return files
}

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-archive-publication-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archiveDirectory = await createArchiveFixture(root)
  const lockDirectory = path.join(root, "process-locks")
  await mkdir(lockDirectory)
  const lockPath = path.join(lockDirectory, ".binance-harvester-trading-test.lock")
  await writeFile(lockPath, "active trading process lock")
  return { root, archiveDirectory, lockPath }
}

test("publishes a completed archive while a Harvester process lock exists", async (t) => {
  const fixture = await createFixture(t)
  const result = await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    publishArchiveFn: async ({ archiveName, directory, remote }) => {
      assert.equal(archiveName, ARCHIVE_NAME, "Publication must preserve the archive directory name")
      assert.equal(directory, fixture.archiveDirectory, "Publication must use the selected completed archive")
      assert.equal(remote, REMOTE, "Publication must target the configured archive repository")
      return { commit: "a".repeat(40), fileCount: 2, alreadyPublished: false }
    },
  })
  assert.equal(result.remoteCommit, "a".repeat(40), "Publication must return its verified remote commit")
  assert.equal(await readFile(fixture.lockPath, "utf8"), "active trading process lock", "Publication must leave the active Harvester lock untouched")
})

test("does not modify any source archive file during publication", async (t) => {
  const fixture = await createFixture(t)
  const before = await snapshotDirectory(fixture.archiveDirectory)
  await runHarvesterDebugArchivePublication({
    archiveDirectory: fixture.archiveDirectory,
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    publishArchiveFn: async () => ({ commit: "b".repeat(40), fileCount: 2 }),
  })
  const after = await snapshotDirectory(fixture.archiveDirectory)
  assert.deepEqual(after, before, "Publication must leave every source archive path and byte unchanged")
})

test("rejects an archive whose manifest checksum does not match its contents", async (t) => {
  const fixture = await createFixture(t)
  await writeFile(path.join(fixture.archiveDirectory, "logs/sessions/fixture/terminal.log.gz"), "tampered")
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
      publishArchiveFn: async () => assert.fail("Invalid archive must never reach publication"),
    }),
    /checksum|size|inventory/i,
    "A checksum mismatch must fail before any remote publication",
  )
})

test("rejects a manifest with duplicate or unsafe paths", async (t) => {
  const fixture = await createFixture(t)
  const manifestPath = path.join(fixture.archiveDirectory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.files[0].path = "../outside.txt"
  await writeFile(manifestPath, JSON.stringify(manifest))
  await assert.rejects(
    runHarvesterDebugArchivePublication({
      archiveDirectory: fixture.archiveDirectory,
      env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
      publishArchiveFn: async () => assert.fail("Unsafe manifest must never reach publication"),
    }),
    /manifest|path|inventory/i,
    "Unsafe manifest paths must be rejected",
  )
})

test("selects the latest completed archive without inspecting live process state", async (t) => {
  const fixture = await createFixture(t)
  const older = await createArchiveFixture(fixture.root)
  const latestName = "2026-11-28T13-00-00Z_223e4567_debug"
  const latest = path.join(fixture.root, "archive-output", latestName)
  await mkdir(path.dirname(latest), { recursive: true })
  await import("node:fs/promises").then(({ cp }) => cp(older, latest, { recursive: true }))
  const result = await runHarvesterDebugArchivePublication({
    packageDirectory: fixture.root,
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    publishArchiveFn: async ({ archiveName }) => ({
      commit: "c".repeat(40),
      fileCount: 2,
      archiveName,
    }),
  })
  assert.equal(result.archiveName, latestName, "Default selection must choose the latest valid completed archive")
})

test("an interrupted publication can be retried and an already-published archive is idempotent", async (t) => {
  const fixture = await createFixture(t)
  let attempts = 0
  const publishArchiveFn = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new Error("simulated network interruption")
    }
    return { commit: "d".repeat(40), fileCount: 2, alreadyPublished: attempts > 2 }
  }
  const options = {
    archiveDirectory: fixture.archiveDirectory,
    env: { HARVESTER_ARCHIVE_REMOTE: REMOTE },
    publishArchiveFn,
  }
  await assert.rejects(runHarvesterDebugArchivePublication(options), /simulated network interruption/)
  const retry = await runHarvesterDebugArchivePublication(options)
  assert.equal(retry.remoteCommit, "d".repeat(40), "Retry must publish the same immutable archive")
  const repeated = await runHarvesterDebugArchivePublication(options)
  assert.equal(repeated.alreadyPublished, true, "A repeated publication must report the existing verified archive")
  assert.equal(attempts, 3, "Retry and idempotent repeat must use the same archive without recollection")
})
