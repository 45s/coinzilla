import { toResult } from "@coinzilla/utils"
import { acquireHarvesterProcessLock } from "./acquire-harvester-process-lock.js"

function collectErrors({ result, fallbackMessage }) {
  if (Array.isArray(result?.errors) && result.errors.length > 0) return result.errors
  return [new Error(fallbackMessage)]
}

/**
 * Acquire both a broker-wide host lock and the configured Journal-directory lock.
 * The host lock prevents two Harvester processes from trading through separate
 * Journal directories under the same OS user account.
 */
export async function acquireHarvesterProcessLocks({
  journalDirectory,
  globalDirectory,
  broker = "binance",
  acquireLock = acquireHarvesterProcessLock,
} = {}) {
  try {
    if (typeof journalDirectory !== "string" || !journalDirectory.trim()) {
      throw new TypeError("Harvester trading locks require a non-empty Journal directory")
    }
    if (typeof globalDirectory !== "string" || !globalDirectory.trim()) {
      throw new TypeError("Harvester trading locks require a non-empty host lock directory")
    }
    if (typeof broker !== "string" || !/^[a-z0-9-]+$/i.test(broker)) {
      throw new TypeError("Harvester trading lock broker must be a simple broker identifier")
    }
    if (typeof acquireLock !== "function") {
      throw new TypeError("Harvester trading lock acquireLock must be a function")
    }

    const hostLock = await acquireLock({
      directory: globalDirectory,
      lockFileName: "." + broker.toLowerCase() + "-harvester-trading.lock",
    })
    if (hostLock?.ok !== true || typeof hostLock.release !== "function") {
      return toResult({
        error: hostLock?.errors?.[0] ?? new Error("Unable to acquire the broker-wide Harvester trading lock"),
      })
    }

    const journalLock = await acquireLock({ directory: journalDirectory })
    if (journalLock?.ok !== true || typeof journalLock.release !== "function") {
      const errors = collectErrors({
        result: journalLock,
        fallbackMessage: "Unable to acquire the Journal-directory Harvester trading lock",
      })
      try {
        const released = await hostLock.release()
        if (released?.ok !== true) errors.push(...collectErrors({
          result: released,
          fallbackMessage: "Unable to release the broker-wide lock after Journal lock acquisition failed",
        }))
      } catch (error) {
        errors.push(error)
      }
      return toResult({ error: errors.length === 1 ? errors[0] : new AggregateError(errors, "Harvester trading lock acquisition failed") })
    }

    let released = false
    const release = async () => {
      const errors = []
      for (const lock of [journalLock, hostLock]) {
        try {
          const result = await lock.release()
          if (result?.ok !== true) {
            errors.push(...collectErrors({
              result,
              fallbackMessage: "Harvester trading lock release did not complete",
            }))
          }
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) return toResult({ error: errors.length === 1 ? errors[0] : new AggregateError(errors, "Harvester trading lock release failed") })
      released = true
      return toResult({ released: true })
    }

    return toResult({
      lockPath: journalLock.lockPath,
      hostLockPath: hostLock.lockPath,
      owner: hostLock.owner,
      release: async () => {
        if (released) return toResult({ released: false, alreadyReleased: true })
        return release()
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
