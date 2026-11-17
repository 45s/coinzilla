import { createTelegramCallApi } from "./telegram-operator-transport.js"
import { createTelegramOperatorHandlers } from "./telegram-operator-handlers.js"
import { pollTelegramOperatorUpdates } from "./telegram-operator-updates.js"
import {
  startTelegramOperatorAdapter,
  stopTelegramOperatorAdapter,
} from "./telegram-operator-lifecycle.js"

const DEFAULT_POLL_TIMEOUT_SECONDS = 30
const DEFAULT_RETRY_DELAY_MS = 1000

export { parseTelegramOperatorCommand } from "./telegram-operator-commands.js"

function validateTelegramOperatorOptions({
  botToken,
  allowedUserIds,
  operator,
  fetchImpl,
  pollTimeoutSeconds,
  retryDelayMs,
}) {
  if (typeof botToken !== "string" || botToken.trim() === "") {
    throw new TypeError("Telegram operator adapter requires a bot token")
  }
  if (!Array.isArray(allowedUserIds) || allowedUserIds.length === 0 ||
      allowedUserIds.some((value) => {
        if (typeof value !== "string" || !/^\d+$/.test(value)) { return true }
        const numericValue = Number(value)
        return !Number.isSafeInteger(numericValue) || numericValue <= 0
      })) {
    throw new TypeError("Telegram operator adapter requires a non-empty decimal user-ID allowlist")
  }
  if (typeof operator?.pauseMarket !== "function") {
    throw new TypeError("Telegram operator adapter requires the Harvester pauseMarket use case")
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Telegram operator adapter requires a fetch implementation")
  }
  if (!Number.isSafeInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 1 || pollTimeoutSeconds > 50) {
    throw new RangeError("Telegram operator poll timeout must be an integer from 1 to 50 seconds")
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1) {
    throw new RangeError("Telegram operator retry delay must be a positive integer")
  }
}

export function createTelegramOperatorAdapter({
  botToken,
  allowedUserIds,
  operator,
  fetchImpl = globalThis.fetch,
  logger,
  pollTimeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  validateTelegramOperatorOptions({
    botToken,
    allowedUserIds,
    operator,
    fetchImpl,
    pollTimeoutSeconds,
    retryDelayMs,
  })
  const allowedUsers = new Set(allowedUserIds.map((value) => String(Number(value))))
  const state = {
    botUsername: undefined,
    offsetState: { value: undefined },
    controller: undefined,
    pollPromise: undefined,
    startPromise: undefined,
    stopPromise: undefined,
  }
  const callApi = createTelegramCallApi({
    botToken,
    fetchImpl,
  })
  const handlers = createTelegramOperatorHandlers({
    botToken,
    operator,
    allowedUsers,
    callApi,
    logger,
    getBotUsername: () => state.botUsername,
  })
  const poll = ({ signal }) => pollTelegramOperatorUpdates({
    signal,
    offsetState: state.offsetState,
    botUsername: state.botUsername,
    callApi,
    respondToUpdate: handlers.respondToUpdate,
    diagnostics: handlers.diagnostics,
    logger,
    retryDelayMs,
    pollTimeoutSeconds,
    logStage: handlers.logStage,
  })
  return Object.freeze({
    start: () => startTelegramOperatorAdapter({
      state,
      callApi,
      logger,
      diagnostics: handlers.diagnostics,
      poll,
    }),
    stop: () => stopTelegramOperatorAdapter({
      state,
      pendingConfirmations: handlers.pendingConfirmations,
    }),
  })
}