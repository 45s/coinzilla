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

function validateLockDirectories({ journalDirectory, globalDirectory }) {
  if (typeof journalDirectory !== "string" || !journalDirectory.trim()) {
    throw new TypeError("Harvester trading locks require a non-empty Journal directory")
  }
  if (typeof globalDirectory !== "string" || !globalDirectory.trim()) {
    throw new TypeError("Harvester trading locks require a non-empty host lock directory")
  }
}

function validateLockBroker({ broker }) {
  if (typeof broker !== "string" || !/^[a-z0-9-]+$/i.test(broker)) {
    throw new TypeError("Harvester trading lock broker must be a simple broker identifier")
  }
}

function validateAccountLockIdentity({ providerInstanceId, accountId }) {
  if ((providerInstanceId === undefined) !== (accountId === undefined)) {
    throw new TypeError("Harvester process lock providerInstanceId and accountId must be supplied together")
  }
  if (providerInstanceId !== undefined &&
      (typeof providerInstanceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(providerInstanceId))) {
    throw new TypeError("Harvester process lock providerInstanceId must be a stable non-secret identifier")
  }
  if (accountId !== undefined &&
      (typeof accountId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(accountId))) {
    throw new TypeError("Harvester process lock accountId must be a stable non-secret identifier")
  }
}

function validateTradingMode({ tradingMode }) {
  if (tradingMode !== "testnet" && tradingMode !== "live") {
    throw new TypeError('Harvester Binance process lock tradingMode must be "testnet" or "live"')
  }
}

function validateAcquireLock({ acquireLock }) {
  if (typeof acquireLock !== "function") {
    throw new TypeError("Harvester trading lock acquireLock must be a function")
  }
}

function validateProcessLockOptions(options) {
  validateLockDirectories(options)
  validateLockBroker(options)
  validateAccountLockIdentity(options)
  validateTradingMode(options)
  validateAcquireLock(options)
}

/**
 * Derive a stable fingerprint from the broker and explicit trading environment.
 */
function createLockScopeFingerprint({ broker, accountId, tradingMode }) {
  const normalizedBroker = broker.toLowerCase()
  // Keep the legacy primary Binance fingerprint so old and new single-account
  // processes cannot both acquire writer authority during rollout.
  // Account aliases share a lock even when configured through different instances.
  const identity = normalizedBroker === "binance" && accountId === "binance-primary"
    ? [normalizedBroker, tradingMode]
    : [normalizedBroker, accountId, tradingMode]
  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
}

async function acquireScopedLocks({
  acquireLock,
  globalDirectory,
  journalDirectory,
  broker,
  environmentFingerprint,
}) {
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
    return handleJournalLockFailure({ journalLock, hostLock })
  }
  return toResult({ data: { hostLock, journalLock } })
}

export async function acquireHarvesterProcessLocks({
  journalDirectory,
  globalDirectory,
  broker = "binance",
  providerInstanceId,
  accountId,
  tradingMode,
  acquireLock = acquireHarvesterProcessLock,
} = {}) {
  try {
    validateProcessLockOptions({
      journalDirectory,
      globalDirectory,
      broker,
      providerInstanceId,
      accountId,
      tradingMode,
      acquireLock,
    })

    const resolvedProviderInstanceId = providerInstanceId ?? broker.toLowerCase()
    const resolvedAccountId = accountId ?? "binance-primary"
    const environmentFingerprint = createLockScopeFingerprint({
      broker,
      accountId: resolvedAccountId,
      tradingMode,
    })
    const lockResult = await acquireScopedLocks({
      acquireLock,
      globalDirectory,
      journalDirectory,
      broker,
      environmentFingerprint,
    })
    if (lockResult?.ok !== true) {
      return lockResult
    }
    const { hostLock, journalLock } = lockResult.data
    return toResult({
      lockPath: journalLock.lockPath,
      hostLockPath: hostLock.lockPath,
      owner: hostLock.owner,
      lockScope: Object.freeze({
        broker: broker.toLowerCase(),
        providerInstanceId: resolvedProviderInstanceId,
        accountId: resolvedAccountId,
        tradingMode,
        environmentFingerprint,
      }),
      release: createLockRelease({ journalLock, hostLock }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
