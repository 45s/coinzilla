import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { acquireHarvesterProcessLock } from "./acquire-harvester-process-lock.js"

function getErrors({ result, fallbackMessage }) {
  if (Array.isArray(result?.errors) && result.errors.length > 0) {return result.errors}
  return [new Error(fallbackMessage)]
}

async function releaseHostLockAfterJournalFailure({ hostLock, errors }) {
  try {
    const released = await hostLock.release()
    if (released?.ok !== true) {
      errors.push(...getErrors({
        result: released,
        fallbackMessage: "Unable to release the broker-wide lock after Journal lock acquisition failed",
      }))
    }
  } catch (error) {
    errors.push(error)
  }
}

async function releaseJournalLock({ journalLock }) {
  try {
    const result = await journalLock.release()
    if (result?.ok === true) {return toResult({ released: true })}
    return toResult({
      error: new AggregateError(
        getErrors({
          result,
          fallbackMessage: "Harvester Journal-directory lock release did not complete",
        }),
        "Harvester Journal-directory lock release failed; broker-wide lock retained",
      ),
    })
  } catch (error) {
    return toResult({
      error: new AggregateError(
        [error],
        "Harvester Journal-directory lock release failed; broker-wide lock retained",
      ),
    })
  }
}

async function releaseHostLock({ hostLock }) {
  try {
    const result = await hostLock.release()
    if (result?.ok === true) {return toResult({ released: true })}
    return toResult({
      error: new AggregateError(
        getErrors({
          result,
          fallbackMessage: "Harvester broker-wide lock release did not complete",
        }),
        "Harvester broker-wide lock release failed",
      ),
    })
  } catch (error) {
    return toResult({ error })
  }
}

function createLockRelease({ journalLock, hostLock }) {
  let journalReleased = false
  let hostReleased = false
  return async function release() {
    if (journalReleased && hostReleased) {
      return toResult({ released: false,
alreadyReleased: true })
    }
    if (!journalReleased) {
      const result = await releaseJournalLock({ journalLock })
      if (result?.ok !== true) {return result}
      journalReleased = true
    }
    if (!hostReleased) {
      const result = await releaseHostLock({ hostLock })
      if (result?.ok !== true) {return result}
      hostReleased = true
    }
    return toResult({ released: true })
  }
}

async function handleJournalLockFailure({ journalLock, hostLock }) {
  const errors = getErrors({
    result: journalLock,
    fallbackMessage: "Unable to acquire the Journal-directory Harvester trading lock",
  })
  await releaseHostLockAfterJournalFailure({ hostLock,
errors })
  return toResult({
    error: errors.length === 1
      ? errors[0]
      : new AggregateError(errors, "Harvester trading lock acquisition failed"),
  })
}

function validateProcessLockOptions({
  journalDirectory,
  globalDirectory,
  broker,
  tradingMode,
  acquireLock,
}) {
  if (typeof journalDirectory !== "string" || !journalDirectory.trim()) {
    throw new TypeError("Harvester trading locks require a non-empty Journal directory")
  }
  if (typeof globalDirectory !== "string" || !globalDirectory.trim()) {
    throw new TypeError("Harvester trading locks require a non-empty host lock directory")
  }
  if (typeof broker !== "string" || !/^[a-z0-9-]+$/i.test(broker)) {
    throw new TypeError("Harvester trading lock broker must be a simple broker identifier")
  }
  if (tradingMode !== "testnet" && tradingMode !== "live") {
    throw new TypeError('Harvester Binance process lock tradingMode must be "testnet" or "live"')
  }
  if (typeof acquireLock !== "function") {
    throw new TypeError("Harvester trading lock acquireLock must be a function")
  }
}

/**
 * Derive a stable fingerprint from the broker and explicit trading environment.
 */
function createLockScopeFingerprint({ broker, tradingMode }) {
  return createHash("sha256")
    .update(JSON.stringify([broker.toLowerCase(), tradingMode]))
    .digest("hex")
}

/**
 * Acquire the environment-scoped host lock before the application lock.
 * Both locks remain held whenever release is uncertain.
 */
export async function acquireHarvesterProcessLocks({
  journalDirectory,
  globalDirectory,
  broker = "binance",
  tradingMode,
  acquireLock = acquireHarvesterProcessLock,
} = {}) {
  try {
    validateProcessLockOptions({ journalDirectory,
globalDirectory,
broker,
tradingMode,
acquireLock })

    const environmentFingerprint = createLockScopeFingerprint({
      broker,
      tradingMode,
    })
    const hostLock = await acquireLock({
      directory: globalDirectory,
      lockFileName: `.${broker.toLowerCase()}-harvester-trading-${environmentFingerprint}.lock`,
    })
    if (hostLock?.ok !== true || typeof hostLock.release !== "function") {
      return toResult({
        error: hostLock?.errors?.[0] ?? new Error("Unable to acquire the broker-wide Harvester trading lock"),
      })
    }

    const journalLock = await acquireLock({
      directory: journalDirectory,
      lockFileName: `.harvester-trading-${environmentFingerprint}.lock`,
    })
    if (journalLock?.ok !== true || typeof journalLock.release !== "function") {
      return handleJournalLockFailure({ journalLock,
hostLock })
    }

    return toResult({
      lockPath: journalLock.lockPath,
      hostLockPath: hostLock.lockPath,
      owner: hostLock.owner,
      lockScope: Object.freeze({
        broker: broker.toLowerCase(),
        tradingMode,
        environmentFingerprint,
      }),
      release: createLockRelease({ journalLock,
hostLock }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
