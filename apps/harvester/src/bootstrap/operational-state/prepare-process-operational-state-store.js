import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { createFileOperationalStateStore } from "../../infrastructure/operational-state/create-file-store.js"
import { resolveOperationalStateDirectory } from "../../infrastructure/operational-state/resolve-directory.js"

export class ProcessOperationalStateStartupError extends Error {
  constructor(...args) {
    const [message, code, cause] = args
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
    store = await createOperationalStateStore({ directory,
runtimeSessionId })
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      `Unable to construct process-owned ADR-0001 operational-state store at ${  directory}`,
      "PROCESS_OPERATIONAL_STATE_STORE_CREATE_FAILED",
      cause,
    )
  }
  if (store === null || typeof store !== "object") {
    throw new ProcessOperationalStateStartupError(
      `Operational-state store factory returned an invalid store at ${  directory}`,
      "PROCESS_OPERATIONAL_STATE_STORE_INVALID",
    )
  }
  return store
}

async function initializeProcessStoreIfEmpty({ store, directory } = {}) {
  if (typeof store.initializeIfEmpty !== "function") {
    return
  }
  let initialization
  try {
    initialization = await store.initializeIfEmpty()
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      `Unable to initialize an empty or inspect the existing Operational State Store at ${  directory}`,
      "PROCESS_OPERATIONAL_STATE_INITIALIZATION_FAILED",
      cause,
    )
  }
  if (initialization?.ok === true && initialization.data?.ready === true) {
    return
  }
  const cause = initialization?.errors?.[0] ?? new Error("Operational State Store initialization was not confirmed")
  throw new ProcessOperationalStateStartupError(
    `Harvester could not prepare the Operational State Store at ${directory}: ${cause.message ?? String(cause)}. A missing or empty directory is initialized automatically; an existing directory must contain both facts.jsonl and manifest.jsonl. Partial or corrupt history was not changed. Preserve the directory and restore both streams from one verified backup before retrying.`,
    "PROCESS_OPERATIONAL_STATE_INITIALIZATION_FAILED",
    cause,
  )
}

async function verifyProcessStore({ store, directory } = {}) {
  if (typeof store.verify !== "function") {
    throw new ProcessOperationalStateStartupError(
      "Operational State Store requires verify() before broker-capable startup",
      "PROCESS_OPERATIONAL_STATE_VERIFY_UNAVAILABLE",
    )
  }
  let verification
  try {
    verification = await store.verify()
  } catch (cause) {
    throw new ProcessOperationalStateStartupError(
      `Unable to verify existing ADR-0001 operational record ledger at ${  directory}`,
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
    `Harvester requires an existing verified ADR-0001 operational record ledger before broker-capable startup at ${  directory}`,
    "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED",
    cause,
  )
}

function hasEnabledRecoverySellerMarket({ recoverySellerConfig } = {}) {
  return recoverySellerConfig?.enabled === true &&
    Object.values(recoverySellerConfig.pairs ?? {}).some((pairConfig) => pairConfig?.enabled === true)
}

function requiresOperationalStateStore({ appConfig } = {}) {
  const processRecoveryEnabled =
    appConfig?.components?.recovery?.enabled !== false &&
    appConfig?.strategies?.[StrategyId.COIN_GRABBER]?.settings?.recovery?.enabled === true
  const recoverySellerEnabled = hasEnabledRecoverySellerMarket({
    recoverySellerConfig: appConfig?.strategies?.[StrategyId.RECOVERY_SELLER],
  })
  return processRecoveryEnabled || recoverySellerEnabled
}

/**
 * Prepare and verify the process-owned ADR-0001 store when CG process recovery
 * is enabled or an enabled Recovery Seller market requires durable STOP facts.
 *
 * Telegram-only operator control does not create or require this store.
 * Startup initializes only a missing or empty ledger directory, verifies an
 * existing complete ledger, and never repairs or replaces existing data.
 */
export async function prepareProcessOperationalStateStore({
  appConfig, env = process.env, runtimeSessionId, createOperationalStateStore = createFileOperationalStateStore,
} = {}) {
  if (!requiresOperationalStateStore({ appConfig })) {
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
  await initializeProcessStoreIfEmpty({
    store,
    directory,
  })
  await verifyProcessStore({
    store,
    directory,
  })
  return store
}
