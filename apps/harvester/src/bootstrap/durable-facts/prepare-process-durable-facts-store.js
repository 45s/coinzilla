import os from "node:os"
import path from "node:path"
import { createFileDurableFactsStore } from "../../infrastructure/durable-facts/create-file-durable-facts-store.js"

export class ProcessDurableFactsStartupError extends Error {
  constructor(message, code, cause) {
    super(message, { cause })
    this.name = "ProcessDurableFactsStartupError"
    this.code = code
  }
}
function resolveDurableFactsDirectory(env) {
  const configured = env?.DURABLE_FACTS_DIRECTORY
  if (configured === undefined) return path.join(os.homedir(), ".coinzilla", "harvester", "recovery-facts")
  if (typeof configured !== "string" || !configured.trim() || configured !== configured.trim() || !path.isAbsolute(configured)) {
    throw new ProcessDurableFactsStartupError(
      "Invalid DURABLE_FACTS_DIRECTORY: expected a non-empty absolute local filesystem path",
      "PROCESS_DURABLE_FACTS_DIRECTORY_INVALID",
    )
  }
  return path.resolve(configured)
}

/** Compose the one process-owned ADR-0001 store shared by recovery and operator control. */
export async function prepareProcessDurableFactsStore({
  appConfig, env = process.env, runtimeSessionId, createDurableFactsStore = createFileDurableFactsStore,
} = {}) {
  const recoveryEnabled = appConfig?.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true
  const operatorControlEnabled = appConfig?.operatorControl?.telegram?.enabled === true
  if (!recoveryEnabled && !operatorControlEnabled) return undefined
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
    throw new ProcessDurableFactsStartupError(
      "Cannot prepare process durable-facts store: runtimeSessionId is missing or invalid",
      "PROCESS_DURABLE_FACTS_SESSION_ID_INVALID",
    )
  }
  if (typeof createDurableFactsStore !== "function") {
    throw new ProcessDurableFactsStartupError(
      "Cannot prepare process durable-facts store: createDurableFactsStore must be a function",
      "PROCESS_DURABLE_FACTS_FACTORY_INVALID",
    )
  }
  const directory = resolveDurableFactsDirectory(env)
  let store
  try {
    store = await createDurableFactsStore({ directory, runtimeSessionId })
  } catch (cause) {
    throw new ProcessDurableFactsStartupError(
      "Unable to construct process-owned ADR-0001 durable-facts store at " + directory,
      "PROCESS_DURABLE_FACTS_STORE_CREATE_FAILED",
      cause,
    )
  }
  if (store === null || typeof store !== "object") {
    throw new ProcessDurableFactsStartupError(
      "Durable-facts factory returned an invalid store at " + directory,
      "PROCESS_DURABLE_FACTS_STORE_INVALID",
    )
  }
  if (recoveryEnabled) {
    if (typeof store.verify !== "function") {
      throw new ProcessDurableFactsStartupError(
        "Restart recovery requires verify() on the process-owned ADR-0001 durable-facts store",
        "PROCESS_DURABLE_FACTS_VERIFY_UNAVAILABLE",
      )
    }
    let verification
    try {
      verification = await store.verify()
    } catch (cause) {
      throw new ProcessDurableFactsStartupError(
        "Unable to verify existing ADR-0001 durable-facts ledger at " + directory,
        "PROCESS_DURABLE_FACTS_VERIFICATION_FAILED",
        cause,
      )
    }
    if (verification?.ok !== true || verification.data?.valid !== true || verification.data?.durableWriteSupported !== true) {
      const cause = verification?.errors?.[0] ?? new Error("Verification did not confirm a valid, durably writable ledger")
      throw new ProcessDurableFactsStartupError(
        "Restart recovery requires an existing verified ADR-0001 durable-facts ledger at " + directory,
        "PROCESS_DURABLE_FACTS_VERIFICATION_FAILED",
        cause,
      )
    }
  }
  return store
}
