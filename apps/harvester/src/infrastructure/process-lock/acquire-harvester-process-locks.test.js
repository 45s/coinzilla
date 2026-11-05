import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { toResult } from "@coinzilla/utils"
import { acquireHarvesterProcessLock } from "./acquire-harvester-process-lock.js"
import { acquireHarvesterProcessLocks } from "./acquire-harvester-process-locks.js"

test("rejects a second trading process using a different Journal directory on the same host", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-global-lock-"))
  const globalDirectory = path.join(root, "host-locks")
  const firstJournalDirectory = path.join(root, "journal-one")
  const secondJournalDirectory = path.join(root, "journal-two")

  try {
    const first = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: firstJournalDirectory,
      broker: "binance",
    })
    assert.equal(first.ok, true)

    const second = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: secondJournalDirectory,
      broker: "binance",
    })
    assert.equal(second.ok, false)
    assert.equal(second.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")

    assert.equal((await first.release({})).ok, true)

    const afterRelease = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: secondJournalDirectory,
      broker: "binance",
    })
    assert.equal(afterRelease.ok, true)
    assert.notEqual(afterRelease.lockPath, first.lockPath)
    assert.equal((await afterRelease.release({})).ok, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("releases the host lock when Journal-lock acquisition fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-global-lock-cleanup-"))
  const globalDirectory = path.join(root, "host-locks")
  const journalDirectory = path.join(root, "journal")

  try {
    const existingJournalLock = await acquireHarvesterProcessLock({ directory: journalDirectory })
    const failed = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")

    const hostLockCanBeAcquired = await acquireHarvesterProcessLock({
      directory: globalDirectory,
      lockFileName: ".binance-harvester-trading.lock",
    })
    assert.equal(hostLockCanBeAcquired.ok, true)
    assert.equal((await hostLockCanBeAcquired.release({})).ok, true)
    assert.equal((await existingJournalLock.release({})).ok, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("retains the host lock when Journal-lock release is uncertain and retries idempotently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-global-lock-release-"))
  const globalDirectory = path.join(root, "host-locks")
  const journalDirectory = path.join(root, "journal")
  let failJournalRelease = true

  const acquireLock = async (input = {}) => {
    const result = await acquireHarvesterProcessLock(input)
    if (input.directory !== journalDirectory || result?.ok !== true) return result
    return {
      ...result,
      release: async ({} = {}) => {
        if (failJournalRelease) {
          failJournalRelease = false
          return toResult({ error: new Error("simulated Journal lock release failure") })
        }
        return result.release({})
      },
    }
  }

  try {
    const first = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      acquireLock,
    })
    assert.equal(first.ok, true)

    const uncertainRelease = await first.release({})
    assert.equal(uncertainRelease.ok, false)
    assert.match(uncertainRelease.errors[0].message, /broker-wide lock retained/)

    const blocked = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "journal-two"),
      broker: "binance",
    })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")

    assert.equal((await first.release({})).ok, true)
    assert.equal((await first.release({})).data?.alreadyReleased ?? false, false)

    const afterRelease = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "journal-two"),
      broker: "binance",
    })
    assert.equal(afterRelease.ok, true)
    assert.equal((await afterRelease.release({})).ok, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
