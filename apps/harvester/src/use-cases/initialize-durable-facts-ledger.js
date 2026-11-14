import os from "node:os"
import path from "node:path"
import { generateUUID, toResult } from "@coinzilla/utils"
import { createFileDurableFactsStore } from "../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { DEFAULT_OPERATIONAL_STATE_DIRECTORY } from "../infrastructure/operational-state/resolve-operational-state-directory.js"
import { acquireHarvesterProcessLocks } from "../infrastructure/process-lock/acquire-harvester-process-locks.js"


/**
 * Explicit, one-time initialization of the application-owned Operational State Store.
 * Normal Harvester startup never calls initialize(); it only verifies.
 */
export async function initializeHarvesterDurableFactsLedger({
  confirmed = false,
  directory = DEFAULT_OPERATIONAL_STATE_DIRECTORY,
  processLockDirectory = path.join(os.homedir(), ".coinzilla", "harvester", "process-locks"),
  runtimeSessionId = generateUUID(),
  acquireProcessLock = acquireHarvesterProcessLocks,
  createStore = createFileDurableFactsStore,
} = {}) {
  if (confirmed !== true) {
    return toResult({
      error: new Error("Explicit confirmation is required; pass --confirm-initialize to initialize the Operational State Store"),
    })
  }
  if (typeof directory !== "string" || !directory.trim() ||
      typeof processLockDirectory !== "string" || !processLockDirectory.trim() ||
      typeof runtimeSessionId !== "string" || !runtimeSessionId.trim()) {
    return toResult({
      error: new TypeError("Operational State Store initialization requires a directory, process-lock directory, and runtime session ID"),
    })
  }

  let processLock
  let initializationResult
  let releaseError
  try {
    const lock = await acquireProcessLock({
      journalDirectory: processLockDirectory,
      globalDirectory: processLockDirectory,
      broker: "binance",
    })
    if (lock?.ok !== true || typeof lock.release !== "function") {
      return toResult({
        errors: lock?.errors?.length ? lock.errors : [new Error("Cannot initialize the Operational State Store while the Harvester process lock is unavailable")],
      })
    }
    processLock = lock
    const store = createStore({ directory, runtimeSessionId })
    if (typeof store?.initialize !== "function") {
      throw new TypeError("Operational State Store initializer requires the explicit store.initialize capability")
    }
    initializationResult = await store.initialize()
    if (initializationResult?.ok === true && initializationResult.data?.durable === true) {
      initializationResult = toResult({
        data: Object.freeze({
          directory: path.resolve(directory),
          runtimeSessionId,
          sequence: initializationResult.data.record.sequence,
          digest: initializationResult.data.record.digest,
          durable: true,
        }),
      })
    } else if (initializationResult?.ok !== true) {
      initializationResult = toResult({
        errors: initializationResult?.errors?.length
          ? initializationResult.errors
          : [new Error("Recovery-facts genesis initialization did not confirm durable commitment")],
      })
    } else {
      initializationResult = toResult({ error: new Error("Recovery-facts genesis initialization returned an incomplete durable acknowledgement") })
    }
  } catch (error) {
    initializationResult = toResult({ error })
  } finally {
    if (processLock) {
      try {
        const released = await processLock.release()
        if (released?.ok !== true) {
          releaseError = released?.errors?.[0] ?? new Error("Harvester process lock release failed after Operational State Store initialization")
        }
      } catch (error) {
        releaseError = error
      }
    }
  }
  if (releaseError) {
    const errors = [...(initializationResult?.errors ?? []), releaseError]
    return toResult({
      errors: errors.length === 1 ? errors : [new AggregateError(errors, "Operational State Store initialization or process-lock release failed")],
    })
  }
  return initializationResult ?? toResult({ error: new Error("Operational State Store initialization did not produce a result") })
}
