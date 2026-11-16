import { createHarvesterOperator } from "../../application/operator/create-harvester-operator.js"
import { createTelegramOperatorAdapter } from "../../infrastructure/telegram/telegram-operator-adapter.js"

export class OperatorControlStartupError extends Error {
  constructor(message, code, cause) {
    const detail = cause?.message
    super(detail ? `${message}: ${detail}` : message, { cause })
    this.name = "OperatorControlStartupError"
    this.code = code
  }
}

const disabledLifecycle = Object.freeze({
  enabled: false,
  operationalStateStore: undefined,
  async start() { return Object.freeze({ started: false, disabled: true }) },
  async stop() { return Object.freeze({ stopped: true, alreadyStopped: true }) },
})

/**
 * Prepare Telegram operator control without restart recovery or durable command history.
 *
 * TEMPORARY: ADR-0001 Operational State Store construction/verification is deliberately
 * bypassed so Telegram CC commands can run independently. Pause/resume changes are
 * process-local only and are lost on restart. Reintroduce durable facts only after the
 * recovery design is explicitly revisited and its startup requirements are accepted.
 */
export async function prepareTelegramOperatorControl({
  telegramConfig, env = process.env, operationalStateStore: suppliedOperationalStateStore,
  createAdapter = createTelegramOperatorAdapter, fetchImpl, logger,
} = {}) {
  if (telegramConfig?.enabled !== true) {
    return disabledLifecycle
  }
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim()
  if (!botToken) {
    throw new OperatorControlStartupError("Telegram operator control is enabled but TELEGRAM_BOT_TOKEN is missing", "OPERATOR_CONTROL_TELEGRAM_TOKEN_REQUIRED")
  }
  // TEMPORARILY DISABLED: Telegram CC does not construct or verify ADR-0001 recovery storage.
  // An independently supplied store may still record process-lifetime operator commands.
  // Without one, pause/resume are process-local and are lost on restart.
  const operationalStateStore = suppliedOperationalStateStore
  let adapter
  return Object.freeze({
    enabled: true,
    operationalStateStore: operationalStateStore,
    async start({ engine, getRuntimeSnapshot, getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders } = {}) {
      if (adapter) {
        return Object.freeze({ started: true, alreadyStarted: true })
      }
      const operator = createHarvesterOperator({ engine, operationalStateStore, getRuntimeSnapshot, getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders })
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
