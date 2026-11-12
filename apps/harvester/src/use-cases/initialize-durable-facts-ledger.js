import os from "node:os"
import path from "node:path"
import { generateUUID, toResult } from "@coinzilla/utils"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { acquireHarvesterProcessLocks } from "../infrastructure/process-lock/acquire-harvester-process-locks.js"

const defaultRoot = path.join(os.homedir(), ".coinzilla", "harvester")

/**
 * Explicit, one-time creation of the application-owned recovery-facts genesis.
 * Normal Harvester startup never calls initialize(); it only verifies.
 */
export async function initializeHarvesterDurableFactsLedger({
  confirmed = false,
  directory = path.join(defaultRoot, "recovery-facts"),
  processLockDirectory = path.join(defaultRoot, "process-locks"),
  runtimeSessionId = generateUUID(),
  acquireProcessLock = acquireHarvesterProcessLocks,
  createStore = createFileDurableFactsStore,
} = {}) {
  let processLock
  try {
    if (confirmed !== true) {
      throw new Error("Explicit confirmation is required; pass --confirm-initialize to create the one-time recovery-facts genesis")
    }
    if (typeof directory !== "string" || !directory.trim() ||
        typeof processLockDirectory !== "string" || !processLockDirectory.trim() ||
        typeof runtimeSessionId !== "string" || !runtimeSessionId.trim()) {
      throw new TypeError("Recovery-facts initialization requires a directory, process-lock directory, and runtime session ID")
    }
    const lock = await acquireProcessLock({
      journalDirectory: processLockDirectory,
      globalDirectory: processLockDirectory,
      broker: "binance",
    })
    if (lock?.ok !== true || typeof lock.release !== "function") {
      return toResult({
        errors: lock?.errors?.length ? lock.errors : [new Error("Cannot initialize recovery facts while the Harvester process lock is unavailable")],
      })
    }
    processLock = lock
    const store = createStore({ directory, runtimeSessionId })
    if (typeof store?.initialize !== "function") {
      throw new TypeError("Recovery-facts initializer requires the explicit store.initialize capability")
    }
    const initialized = await store.initialize()
    if (initialized?.ok !== true || initialized.data?.durable !== true) {
      return toResult({
        errors: initialized?.errors?.length
          ? initialized.errors
          : [new Error("Recovery-facts genesis initialization did not confirm durable commitment")],
      })
    }
    return toResult({
      data: Object.freeze({
        directory: path.resolve(directory),
        runtimeSessionId,
        sequence: initialized.data.record.sequence,
        digest: initialized.data.record.digest,
        durable: true,
      }),
    })
  } catch (error) {
    return toResult({ error })
  } finally {
    if (processLock) {
      try {
        const released = await processLock.release()
        if (released?.ok !== true) {
          // A failed release is surfaced by the lock's own durable ownership state.
        }
      } catch {
        // The initialization result remains conservative; the lock file itself
        // is left for the normal process-lock recovery policy to inspect.
      }
    }
  }
}
