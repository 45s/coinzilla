import os from "node:os"
import path from "node:path"
import { generateUUID, toResult } from "@coinzilla/utils"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { DEFAULT_OPERATIONAL_STATE_DIRECTORY } from "../infrastructure/operational-state/resolve-operational-state-directory.js"
import { acquireHarvesterProcessLocks } from "../infrastructure/process-lock/acquire-harvester-process-locks.js"

function validateInitializationOptions({ confirmed, directory, processLockDirectory, runtimeSessionId }) {
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
  return undefined
}

async function acquireInitializationLock({ acquireProcessLock, processLockDirectory, tradingMode, accountId }) {
  const lock = await acquireProcessLock({
    journalDirectory: processLockDirectory,
    globalDirectory: processLockDirectory,
    broker: "binance",
    tradingMode,
    accountId,
  })
  if (lock?.ok !== true || typeof lock.release !== "function") {
    return toResult({
      errors: lock?.errors?.length
        ? lock.errors
        : [new Error("Cannot initialize the Operational State Store while the Harvester process lock is unavailable")],
    })
  }
  return lock
}

async function initializeStore({ createStore, directory, runtimeSessionId }) {
  const store = createStore({ directory, 
    runtimeSessionId })
  if (typeof store?.initialize !== "function") {
    throw new TypeError("Operational State Store initializer requires the explicit store.initialize capability")
  }
  const result = await store.initialize()
  if (result?.ok === true && result.data?.durable === true) {
    return toResult({
      data: Object.freeze({
        directory: path.resolve(directory),
        runtimeSessionId,
        sequence: result.data.record.sequence,
        digest: result.data.record.digest,
        durable: true,
      }),
    })
  }
  if (result?.ok !== true) {
    return toResult({
      errors: result?.errors?.length
        ? result.errors
        : [new Error("Operational State Store initialization did not confirm durable commitment")],
    })
  }
  return toResult({
    error: new Error("Operational State Store initialization returned an incomplete durable acknowledgement"),
  })
}

async function releaseInitializationLock({ processLock }) {
  if (!processLock) {
    return undefined
  }
  try {
    const released = await processLock.release()
    if (released?.ok !== true) {
      return released?.errors?.[0] ??
        new Error("Harvester process lock release failed after Operational State Store initialization")
    }
  } catch (error) {
    return error
  }
  return undefined
}

function includeReleaseError({ initializationResult, releaseError }) {
  const errors = [...(initializationResult?.errors ?? []), releaseError]
  return toResult({
    errors: errors.length === 1
      ? errors
      : [new AggregateError(errors, "Operational State Store initialization or process-lock release failed")],
  })
}

/**
 * Explicit, one-time initialization of the application-owned Operational State Store.
 * Normal Harvester startup never calls initialize(); it only verifies.
 */
export async function initializeHarvesterOperationalStateStore({
  confirmed = false,
  directory = DEFAULT_OPERATIONAL_STATE_DIRECTORY,
  processLockDirectory = path.join(os.homedir(), ".coinzilla", "harvester", "process-locks"),
  runtimeSessionId = generateUUID(),
  tradingMode = process.env.TRADING_MODE,
  accountId = process.env.BINANCE_ACCOUNT_ID,
  acquireProcessLock = acquireHarvesterProcessLocks,
  createStore = createFileOperationalStateStore,
} = {}) {
  const validationResult = validateInitializationOptions({
    confirmed,
    directory,
    processLockDirectory,
    runtimeSessionId,
  })
  if (validationResult) {
    return validationResult
  }

  let processLock
  let initializationResult
  try {
    const lockResult = await acquireInitializationLock({
      acquireProcessLock,
      processLockDirectory,
      tradingMode,
      accountId,
    })
    if (lockResult?.ok !== true) {
      return lockResult
    }
    processLock = lockResult
    initializationResult = await initializeStore({
      createStore,
      directory,
      runtimeSessionId,
    })
  } catch (error) {
    initializationResult = toResult({ error })
  }

  const releaseError = await releaseInitializationLock({ processLock })
  if (releaseError) {
    return includeReleaseError({ initializationResult, 
      releaseError })
  }
  return initializationResult ?? toResult({
    error: new Error("Operational State Store initialization did not produce a result"),
  })
}
