import { createFileOperationalStateStore } from "../../infrastructure/operational-state/create-file-operational-state-store.js"
import { resolveOperationalStateDirectory } from "../../infrastructure/operational-state/resolve-operational-state-directory.js"

export class ProcessOperationalStateStartupError extends Error {
  constructor(message, code, cause) {
    super(message, { cause })
    this.name = "ProcessOperationalStateStartupError"
    this.code = code
  }
}

/**
 * Compose the process-owned ADR-0001 store only when process-restart recovery is enabled.
 *
 * TEMPORARY: Telegram CC alone must not create or require this store. When recovery is
 * disabled, operator commands run process-locally unless another caller explicitly
 * supplies an Operational State Store.
 */
export async function prepareProcessOperationalStateStore({
  appConfig, env = process.env, runtimeSessionId, createOperationalStateStore = createFileOperationalStateStore,
} = {}) {
  const recoveryEnabled = appConfig?.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true
  // TEMPORARY: Telegram CC must not create or require the ADR-0001 store.
  // Process-restart recovery remains disabled; re-enable this dependency only after the recovery design is accepted.
  if (!recoveryEnabled) {
    return undefined
  }
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
  let directory
  try {
    directory = resolveOperationalStateDirectory({ env })
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      "Invalid OPERATIONAL_STATE_DIRECTORY for the process-owned Operational State Store",
      "PROCESS_OPERATIONAL_STATE_DIRECTORY_INVALID",
      cause,
    )
  }
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
  if (recoveryEnabled) {
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
    if (verification?.ok !== true || verification.data?.valid !== true || verification.data?.durableWriteSupported !== true) {
      const cause = verification?.errors?.[0] ?? new Error("Verification did not confirm a valid, durably writable ledger")
      throw new ProcessOperationalStateStartupError(
        "Restart recovery requires an existing verified ADR-0001 operational record ledger at " + directory,
        "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED",
        cause,
      )
    }
  }
  return store
}
