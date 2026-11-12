import path from "node:path"
import { createHarvesterOperator } from "../../application/operator/create-harvester-operator.js"
import { createFileDurableFactsStore } from "../../infrastructure/durable-facts/create-file-durable-facts-store.js"
import { createTelegramOperatorAdapter } from "../../infrastructure/telegram/telegram-operator-adapter.js"

export class OperatorControlStartupError extends Error {
  constructor(message, code, cause) {
    super(message, { cause })
    this.name = "OperatorControlStartupError"
    this.code = code
  }
}

const disabledLifecycle = Object.freeze({
  enabled: false,
  durableFactsStore: undefined,
  async start() { return Object.freeze({ started: false, disabled: true }) },
  async stop() { return Object.freeze({ stopped: true, alreadyStopped: true }) },
})

/** Prepare optional Telegram control after verifying the pre-initialized ADR-0001 store. */
export async function prepareTelegramOperatorControl({
  telegramConfig, env = process.env, runtimeSessionId, durableFactsStore: suppliedDurableFactsStore,
  createDurableFactsStore = createFileDurableFactsStore,
  createAdapter = createTelegramOperatorAdapter, fetchImpl, logger,
} = {}) {
  if (telegramConfig?.enabled !== true) {
    return disabledLifecycle
  }
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim()
  if (!botToken) {
    throw new OperatorControlStartupError("Telegram operator control is enabled but TELEGRAM_BOT_TOKEN is missing", "OPERATOR_CONTROL_TELEGRAM_TOKEN_REQUIRED")
  }
  const directory = env.DURABLE_FACTS_DIRECTORY?.trim()
  let durableFacts = suppliedDurableFactsStore
  if (durableFacts === undefined) {
    if (!directory || !path.isAbsolute(directory)) {
      throw new OperatorControlStartupError("Telegram operator control requires an absolute DURABLE_FACTS_DIRECTORY containing an initialized ADR-0001 store", "OPERATOR_CONTROL_DURABLE_FACTS_DIRECTORY_REQUIRED")
    }
    if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
      throw new OperatorControlStartupError("Telegram operator control requires the current Harvester runtime session identity", "OPERATOR_CONTROL_RUNTIME_SESSION_REQUIRED")
    }
    try {
      durableFacts = createDurableFactsStore({ directory, runtimeSessionId })
    } catch (cause) {
      throw new OperatorControlStartupError("Unable to construct the configured ADR-0001 durable-facts store", "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID", cause)
    }
  } else if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
    throw new OperatorControlStartupError("Telegram operator control requires the current Harvester runtime session identity", "OPERATOR_CONTROL_RUNTIME_SESSION_REQUIRED")
  }
  if (runtimeSessionId !== undefined &&
      durableFacts?.runtimeSessionId !== undefined &&
      durableFacts.runtimeSessionId !== runtimeSessionId) {
    throw new OperatorControlStartupError(
      "Telegram operator control must share the current Harvester process-session durable-facts store",
      "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID",
    )
  }
  if (typeof durableFacts?.verify !== "function" || typeof durableFacts?.append !== "function") {
    throw new OperatorControlStartupError("Configured ADR-0001 durable-facts store does not expose verify() and append()", "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID")
  }
  let verification
  try {
    verification = await durableFacts.verify()
  } catch (cause) {
    throw new OperatorControlStartupError("Unable to verify the initialized ADR-0001 durable-facts store; operator control remains disabled", "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID", cause)
  }
  if (verification?.ok !== true || verification.data?.valid !== true || verification.data?.durableWriteSupported !== true) {
    const cause = verification?.errors?.[0] ?? new Error("Durable-facts verification did not confirm a valid durable store")
    throw new OperatorControlStartupError("Configured ADR-0001 durable-facts store is missing, uninitialized, corrupt or not durably writable", "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID", cause)
  }
  let adapter
  return Object.freeze({
    enabled: true,
    durableFactsStore: durableFacts,
    async start({ engine } = {}) {
      if (adapter) {
        return Object.freeze({ started: true, alreadyStarted: true })
      }
      const operator = createHarvesterOperator({ engine, durableFacts })
      try {
        adapter = createAdapter({ botToken, allowedUserIds: telegramConfig.allowedUserIds, operator, fetchImpl, logger })
        if (typeof adapter?.start !== "function" || typeof adapter?.stop !== "function") {
          throw new TypeError("Telegram operator adapter must expose start() and stop()")
        }
        await adapter.start()
        return Object.freeze({ started: true, alreadyStarted: false })
      } catch (cause) {
        let failure = cause
        let cleanupConfirmed = false
        if (typeof adapter?.stop === "function") {
          try {
            await adapter.stop()
            cleanupConfirmed = true
          } catch (cleanupError) {
            failure = new AggregateError([cause, cleanupError], "Telegram operator startup and cleanup both failed")
          }
        }
        if (cleanupConfirmed || !adapter) {
          adapter = undefined
        }
        throw new OperatorControlStartupError("Telegram operator adapter failed to authenticate or start; Harvester startup is aborted", "OPERATOR_CONTROL_TELEGRAM_START_FAILED", failure)
      }
    },
    async stop() {
      if (!adapter) {
        return Object.freeze({ stopped: true, alreadyStopped: true })
      }
      const activeAdapter = adapter
      try {
        const result = await activeAdapter.stop()
        if (result?.ok === false || result?.stopped === false) {
          throw new Error("Telegram adapter did not confirm that polling stopped")
        }
        adapter = undefined
        return result
      } catch (error) {
        throw new OperatorControlStartupError("Telegram operator adapter did not confirm shutdown", "OPERATOR_CONTROL_TELEGRAM_STOP_FAILED", error)
      }
    },
  })
}
