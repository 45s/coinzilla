import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acquireHarvesterProcessLocks } from "./acquire-harvester-process-locks.js"

async function createLockDirectories() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-environment-scope-"))
  return {
    root,
    globalDirectory: path.join(root, "host-locks"),
    journalDirectory: path.join(root, "journal"),
  }
}

test("allows Testnet and production writers to coexist", async () => {
  const { root, globalDirectory, journalDirectory } = await createLockDirectories()
  try {
    const testnet = await acquireHarvesterProcessLocks({
      globalDirectory, journalDirectory, broker: "binance", tradingMode: "testnet",
    })
    const production = await acquireHarvesterProcessLocks({
      globalDirectory, journalDirectory, broker: "binance", tradingMode: "live",
    })
    assert.equal(testnet.ok, true)
    assert.equal(production.ok, true)
    assert.notEqual(testnet.hostLockPath, production.hostLockPath)
    assert.notEqual(testnet.lockPath, production.lockPath)
    assert.equal((await testnet.release()).ok, true)
    assert.equal((await production.release()).ok, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("blocks a second writer in the same environment across worktrees, regardless of account", async () => {
  const { root, globalDirectory } = await createLockDirectories()
  try {
    const first = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "worktree-develop", "journal"),
      broker: "binance",
      tradingMode: "testnet",
    })
    const second = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "worktree-main", "journal"),
      broker: "binance",
      tradingMode: "testnet",
    })
    assert.equal(first.ok, true)
    assert.equal(second.ok, false)
    assert.equal(second.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")
    assert.equal((await first.release()).ok, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("fails closed for an unsupported or missing trading environment", async () => {
  const { root, globalDirectory, journalDirectory } = await createLockDirectories()
  try {
    for (const tradingMode of ["sandbox", "", undefined]) {
      const result = await acquireHarvesterProcessLocks({
        globalDirectory, journalDirectory, broker: "binance", tradingMode,
      })
      assert.equal(result.ok, false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("concurrent acquisitions for one broker and environment have exactly one winner", async () => {
  const { root, globalDirectory, journalDirectory } = await createLockDirectories()
  try {
    const attempts = await Promise.all(Array.from({ length: 8 }, () =>
      acquireHarvesterProcessLocks({
        globalDirectory, journalDirectory, broker: "binance", tradingMode: "testnet",
      })))
    const winners = attempts.filter((result) => result.ok === true)
    assert.equal(winners.length, 1)
    assert.equal(attempts.filter((result) => result.ok !== true).length, 7)
    assert.equal((await winners[0].release()).ok, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
