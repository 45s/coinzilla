import os from "node:os"
import path from "node:path"
import { createFileDurableFactsStore } from "../../infrastructure/durable-facts/create-file-durable-facts-store.js"

export class ProcessOperationalStateStartupError extends Error {
  constructor(message, code, cause) {
    super(message, { cause })
    this.name = "ProcessOperationalStateStartupError"
    this.code = code
  }
}
function resolveOperationalStateDirectory(env) {
  const configured = env?.DURABLE_FACTS_DIRECTORY
  if (configured === undefined) {
    return path.join(os.homedir(), ".coinzilla", "harvester", "recovery-facts")
  }
  if (typeof configured !== "string" || !configured.trim() || configured !== configured.trim() || !path.isAbsolute(configured)) {
    throw new ProcessOperationalStateStartupError(
      "Invalid DURABLE_FACTS_DIRECTORY: expected a non-empty absolute local filesystem path",
      "PROCESS_OPERATIONAL_STATE_DIRECTORY_INVALID",
    )
  }
  return path.resolve(configured)
}

/** Compose the one process-owned ADR-0001 store shared by recovery and operator control. */
export async function prepareProcessOperationalStateStore({
  appConfig, env = process.env, runtimeSessionId, createOperationalStateStore = createFileDurableFactsStore,
} = {}) {
  const recoveryEnabled = appConfig?.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true
  const operatorControlEnabled = appConfig?.operatorControl?.telegram?.enabled === true
  if (!recoveryEnabled && !operatorControlEnabled) {
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
  const directory = resolveOperationalStateDirectory(env)
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
