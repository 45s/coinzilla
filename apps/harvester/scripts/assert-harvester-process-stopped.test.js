import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { assertHarvesterProcessStopped } from "./assert-harvester-process-stopped.js"
import { isHarvesterProcessAlive } from "../src/infrastructure/process-lock/acquire-harvester-process-lock.js"

const CURRENT_HOST = os.hostname()
const STARTED_AT = "2026-11-24T17:12:22.255Z"

async function createLockDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "harvester-archive-lock-preflight-"))
}

async function writeLock({ lockDirectory, filename = ".harvester-trading-test.lock", owner } = {}) {
  const lockPath = path.join(lockDirectory, filename)
  await writeFile(lockPath, JSON.stringify(owner), "utf8")
  return lockPath
}

function createOwner({ pid = 456789, hostname = CURRENT_HOST, token = "owner-token" } = {}) {
  return { pid, hostname, startedAt: STARTED_AT, token }
}

test("passes when the process-lock directory does not exist", async (t) => {
  const parentDirectory = await createLockDirectory()
  t.after(() => rm(parentDirectory, { recursive: true, force: true }))
  const lockDirectory = path.join(parentDirectory, "missing-locks")
  await assert.doesNotReject(
    assertHarvesterProcessStopped({ lockDirectory }),
    "Archive preflight must pass when no Harvester process-lock directory exists.",
  )
})

test("passes when the process-lock directory contains no lock files", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  await writeFile(path.join(lockDirectory, "operator-note.txt"), "must remain untouched", "utf8")

  await assert.doesNotReject(
    assertHarvesterProcessStopped({ lockDirectory }),
    "Unrelated files must not block archive preflight.",
  )
  assert.equal(
    await readFile(path.join(lockDirectory, "operator-note.txt"), "utf8"),
    "must remain untouched",
    "Archive preflight must not modify unrelated lock-directory files.",
  )
})

test("reclaims a same-host lock only when its recorded PID is confirmed absent", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const lockPath = await writeLock({ lockDirectory, owner: createOwner() })

  await assert.doesNotReject(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: () => false,
    }),
    "A same-host lock with a demonstrably absent PID must be safely reclaimed.",
  )
  await assert.rejects(
    readFile(lockPath, "utf8"),
    { code: "ENOENT" },
    "A confirmed stale lock must be removed after ownership is revalidated.",
  )
})

test("retains a same-host lock when its recorded PID may still be alive", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const owner = createOwner()
  const lockPath = await writeLock({ lockDirectory, owner })

  await assert.rejects(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: () => true,
    }),
    /process lock exists.*PID 456789.*host/i,
    "A live or ambiguous owner must block archiving and identify the readable owner.",
  )
  assert.deepEqual(
    JSON.parse(await readFile(lockPath, "utf8")),
    owner,
    "A potentially live process lock must remain unchanged.",
  )
})

test("retains a lock owned by another host without probing its PID", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const owner = createOwner({ hostname: "another-host" })
  const lockPath = await writeLock({ lockDirectory, owner })

  await assert.rejects(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: () => {
        assert.fail("A foreign-host PID must never be probed as a local process.")
      },
    }),
    /process lock exists.*PID 456789.*another-host/i,
    "A foreign-host lock must fail closed and report its owner.",
  )
  assert.deepEqual(
    JSON.parse(await readFile(lockPath, "utf8")),
    owner,
    "A foreign-host process lock must remain unchanged.",
  )
})

test("retains malformed lock metadata and fails closed", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const lockPath = path.join(lockDirectory, ".harvester-trading-test.lock")
  await writeFile(lockPath, "{malformed", "utf8")

  await assert.rejects(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: () => false,
    }),
    /metadata.*read|invalid.*lock|safely inspect/i,
    "Malformed ownership metadata must never be treated as evidence of a stale lock.",
  )
  assert.equal(
    await readFile(lockPath, "utf8"),
    "{malformed",
    "Malformed lock files must not be deleted or rewritten.",
  )
})

test("retains a replacement lock when ownership changes during stale-lock inspection", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const lockPath = await writeLock({ lockDirectory, owner: createOwner() })
  const replacementOwner = createOwner({
    pid: 987654,
    hostname: "replacement-host",
    token: "replacement-token",
  })

  await assert.rejects(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: () => {
        writeFileSync(lockPath, JSON.stringify(replacementOwner), "utf8")
        return false
      },
    }),
    /process lock exists|ownership changed|safely inspect/i,
    "A lock replaced after the first read must not be removed.",
  )
  assert.deepEqual(
    JSON.parse(await readFile(lockPath, "utf8")),
    replacementOwner,
    "The replacement lock owner must remain intact.",
  )
})

test("fails closed when process liveness cannot be determined", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const owner = createOwner()
  const lockPath = await writeLock({ lockDirectory, owner })

  await assert.rejects(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: () => {
        const error = new Error("Permission denied while inspecting process.")
        error.code = "EPERM"
        throw error
      },
    }),
    /safely inspect|permission denied|process lock exists/i,
    "Permission-denied process inspection must be treated as potentially alive.",
  )
  assert.deepEqual(
    JSON.parse(await readFile(lockPath, "utf8")),
    owner,
    "A lock with ambiguous process liveness must remain unchanged.",
  )
})

test("evaluates every lock file and reclaims only the confirmed stale owners", async (t) => {
  const lockDirectory = await createLockDirectory()
  t.after(() => rm(lockDirectory, { recursive: true, force: true }))
  const staleLockPath = await writeLock({
    lockDirectory,
    filename: ".binance-harvester-trading-test.lock",
    owner: createOwner({ pid: 111 }),
  })
  const liveOwner = createOwner({ pid: 222, token: "live-owner" })
  const liveLockPath = await writeLock({
    lockDirectory,
    filename: ".harvester-trading-test.lock",
    owner: liveOwner,
  })

  await assert.rejects(
    assertHarvesterProcessStopped({
      lockDirectory,
      hostname: CURRENT_HOST,
      isProcessAlive: (pid) => pid === 222,
    }),
    /process lock exists.*PID 222/i,
    "A live lock must block archiving even when another stale lock can be reclaimed.",
  )
  await assert.rejects(
    readFile(staleLockPath, "utf8"),
    { code: "ENOENT" },
    "The confirmed stale lock must be reclaimed independently.",
  )
  assert.deepEqual(
    JSON.parse(await readFile(liveLockPath, "utf8")),
    liveOwner,
    "The live lock must remain untouched.",
  )
  assert.equal(
    (await readdir(lockDirectory)).filter((filename) => filename.endsWith(".lock")).length,
    1,
    "Only the live lock should remain after the preflight evaluates all lock files.",
  )
})

test("uses the operating-system process probe without treating inspection errors as dead owners", () => {
  assert.equal(
    isHarvesterProcessAlive(process.pid),
    true,
    "The current process must be classified as alive by the platform process probe.",
  )
  assert.equal(
    isHarvesterProcessAlive(Number.MAX_SAFE_INTEGER),
    false,
    "An impossible process ID must be classified as absent when the OS returns ESRCH.",
  )
})
