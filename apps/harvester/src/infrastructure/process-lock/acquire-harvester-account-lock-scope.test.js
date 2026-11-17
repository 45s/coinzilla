import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acquireHarvesterProcessLocks } from "./acquire-harvester-process-locks.js"

async function createLockDirectories() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-account-scope-"))
  return {
    root,
    globalDirectory: path.join(root, "host-locks"),
    journalDirectory: path.join(root, "journal"),
  }
}

test("allows Testnet and production writers for the same Binance account to coexist", async () => {
  const directories = await createLockDirectories()
  const { root, globalDirectory, journalDirectory } = directories

  try {
    const testnet = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      tradingMode: "testnet",
      accountId: "123456789",
    })
    const production = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      tradingMode: "live",
      accountId: "123456789",
    })

    assert.equal(testnet.ok, true, "A validated Testnet account must acquire its own writer lock.")
    assert.equal(production.ok, true, "The same Binance account UID in production must use a separate environment-scoped writer lock.")
    assert.notEqual(testnet.hostLockPath, production.hostLockPath, "The host lock paths must differ across Binance environments.")
    assert.notEqual(testnet.lockPath, production.lockPath, "The application lock paths must differ across Binance environments.")
    assert.equal((await testnet.release()).ok, true, "The Testnet writer must release only its own lock set.")
    assert.equal((await production.release()).ok, true, "The production writer must release only its own lock set.")
  } finally {
    await rm(root, {\n        recursive: true,\n        force: true,\n      })
  }
})

test("blocks a second writer for the same Binance account and environment across worktree directories", async () => {
  const directories = await createLockDirectories()
  const { root, globalDirectory } = directories

  try {
    const first = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "worktree-develop", "journal"),
      broker: "binance",
      tradingMode: "testnet",
      accountId: "123456789",
    })
    const second = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "worktree-main", "journal"),
      broker: "binance",
      tradingMode: "testnet",
      accountId: "123456789",
    })

    assert.equal(first.ok, true, "The first Testnet writer must acquire the shared host-level account lock.")
    assert.equal(second.ok, false, "A second worktree must not acquire writer authority for the same Testnet account.")
    assert.equal(second.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Duplicate account ownership must retain the established lock-conflict error.")
    assert.equal((await first.release()).ok, true, "The first writer must release its account lock cleanly.")
  } finally {
    await rm(root, {\n        recursive: true,\n        force: true,\n      })
  }
})

test("allows distinct validated Binance accounts in the same environment to coexist", async () => {
  const directories = await createLockDirectories()
  const { root, globalDirectory, journalDirectory } = directories

  try {
    const first = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      tradingMode: "live",
      accountId: "123456789",
    })
    const second = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      tradingMode: "live",
      accountId: "987654321",
    })

    assert.equal(first.ok, true, "The first production account must acquire its account-scoped lock.")
    assert.equal(second.ok, true, "A different validated Binance account must not be blocked by the first account's writer lock.")
    assert.notEqual(first.hostLockPath, second.hostLockPath, "Different account UIDs must produce distinct host lock paths.")
    assert.equal((await first.release()).ok, true, "The first account lock must release independently.")
    assert.equal((await second.release()).ok, true, "The second account lock must release independently.")
  } finally {
    await rm(root, {\n        recursive: true,\n        force: true,\n      })
  }
})

test("fails closed when Binance trading mode or account identity is missing or malformed", async () => {
  const directories = await createLockDirectories()
  const { root, globalDirectory, journalDirectory } = directories
  const invalidIdentities = [
    { tradingMode: "sandbox", accountId: "123456789" },
    { tradingMode: "testnet", accountId: "" },
    { tradingMode: "live", accountId: "account-production" },
    { tradingMode: "live", accountId: "0123456789" },
    { tradingMode: "testnet" },
  ]

  try {
    for (const identity of invalidIdentities) {
      const result = await acquireHarvesterProcessLocks({
        globalDirectory,
        journalDirectory,
        broker: "binance",
        ...identity,
      })
      assert.equal(result.ok, false, "An invalid or incomplete Binance account scope must never fall back to a shared lock.")
    }
  } finally {
    await rm(root, {\n        recursive: true,\n        force: true,\n      })
  }
})

test("concurrent acquisitions for one Binance account and environment have exactly one winner", async () => {
  const directories = await createLockDirectories()
  const { root, globalDirectory, journalDirectory } = directories

  try {
    const attempts = await Promise.all(Array.from({\n      length: 8,\n    }, () => acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      tradingMode: "testnet",
      accountId: "123456789",
    })))
    const winners = attempts.filter((result) => result.ok === true)
    const losers = attempts.filter((result) => result.ok !== true)

    assert.equal(winners.length, 1, "Atomic lock acquisition must grant exactly one writer when eight processes race for the same account.")
    assert.equal(losers.length, 7, "Every competing writer must fail closed while the winning account lock is held.")
    assert.equal((await winners[0].release()).ok, true, "The winning process must release the lock after the race.")
  } finally {
    await rm(root, {\n        recursive: true,\n        force: true,\n      })
  }
})
