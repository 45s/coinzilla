import { createHarvesterOperator } from "../../application/operator/create-harvester-operator.js"
import { createTelegramOperatorAdapter } from "../../infrastructure/telegram/telegram-operator-adapter.js"

export class OperatorControlStartupError extends Error {
  constructor(...args) {
    const [message, code, cause] = args
    const detail = cause?.message
    super(detail ? `${message}: ${detail}` : message, { cause })
    this.name = "OperatorControlStartupError"
    this.code = code
  }
}

const disabledLifecycle = Object.freeze({
  enabled: false,
  operationalStateStore: undefined,
  async start() {
    return Object.freeze({
      started: false,
      disabled: true,
    })
  },
  async stop() {
    return Object.freeze({
      stopped: true,
      alreadyStopped: true,
    })
  },
})

function createAdapterStartHandler({
  getAdapter,
  setAdapter,
  botToken,
  telegramConfig,
  createAdapter,
  fetchImpl,
  logger,
} = {}) {
  return async function startTelegramAdapter({
    engine,
    getRuntimeSnapshot,
    getPortfolio,
    getRecoveryLedger,
    getAccountSnapshot,
    getOpenOrders,
    recoverySellerStopWorkflow,
  } = {}) {
    if (getAdapter()) {
      return Object.freeze({
        started: true,
        alreadyStarted: true,
      })
    }
    const operator = createHarvesterOperator({
      engine,
      getRuntimeSnapshot,
      getPortfolio,
      getRecoveryLedger,
      getAccountSnapshot,
      getOpenOrders,
      recoverySellerStopWorkflow,
    })
    try {
      const adapter = createAdapter({
        botToken,
        allowedUserIds: telegramConfig.allowedUserIds,
        operator,
        fetchImpl,
        logger,
      })
      setAdapter(adapter)
      if (typeof adapter?.start !== "function" || typeof adapter?.stop !== "function") {
        throw new TypeError("Telegram operator adapter must expose start() and stop()")
      }
      await adapter.start()
      return Object.freeze({
        started: true,
        alreadyStarted: false,
      })
    } catch (cause) {
      const adapter = getAdapter()
      let failure = cause
      let cleanupConfirmed = false
      if (typeof adapter?.stop === "function") {
        try {
          await adapter.stop()
          cleanupConfirmed = true
        } catch (cleanupError) {
          failure = new AggregateError(
            [cause, cleanupError],
            "Telegram operator startup and cleanup both failed",
          )
        }
      }
      if (cleanupConfirmed || !adapter) {
        setAdapter(undefined)
      }
      throw new OperatorControlStartupError(
        "Telegram operator adapter failed to authenticate or start; Harvester startup is aborted",
        "OPERATOR_CONTROL_TELEGRAM_START_FAILED",
        failure,
      )
    }
  }
}

function createAdapterStopHandler({ getAdapter, setAdapter } = {}) {
  return async function stopTelegramAdapter() {
    const adapter = getAdapter()
    if (!adapter) {
      return Object.freeze({
        stopped: true,
        alreadyStopped: true,
      })
    }
    try {
      const result = await adapter.stop()
      if (result?.ok === false || result?.stopped === false) {
        throw new Error("Telegram adapter did not confirm that polling stopped")
      }
      setAdapter(undefined)
      return result
    } catch (error) {
      throw new OperatorControlStartupError(
        "Telegram operator adapter did not confirm shutdown",
        "OPERATOR_CONTROL_TELEGRAM_STOP_FAILED",
        error,
      )
    }
  }
}

function createEnabledLifecycle({
  botToken,
  telegramConfig,
  operationalStateStore,
  createAdapter,
  fetchImpl,
  logger,
} = {}) {
  let adapter
  const getAdapter = () => adapter
  const setAdapter = (nextAdapter) => {
    adapter = nextAdapter
  }
  return Object.freeze({
    enabled: true,
    operationalStateStore,
    start: createAdapterStartHandler({
      getAdapter,
      setAdapter,
      botToken,
      telegramConfig,
      createAdapter,
      fetchImpl,
      logger,
    }),
    stop: createAdapterStopHandler({
      getAdapter,
      setAdapter,
    }),
  })
}

/**
 * Prepare Telegram operator control. The application bootstrap owns durable
 * Operational State Store construction and supplies the verified store here.
 */
export async function prepareTelegramOperatorControl({
  telegramConfig,
  env = process.env,
  operationalStateStore,
  createAdapter = createTelegramOperatorAdapter,
  fetchImpl,
  logger,
} = {}) {
  if (telegramConfig?.enabled !== true) {
    return disabledLifecycle
  }
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim()
  if (!botToken) {
    throw new OperatorControlStartupError(
      "Telegram operator control is enabled but TELEGRAM_BOT_TOKEN is missing",
      "OPERATOR_CONTROL_TELEGRAM_TOKEN_REQUIRED",
    )
  }
  return createEnabledLifecycle({
    botToken,
    telegramConfig,
    operationalStateStore,
    createAdapter,
    fetchImpl,
    logger,
  })
}
