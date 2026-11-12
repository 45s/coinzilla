import {
  formatTelegramOperatorMarkets,
  formatTelegramOperatorStatus,
  formatTelegramOperatorPositions,
  formatTelegramOperatorOrders,
  formatTelegramOperatorBalances,
} from "./format-telegram-operator-response.js"

const DEFAULT_POLL_TIMEOUT_SECONDS = 30
const DEFAULT_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30000

function normalizeTelegramUserId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numericValue = Number(value)
    if (Number.isSafeInteger(numericValue) && numericValue > 0) {return String(numericValue)}
  }
  return undefined
}

function waitForRetry({ milliseconds, signal }) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
    if (signal.aborted) {finish()}
  })
}

/**
 * Parse the deliberately small initial Telegram command vocabulary.
 *
 * @param {string} text - Telegram message text.
 * @param {object} [options]
 * @param {string} [options.botUsername] - Username returned by Telegram getMe.
 * @returns {{type: string, symbol?: string}} Transport-neutral parse result.
 */
export function parseTelegramOperatorCommand(text, { botUsername } = {}) {
  if (typeof text !== "string" || text.trim() === "" || !text.trim().startsWith("/")) {
    return Object.freeze({ type: "IGNORE" })
  }

  const [commandToken, ...argumentsList] = text.trim().split(/\s+/)
  const commandParts = commandToken.split("@")
  if (commandParts.length > 2) {return Object.freeze({ type: "INVALID" })}
  const [command, targetUsername] = commandParts
  if (targetUsername !== undefined &&
      (typeof botUsername !== "string" || targetUsername.toLowerCase() !== botUsername.toLowerCase())) {
    return Object.freeze({ type: "IGNORE" })
  }
  if (command === "/start" || command === "/help") {
    return argumentsList.length === 0
      ? Object.freeze({ type: "HELP" })
      : Object.freeze({ type: "INVALID" })
  }
  if (["/status", "/markets", "/positions", "/orders", "/balances"].includes(command)) {
    if (argumentsList.length !== 0) {
      return Object.freeze({ type: "INVALID", command: command.slice(1).toUpperCase() })
    }
    return Object.freeze({ type: ({ "/status": "STATUS", "/markets": "MARKETS", "/positions": "POSITIONS", "/orders": "ORDERS", "/balances": "BALANCES" })[command] })
  }
  if (command !== "/pause" && command !== "/resume") {return Object.freeze({ type: "UNSUPPORTED" })}
  if (argumentsList.length !== 1 || !/^[A-Za-z0-9]{2,30}$/.test(argumentsList[0])) {
    return Object.freeze({ type: "INVALID", command: command.slice(1).toUpperCase() })
  }
  return Object.freeze({ type: command === "/pause" ? "PAUSE" : "RESUME", symbol: argumentsList[0].toUpperCase() })
}

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
  let offset
  let controller
  let pollPromise
  let startPromise
  let stopPromise

  const callApi = async ({ method, payload, signal }) => {
    let response
    try {
      response = await fetchImpl("https://api.telegram.org/bot" + botToken + "/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (cause) {
      const error = new Error("Telegram API request failed: " + method, { cause })
      throw error
    }

    let body
    try {
      body = await response.json()
    } catch (cause) {
      throw new Error("Telegram API returned invalid JSON: " + method, { cause })
    }
    if (!response.ok || body?.ok !== true) {
      const error = new Error("Telegram API " + method + " failed (HTTP " + response.status + ")")
      if (Number.isSafeInteger(body?.parameters?.retry_after) && body.parameters.retry_after > 0) {
        error.retryAfter = body.parameters.retry_after
      }
      throw error
    }
    return body.result
  }

  const sendMessage = ({ chatId, text, signal }) =>
    callApi({
      method: "sendMessage",
      payload: { chat_id: chatId, text },
      signal,
    })

  const respondToUpdate = async ({ update, signal }) => {
    const message = update.message
    if (!message || message.chat?.type !== "private" || message.from?.is_bot === true) {return}
    const userId = normalizeTelegramUserId(message.from?.id)
    const privateChatUserId = normalizeTelegramUserId(message.chat.id)
    if (!userId || privateChatUserId !== userId) {return}

    const parsed = parseTelegramOperatorCommand(message.text, { botUsername })
    if (parsed.type === "IGNORE") {return}
    if (!allowedUsers.has(userId)) {
      await sendMessage({ chatId: message.chat.id, text: "Not authorized.", signal })
      return
    }
    if (parsed.type === "HELP") {
      await sendMessage({
        chatId: message.chat.id,
        text: [
          "Harvester Command Center",
          "/start — show this help",
          "/status — runtime readiness and blockers",
          "/markets — configured market prices, freshness and blockers",
          "/positions — canonical active and retained inventory with recovery accounting",
          "/orders — Harvester-owned and external open orders",
          "/balances — latest exchange free and locked balances with snapshot age",
          "/pause SYMBOL — block new strategy BUYs for one market",
          "/resume SYMBOL — remove only the operator pause when safety permits",
          "/help — show this help",
          "",
          "Operator pause does not cancel existing orders. Existing orders may still fill; accounting and recovery SELLs continue.",
        ].join("\n"),
        signal,
      })
      return
    }
    if (["STATUS", "MARKETS", "POSITIONS", "ORDERS", "BALANCES"].includes(parsed.type)) {
      const method = ({ STATUS: "getStatus", MARKETS: "getMarkets", POSITIONS: "getPositions", ORDERS: "getOrders", BALANCES: "getBalances" })[parsed.type]
      if (typeof operator[method] !== "function") {
        await sendMessage({
          chatId: message.chat.id,
          text: "This read-only query is not available in the current operator configuration.",
          signal,
        })
        return
      }
      let result
      try {
        result = await operator[method]({
          actor: {
            id: "telegram-user:" + userId,
            roles: ["trading-operator"],
          },
        })
      } catch (error) {
        logger?.error?.({
          message: "Telegram operator read query failed",
          component: "harvester.operator",
          operation: method,
          error,
        })
        result = { ok: false }
      }
      if (result?.ok !== true) {
        logger?.error?.({
          message: "Telegram operator read query returned a failure",
          component: "harvester.operator",
          operation: method,
          error: result?.errors ?? result?.error ?? "Unclassified query failure",
        })
        await sendMessage({
          chatId: message.chat.id,
          text: "Unable to read the Harvester " + ({ STATUS: "runtime status", MARKETS: "market snapshot", POSITIONS: "position snapshot", ORDERS: "order snapshot", BALANCES: "balance snapshot" })[parsed.type] +
            ". No trading state was changed; check Harvester diagnostics.",
          signal,
        })
        return
      }
      const reply = ({
        STATUS: () => formatTelegramOperatorStatus({ status: result.data }),
        MARKETS: () => formatTelegramOperatorMarkets({ snapshot: result.data }),
        POSITIONS: () => formatTelegramOperatorPositions({ snapshot: result.data }),
        ORDERS: () => formatTelegramOperatorOrders({ snapshot: result.data }),
        BALANCES: () => formatTelegramOperatorBalances({ snapshot: result.data }),
      })[parsed.type]()
      await sendMessage({ chatId: message.chat.id, text: reply, signal })
      return
    }

    if (parsed.type === "UNSUPPORTED") {
      await sendMessage({
        chatId: message.chat.id,
        text: "Unknown command. Use /help to see available commands.",
        signal,
      })
      return
    }
    if (parsed.type === "INVALID") {
      await sendMessage({
        chatId: message.chat.id,
        text: parsed.command === "RESUME" || parsed.command === "PAUSE"
          ? "Usage: /" + parsed.command.toLowerCase() + " <SYMBOL>. Use /help for commands."
          : "Usage: /" + String(parsed.command ?? "command").toLowerCase() + " with no arguments. Use /help for commands.",
        signal,
      })
      return
    }

    const requestId = "telegram:" + update.update_id + ":" + (message.date ?? "0") + ":" + userId
    if (parsed.type === "RESUME" && typeof operator.resumeMarket !== "function") {
      await sendMessage({ chatId: message.chat.id, text: "Resume is not available in this operator adapter configuration.", signal })
      return
    }

    let result
    try {
      result = await operator[parsed.type === "RESUME" ? "resumeMarket" : "pauseMarket"]({
        actor: {
          id: "telegram-user:" + userId,
          roles: ["trading-operator"],
        },
        requestId,
        symbol: parsed.symbol,
      })
    } catch (error) {
      logger?.error?.({
        message: "Telegram operator pause use case threw unexpectedly",
        symbol: parsed.symbol,
        error: error?.message ?? String(error),
      })
      result = { ok: false, errors: [] }
    }

    if (!result?.ok) {
      const code = result?.errors?.[0]?.code
      let reply
      if (code === "INVALID_OPERATOR_MARKET") {
        reply = "Unknown configured market: " + parsed.symbol + "."
      } else if (code === "SAFETY_BLOCKER_ACTIVE") {
        reply = "Cannot resume " + parsed.symbol + ": a safety, recovery, or volatility blocker is still active. The blocker was not changed."
      } else {
        const action = parsed.type === "RESUME" ? "Resume" : "Pause"
        reply = action + " was not acknowledged. Durable state was not committed; check Harvester logs and retry."
      }
      await sendMessage({ chatId: message.chat.id, text: reply, signal })
      return
    }

    let reply
    if (parsed.type === "RESUME") {
      reply = "Resumed " + parsed.symbol + ": the operator-owned pause was removed. Safety, recovery, and volatility controls remain in force."
    } else if (result.data?.alreadyPaused === true) {
      reply = "Already paused " + parsed.symbol + ". New strategy BUYs remain blocked."
    } else {
      reply = "Paused " + parsed.symbol + ": new strategy BUYs and trailing-BUY replacements are blocked. Existing exchange orders remain open and may still fill. Fill accounting and recovery SELLs continue."
    }
    await sendMessage({ chatId: message.chat.id, text: reply, signal })
  }

  const poll = async ({ signal }) => {
    let currentRetryDelay = retryDelayMs
    while (!signal.aborted) {
      try {
        const payload = {
          timeout: pollTimeoutSeconds,
          allowed_updates: ["message"],
        }
        if (offset !== undefined) {payload.offset = offset}
        const updates = await callApi({
          method: "getUpdates",
          payload,
          signal,
        })
        if (!Array.isArray(updates)) {
          throw new TypeError("Telegram getUpdates did not return an update array")
        }
        for (const update of updates) {
          if (signal.aborted) {break}
          if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) {
            throw new TypeError("Telegram update has no valid update_id")
          }
          await respondToUpdate({ update, signal })
          offset = update.update_id + 1
        }
        currentRetryDelay = retryDelayMs
      } catch (error) {
        if (signal.aborted) {break}
        logger?.warn?.({
          message: "Telegram operator polling failed; retrying",
          error: error?.message ?? String(error),
        })
        const retryAfterMs = Number.isSafeInteger(error?.retryAfter)
          ? Math.min(error.retryAfter * 1000, MAX_RETRY_DELAY_MS)
          : currentRetryDelay
        await waitForRetry({ milliseconds: retryAfterMs, signal })
        currentRetryDelay = Math.min(currentRetryDelay * 2, MAX_RETRY_DELAY_MS)
      }
    }
  }

  return Object.freeze({
    async start() {
      if (stopPromise) {await stopPromise}
      if (startPromise) {return startPromise}
      if (controller) {return Object.freeze({ started: true, alreadyStarted: true })}

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
          pollPromise = poll({ signal: nextController.signal })
          return Object.freeze({ started: true, alreadyStarted: false })
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
        if (!controller) {return Object.freeze({ stopped: true, alreadyStopped: true })}
      }
      const activeController = controller
      activeController.abort()
      stopPromise = (async () => {
        if (startPromise) {await startPromise.catch(() => {})}
        if (pollPromise) {await pollPromise}
        if (controller === activeController) {controller = undefined}
        pollPromise = undefined
        botUsername = undefined
        offset = undefined
        return Object.freeze({ stopped: true, alreadyStopped: false })
      })()
      try {
        return await stopPromise
      } finally {
        stopPromise = undefined
      }
    },
  })
}
