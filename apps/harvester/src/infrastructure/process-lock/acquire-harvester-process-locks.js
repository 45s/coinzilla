import { toResult } from "@coinzilla/utils"
import { acquireHarvesterProcessLock } from "./acquire-harvester-process-lock.js"

function getErrors({ result, fallbackMessage }) {
  if (Array.isArray(result?.errors) && result.errors.length > 0) return result.errors
  return [new Error(fallbackMessage)]
}

/**
 * Acquire the broker-wide host lock before the configured Journal lock.
 * The host lock remains held whenever Journal-lock release is uncertain.
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
      const errors = getErrors({
        result: journalLock,
        fallbackMessage: "Unable to acquire the Journal-directory Harvester trading lock",
      })
      try {
        const released = await hostLock.release({})
        if (released?.ok !== true) {
          errors.push(...getErrors({
            result: released,
            fallbackMessage: "Unable to release the broker-wide lock after Journal lock acquisition failed",
          }))
        }
      } catch (error) {
        errors.push(error)
      }
      return toResult({
        error: errors.length === 1
          ? errors[0]
          : new AggregateError(errors, "Harvester trading lock acquisition failed"),
      })
    }

    let journalReleased = false
    let hostReleased = false
    const release = async ({} = {}) => {
      if (journalReleased && hostReleased) {
        return toResult({ released: false, alreadyReleased: true })
      }

      if (!journalReleased) {
        try {
          const result = await journalLock.release({})
          if (result?.ok !== true) {
            return toResult({
              error: new AggregateError(
                getErrors({
                  result,
                  fallbackMessage: "Harvester Journal-directory lock release did not complete",
                }),
                "Harvester Journal-directory lock release failed; broker-wide lock retained",
              ),
            })
          }
          journalReleased = true
        } catch (error) {
          return toResult({
            error: new AggregateError(
              [error],
              "Harvester Journal-directory lock release failed; broker-wide lock retained",
            ),
          })
        }
      }

      if (!hostReleased) {
        try {
          const result = await hostLock.release({})
          if (result?.ok !== true) {
            return toResult({
              error: new AggregateError(
                getErrors({
                  result,
                  fallbackMessage: "Harvester broker-wide lock release did not complete",
                }),
                "Harvester broker-wide lock release failed",
              ),
            })
          }
          hostReleased = true
        } catch (error) {
          return toResult({ error })
        }
      }

      return toResult({ released: true })
    }

    return toResult({
      lockPath: journalLock.lockPath,
      hostLockPath: hostLock.lockPath,
      owner: hostLock.owner,
      release,
    })
  } catch (error) {
    return toResult({ error })
  }
}
