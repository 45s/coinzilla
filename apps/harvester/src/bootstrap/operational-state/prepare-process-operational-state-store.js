import { createFileOperationalStateStore } from "../../infrastructure/operational-state/create-file-operational-state-store.js"
import { resolveOperationalStateDirectory } from "../../infrastructure/operational-state/resolve-operational-state-directory.js"

export class ProcessOperationalStateStartupError extends Error {
  constructor(message, code, cause) {
    super(message, { cause })
    this.name = "ProcessOperationalStateStartupError"
    this.code = code
  }
}

function assertStoreDependencies({ runtimeSessionId, createOperationalStateStore } = {}) {
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
    throw new ProcessOperationalStateStartupError(
      "Cannot prepare process operational-state store: runtimeSessionId is missing or invalid",
      "PROCESS_OPERATIONAL_STATE_SESSION_ID_INVALID",
    )
  }
  if (typeof createOperationalStateStore !== "function") {
    throw new ProcessOperationalStateStartupError(
      "Cannot prepare process operational-state store: createOperationalStateStore must be a function",
      "PROCESS_OPERATIONAL_STATE_FACTORY_INVALID",
    )
  }
}

function resolveStoreDirectory({ env } = {}) {
  try {
    return resolveOperationalStateDirectory({ env })
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      "Invalid OPERATIONAL_STATE_DIRECTORY for the process-owned Operational State Store",
      "PROCESS_OPERATIONAL_STATE_DIRECTORY_INVALID",
      cause,
    )
  }
}

async function createProcessStore({ directory, runtimeSessionId, createOperationalStateStore } = {}) {
  let store
  try {
    store = await createOperationalStateStore({ directory, runtimeSessionId })
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      "Unable to construct process-owned ADR-0001 operational-state store at " + directory,
      "PROCESS_OPERATIONAL_STATE_STORE_CREATE_FAILED",
      cause,
    )
  }
  if (store === null || typeof store !== "object") {
    throw new ProcessOperationalStateStartupError(
      "Operational-state store factory returned an invalid store at " + directory,
      "PROCESS_OPERATIONAL_STATE_STORE_INVALID",
    )
  }
  return store
}

async function verifyProcessStore({ store, directory } = {}) {
  if (typeof store.verify !== "function") {
    throw new ProcessOperationalStateStartupError(
      "Restart recovery requires verify() on the process-owned ADR-0001 operational-state store",
      "PROCESS_OPERATIONAL_STATE_VERIFY_UNAVAILABLE",
    )
  }
  let verification
  try {
    verification = await store.verify()
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      "Unable to verify existing ADR-0001 operational record ledger at " + directory,
      "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED",
      cause,
    )
  }
  if (verification?.ok === true &&
      verification.data?.valid === true &&
      verification.data?.durableWriteSupported === true) {
    return
  }
  const cause = verification?.errors?.[0] ?? new Error("Verification did not confirm a valid, durably writable ledger")
  throw new ProcessOperationalStateStartupError(
    "Restart recovery requires an existing verified ADR-0001 operational record ledger at " + directory,
    "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED",
    cause,
  )
}

/**
 * Compose the process-owned ADR-0001 store only for CoinGrabber restart recovery.
 *
 * TEMPORARY: Telegram CC alone must not create or require this store. Without an
 * independently supplied store, its pause/resume commands remain process-local.
 */
export async function prepareProcessOperationalStateStore({
  appConfig, env = process.env, runtimeSessionId, createOperationalStateStore = createFileOperationalStateStore,
} = {}) {
  const recoveryEnabled = appConfig?.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true
  if (!recoveryEnabled) {
    return undefined
  }
  assertStoreDependencies({
    runtimeSessionId,
    createOperationalStateStore,
  })
  const directory = resolveStoreDirectory({
    env,
  })
  const store = await createProcessStore({
    directory,
    runtimeSessionId,
    createOperationalStateStore,
  })
  await verifyProcessStore({
    store,
    directory,
  })
  return store
}
