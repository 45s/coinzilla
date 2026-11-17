import { createTelegramCallApi } from "./telegram-operator-transport.js"
import { createTelegramOperatorHandlers } from "./telegram-operator-handlers.js"
import { pollTelegramOperatorUpdates } from "./telegram-operator-updates.js"

const DEFAULT_POLL_TIMEOUT_SECONDS = 30
const DEFAULT_RETRY_DELAY_MS = 1000

export { parseTelegramOperatorCommand } from "./telegram-operator-commands.js"

/**
 * Create the optional inbound Telegram adapter for the Harvester operator API.
 *
 * This adapter authenticates Telegram senders using a private-chat user-ID
 * allowlist, then calls the transport-independent application use case. It
 * owns no trading state and never accesses the broker or Journal.
 *
 * @param {object} options
 * @param {string} options.botToken - Telegram bot token from the process environment.
 * @param {string[]} options.allowedUserIds - Decimal Telegram user-ID allowlist.
 * @param {{pauseMarket: Function, resumeMarket?: Function}} options.operator - Harvester application facade.
 * @param {Function} [options.fetchImpl=globalThis.fetch] - Injectable fetch implementation.
 * @param {object} [options.logger] - Optional structured logger.
 * @param {number} [options.pollTimeoutSeconds=30] - Telegram long-poll timeout.
 * @param {number} [options.retryDelayMs=1000] - Initial transport retry delay.
 * @returns {{start: Function, stop: Function}} Adapter lifecycle.
 */
export function createTelegramOperatorAdapter({
  botToken,
  allowedUserIds,
  operator,
  fetchImpl = globalThis.fetch,
  logger,
  pollTimeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  if (typeof botToken !== "string" || botToken.trim() === "") {
    throw new TypeError("Telegram operator adapter requires a bot token")
  }
  if (!Array.isArray(allowedUserIds) || allowedUserIds.length === 0 ||
      allowedUserIds.some((value) => {
        if (typeof value !== "string" || !/^\d+$/.test(value)) {return true}
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

  const allowedUsers = new Set(allowedUserIds.map((value) => String(Number(value))))
  let botUsername
  const offsetState = { value: undefined }
  let controller
  let pollPromise
  let startPromise
  let stopPromise

    const callApi = createTelegramCallApi({ botToken, fetchImpl })
  const {
    respondToUpdate,
    logStage,
    pendingConfirmations,
    diagnostics,
  } = createTelegramOperatorHandlers({
    botToken,
    operator,
    allowedUsers,
    callApi,
    logger,
    getBotUsername: () => botUsername,
  })
  const poll = ({ signal }) => pollTelegramOperatorUpdates({
    signal,
    offsetState,
    botUsername,
    callApi,
    respondToUpdate,
    diagnostics,
    logger,
    retryDelayMs,
    pollTimeoutSeconds,
    logStage,
  })

  return Object.freeze({
    async start() {
      if (stopPromise) {await stopPromise}
      if (startPromise) {return startPromise}
      if (controller) {
        return Object.freeze({
          started: true,
          alreadyStarted: true,
        })
      }

      const nextController = new AbortController()
      controller = nextController
      startPromise = (async () => {
        try {
          const identity = await callApi({
            method: "getMe",
            payload: {},
            signal: nextController.signal,
          })
          if (nextController.signal.aborted) {
            throw new Error("Telegram operator adapter startup was aborted")
          }
          if (typeof identity?.username !== "string" || identity.username.trim() === "") {
            throw new TypeError("Telegram getMe response is missing the bot username")
          }
          botUsername = identity.username
          try {
            await callApi({
              method: "setMyCommands",
              payload: { commands: [
                {
                  command: "start",
                  description: "Open the Harvester Command Center",
                },
                {
                  command: "menu",
                  description: "Restore the persistent Command Center keyboard",
                },
                {
                  command: "help",
                  description: "Show commands and safety notes",
                },
                {
                  command: "status",
                  description: "Read runtime readiness and blockers",
                },
                {
                  command: "markets",
                  description: "Read configured market state",
                },
                {
                  command: "positions",
                  description: "Read positions and recovery accounting",
                },
                {
                  command: "orders",
                  description: "Read Harvester and external open orders",
                },
                {
                  command: "balances",
                  description: "Read latest exchange balances",
                },
                {
                  command: "pause",
                  description: "Request a market-scoped operator pause",
                },
                {
                  command: "resume",
                  description: "Request removal of an operator pause",
                },
                {
                  command: "pauseallbuys",
                  description: "Pause all BUYs and cancel Harvester-owned BUY orders",
                },
                {
                  command: "resumeallbuys",
                  description: "Resume BUYs globally",
                },
                {
                  command: "pausebuys",
                  description: "Pause BUYs for one market",
                },
                {
                  command: "resumebuys",
                  description: "Resume BUYs for one market",
                },
              ] },
              signal: nextController.signal,
            })
          } catch (error) {
            if (nextController.signal.aborted) { throw error }
            logger?.warn?.({
              message: "Telegram command menu registration failed; text commands remain available",
              component: "harvester.operator",
              operation: "setMyCommands",
              errorDetails: diagnostics.describeError(error),
            })
          }
          pollPromise = poll({ signal: nextController.signal })
          return Object.freeze({
            started: true,
            alreadyStarted: false,
          })
        } catch (error) {
          nextController.abort()
          if (controller === nextController) {controller = undefined}
          throw error
        } finally {
          startPromise = undefined
        }
      })()
      return startPromise
    },
    async stop() {
      if (stopPromise) {return stopPromise}
      if (!controller) {
        if (startPromise) {await startPromise.catch(() => {})}
        if (!controller) {
          return Object.freeze({
            stopped: true,
            alreadyStopped: true,
          })
        }
      }
      const activeController = controller
      activeController.abort()
      stopPromise = (async () => {
        if (startPromise) {await startPromise.catch(() => {})}
        if (pollPromise) {await pollPromise}
        if (controller === activeController) {controller = undefined}
        pollPromise = undefined
        pendingConfirmations.clear()
        botUsername = undefined
        offsetState.value = undefined
        return Object.freeze({
          stopped: true,
          alreadyStopped: false,
        })
      })()
      try {
        return await stopPromise
      } finally {
        stopPromise = undefined
      }
    },
  })
}
