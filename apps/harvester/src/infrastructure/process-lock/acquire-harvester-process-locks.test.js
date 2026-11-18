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
      tradingMode: "testnet",
    })
    assert.equal(first.ok, true)

    const second = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: secondJournalDirectory,
      broker: "binance",
      tradingMode: "testnet",
    })
    assert.equal(second.ok, false)
    assert.equal(second.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")

    assert.equal((await first.release({})).ok, true)

    const afterRelease = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: secondJournalDirectory,
      broker: "binance",
      tradingMode: "testnet",
    })
    assert.equal(afterRelease.ok, true)
    assert.notEqual(afterRelease.lockPath, first.lockPath)
    assert.equal((await afterRelease.release({})).ok, true)
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    })
  }
})

test("releases the host lock when Journal-lock acquisition fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-global-lock-cleanup-"))
  const globalDirectory = path.join(root, "host-locks")
  const journalDirectory = path.join(root, "journal")
  let hostLockFileName
  let acquisitionCount = 0
  const acquireLock = async (input) => {
    acquisitionCount += 1
    if (acquisitionCount === 1) {
      hostLockFileName = input.lockFileName
      return acquireHarvesterProcessLock(input)
    }
    return toResult({ error: Object.assign(new Error("simulated Journal lock conflict"), {
      code: "HARVESTER_PROCESS_LOCK_EXISTS",
    }) })
  }

  try {
    const failed = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      tradingMode: "testnet",
      acquireLock,
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")

    const hostLockCanBeAcquired = await acquireHarvesterProcessLock({
      directory: globalDirectory,
      lockFileName: hostLockFileName,
    })
    assert.equal(hostLockCanBeAcquired.ok, true)
    assert.equal((await hostLockCanBeAcquired.release({})).ok, true)
  } finally {
    await rm(root, { recursive: true,
      force: true })
  }
})

test("retains the host lock when Journal-lock release is uncertain and retries idempotently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-global-lock-release-"))
  const globalDirectory = path.join(root, "host-locks")
  const journalDirectory = path.join(root, "journal")
  let failJournalRelease = true

  const acquireLock = async (input = {}) => {
    const result = await acquireHarvesterProcessLock(input)
    if (input.directory !== journalDirectory || result?.ok !== true) {return result}
    return {
      ...result,
      release: async () => {
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
      tradingMode: "testnet",
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
      tradingMode: "testnet",
    })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS")

    assert.equal((await first.release({})).ok, true)
    assert.equal((await first.release({})).alreadyReleased, true)

    const afterRelease = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: path.join(root, "journal-two"),
      broker: "binance",
      tradingMode: "testnet",
    })
    assert.equal(afterRelease.ok, true)
    assert.equal((await afterRelease.release({})).ok, true)
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    })
  }
})

test("allows different provider accounts to hold independent process locks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-account-locks-"))
  const globalDirectory = path.join(root, "host-locks")
  const firstJournalDirectory = path.join(root, "account-one-journal")
  const secondJournalDirectory = path.join(root, "account-two-journal")

  try {
    const firstAccountLock = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: firstJournalDirectory,
      broker: "binance",
      providerInstanceId: "binance-testnet-one",
      accountId: "account-one",
      tradingMode: "testnet",
    })
    assert.equal(firstAccountLock.ok, true, "The first account must acquire its own provider/account/environment lock.")
    assert.equal(firstAccountLock.lockScope.accountId, "account-one", "The lock diagnostics must expose the stable non-secret account alias.")
    assert.equal(firstAccountLock.lockScope.providerInstanceId, "binance-testnet-one", "The lock diagnostics must expose the provider instance that requested the account lock.")

    const secondAccountLock = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: secondJournalDirectory,
      broker: "binance",
      providerInstanceId: "binance-testnet-two",
      accountId: "account-two",
      tradingMode: "testnet",
    })
    assert.equal(secondAccountLock.ok, true, "A different Binance account must not be blocked by the first account's process lock.")
    assert.notEqual(firstAccountLock.lockPath, secondAccountLock.lockPath, "Different account identities must resolve to different application lock files.")

    assert.equal((await secondAccountLock.release()).ok, true, "The second account must release only its own process lock.")
    assert.equal((await firstAccountLock.release()).ok, true, "The first account must release only its own process lock.")
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    })
  }
})

test("blocks a second provider instance for the same account and environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-same-account-lock-"))
  const globalDirectory = path.join(root, "host-locks")
  const firstJournalDirectory = path.join(root, "first-instance-journal")
  const secondJournalDirectory = path.join(root, "second-instance-journal")

  try {
    const firstInstanceLock = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: firstJournalDirectory,
      broker: "binance",
      providerInstanceId: "binance-primary",
      accountId: "shared-account",
      tradingMode: "testnet",
    })
    assert.equal(
      firstInstanceLock.ok,
      true,
      "The first provider instance must acquire the shared account's writer lock.",
    )

    const secondInstanceLock = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: secondJournalDirectory,
      broker: "binance",
      providerInstanceId: "binance-secondary",
      accountId: "shared-account",
      tradingMode: "testnet",
    })
    assert.equal(
      secondInstanceLock.ok,
      false,
      "Two provider instances must not create concurrent writers for the same exchange account.",
    )
    assert.equal(
      secondInstanceLock.errors[0].code,
      "HARVESTER_PROCESS_LOCK_EXISTS",
      "A duplicate account writer must fail with the established process-lock conflict code.",
    )
    assert.equal(
      (await firstInstanceLock.release()).ok,
      true,
      "The account writer lock must remain releasable after a duplicate acquisition is rejected.",
    )
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    })
  }
})

test("rejects incomplete provider/account lock identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-incomplete-account-lock-"))
  const globalDirectory = path.join(root, "host-locks")
  const journalDirectory = path.join(root, "journal")

  try {
    const missingAccount = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      providerInstanceId: "binance-testnet-one",
      tradingMode: "testnet",
    })
    assert.equal(
      missingAccount.ok,
      false,
      "A provider instance must not be accepted without its stable account identity.",
    )
    assert.match(
      missingAccount.errors[0].message,
      /providerInstanceId and accountId must be supplied together/,
      "Incomplete provider/account identity must fail with an actionable validation message.",
    )

    const missingProvider = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory,
      broker: "binance",
      accountId: "account-one",
      tradingMode: "testnet",
    })
    assert.equal(
      missingProvider.ok,
      false,
      "An account identity must not be accepted without its provider instance identity.",
    )
    assert.match(
      missingProvider.errors[0].message,
      /providerInstanceId and accountId must be supplied together/,
      "Incomplete account/provider identity must fail with an actionable validation message.",
    )
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    })
  }
})


test("preserves the legacy Binance primary lock for mixed-version exclusion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harvester-legacy-primary-lock-"))
  const globalDirectory = path.join(root, "host-locks")
  const legacyJournalDirectory = path.join(root, "legacy-journal")
  const accountJournalDirectory = path.join(root, "account-journal")

  try {
    const legacyLock = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: legacyJournalDirectory,
      broker: "binance",
      tradingMode: "testnet",
    })
    assert.equal(legacyLock.ok, true, "The legacy single-Binance process must acquire its existing primary lock.")

    const accountAwareLock = await acquireHarvesterProcessLocks({
      globalDirectory,
      journalDirectory: accountJournalDirectory,
      broker: "binance",
      providerInstanceId: "binance-testnet-primary",
      accountId: "binance-primary",
      tradingMode: "testnet",
    })
    assert.equal(accountAwareLock.ok, false, "The account-aware primary runtime must conflict with a legacy primary writer.")
    assert.equal(accountAwareLock.errors[0].code, "HARVESTER_PROCESS_LOCK_EXISTS", "Mixed-version primary writers must fail with the established lock-conflict code.")
    assert.equal((await legacyLock.release()).ok, true, "The legacy primary lock must remain releasable after the conflict.")
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    })
  }
})
