import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acquireHarvesterProcessLock } from "./acquire-harvester-process-lock.js"

const createTempDirectory = () => mkdtemp(path.join(os.tmpdir(), "harvester-process-lock-"))

test("acquires an exclusive lock and releases it idempotently", async () => {
  const directory = await createTempDirectory()
  try {
    const acquired = await acquireHarvesterProcessLock({
      directory,
      pid: 101,
      hostname: "test-host",
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "owner-token",
    })
    assert.equal(acquired.ok, true)
    const owner = JSON.parse(await readFile(acquired.lockPath, "utf8"))
    assert.deepEqual(owner, {
      pid: 101,
      hostname: "test-host",
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "owner-token",
    })

    assert.deepEqual(await acquired.release(), { ok: true, released: true })
    assert.deepEqual(await acquired.release(), { ok: true, released: false, alreadyReleased: true })
    await assert.rejects(readFile(acquired.lockPath, "utf8"), { code: "ENOENT" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects a second trading process without reclaiming the existing lock", async () => {
  const directory = await createTempDirectory()
  try {
    const first = await acquireHarvesterProcessLock({
      directory,
      pid: 111,
      hostname: "test-host",
      token: "first-token",
    })
    const second = await acquireHarvesterProcessLock({
      directory,
      pid: 222,
      hostname: "test-host",
      token: "second-token",
    })

    assert.equal(first.ok, true)
    assert.equal(second.ok, false)
    assert.equal(second.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")
    assert.equal(second.errors[0].details.existingOwner.pid, 111)
    assert.equal(JSON.parse(await readFile(first.lockPath, "utf8")).token, "first-token")
    assert.equal((await first.release()).ok, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("refuses to remove a lock whose ownership token changed", async () => {
  const directory = await createTempDirectory()
  try {
    const acquired = await acquireHarvesterProcessLock({ directory, token: "original-token" })
    await unlink(acquired.lockPath)
    await writeFile(acquired.lockPath, JSON.stringify({
      pid: 999,
      hostname: "replacement",
      startedAt: "2026-11-05T00:00:00.000Z",
      token: "replacement-token",
    }))

    const released = await acquired.release()
    assert.equal(released.ok, false)
    assert.equal(released.errors[0].code, "HARVESTER_PROCESS_LOCK_OWNERSHIP_MISMATCH")
    assert.equal(JSON.parse(await readFile(acquired.lockPath, "utf8")).token, "replacement-token")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("does not automatically reclaim a stale or unreadable lock", async () => {
  const directory = await createTempDirectory()
  const lockPath = path.join(directory, ".harvester-trading.lock")
  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 1,
      hostname: "old-host",
      startedAt: "2020-01-01T00:00:00.000Z",
      token: "stale-token",
    }))
    const result = await acquireHarvesterProcessLock({ directory })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "stale-token")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects invalid process lock inputs", async () => {
  const result = await acquireHarvesterProcessLock({ directory: " ", pid: 0 })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /non-empty directory/)
})


test("allows exactly one owner when two processes race to acquire the same lock", async () => {
  const directory = await createTempDirectory()
  try {
    const results = await Promise.all([
      acquireHarvesterProcessLock({ directory, pid: 301, hostname: "race-host", token: "race-token-a" }),
      acquireHarvesterProcessLock({ directory, pid: 302, hostname: "race-host", token: "race-token-b" }),
    ])
    const owners = results.filter((result) => result.ok)
    const conflicts = results.filter((result) => !result.ok)

    assert.equal(owners.length, 1)
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")
    assert.equal(JSON.parse(await readFile(owners[0].lockPath, "utf8")).token, owners[0].owner.token)
    assert.equal((await owners[0].release()).ok, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
