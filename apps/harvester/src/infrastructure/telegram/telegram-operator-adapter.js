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

  const pendingConfirmations = new Map()
  const CONFIRMATION_TTL_MS = 5 * 60 * 1000
  const PAGE_METHODS = Object.freeze({ status: "getStatus", markets: "getMarkets", positions: "getPositions", orders: "getOrders", balances: "getBalances" })
  const PAGE_TITLES = Object.freeze({ status: "runtime status", markets: "market snapshot", positions: "position snapshot", orders: "order snapshot", balances: "balance snapshot" })

  const sendMessage = ({ chatId, text, replyMarkup, signal }) =>
    callApi({ method: "sendMessage", payload: { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }, signal })

  const editMessage = async ({ chatId, messageId, text, replyMarkup, signal }) => {
    try {
      return await callApi({ method: "editMessageText", payload: { chat_id: chatId, message_id: messageId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }, signal })
    } catch (error) {
      if (/message is not modified/i.test(error?.message ?? "")) { return undefined }
      throw error
    }
  }

  const answerCallback = async ({ callbackId, text, signal }) => {
    try {
      return await callApi({ method: "answerCallbackQuery", payload: { callback_query_id: callbackId, ...(text ? { text } : {}) }, signal })
    } catch (error) {
      if (/query is too old|query id is invalid|query has expired/i.test(error?.message ?? "")) { return undefined }
      throw error
    }
  }

  const navigationKeyboard = ({ page = "home", markets = [] } = {}) => {
    const rows = [
      [{ text: "Status", callback_data: "cc:nav:status" }, { text: "Markets", callback_data: "cc:nav:markets" }],
      [{ text: "Positions", callback_data: "cc:nav:positions" }, { text: "Orders", callback_data: "cc:nav:orders" }],
      [{ text: "Balances", callback_data: "cc:nav:balances" }],
    ]
    if (page === "markets") {
      for (const market of markets.slice(0, 20)) {
        if (typeof market?.symbol !== "string" || !/^[A-Z0-9]{2,30}$/.test(market.symbol) || market.enabled !== true) { continue }
        const action = market.operatorPaused === true ? "RESUME" : "PAUSE"
        rows.push([{ text: (action === "PAUSE" ? "Pause " : "Resume ") + market.symbol, callback_data: "cc:ask:" + action + ":" + market.symbol }])
      }
    }
    rows.push([{ text: "Refresh", callback_data: "cc:refresh:" + (page === "home" ? "home" : page) }, { text: "Main menu", callback_data: "cc:nav:home" }])
    return { inline_keyboard: rows }
  }

  const helpText = () => [
    "Harvester Command Center",
    "/start — show the command center",
    "/status — runtime readiness and blockers",
    "/markets — configured market prices, freshness and blockers",
    "/positions — canonical active and retained inventory with recovery accounting",
    "/orders — Harvester-owned and external open orders",
    "/balances — latest exchange free and locked balances with snapshot age",
    "/pause SYMBOL — request a market-scoped operator pause",
    "/resume SYMBOL — request removal of the operator-owned pause",
    "/help — show this help",
    "",
    "Inline pause/resume buttons always require confirmation. Text control commands are explicit requests.",
    "Operator pause does not cancel existing orders. Existing orders may still fill; accounting and recovery SELLs continue.",
    "Operator pause lasts only for this process and is not restored after restart.",
  ].join("\n")

  const readPage = async ({ page, userId }) => {
    if (page === "home") { return { text: helpText(), keyboard: navigationKeyboard() } }
    const method = PAGE_METHODS[page]
    if (!method || typeof operator[method] !== "function") {
      return { text: "This read-only query is not available in the current operator configuration.", keyboard: navigationKeyboard({ page }) }
    }
    let result
    try {
      result = await operator[method]({ actor: { id: "telegram-user:" + userId, roles: ["trading-operator"] } })
    } catch (error) {
      logger?.error?.({ message: "Telegram operator read query failed", component: "harvester.operator", operation: method, error })
      result = { ok: false }
    }
    if (result?.ok !== true) {
      logger?.error?.({ message: "Telegram operator read query returned a failure", component: "harvester.operator", operation: method, error: result?.errors ?? result?.error ?? "Unclassified query failure" })
      return { text: "Unable to read the Harvester " + PAGE_TITLES[page] + ". No trading state was changed; check Harvester diagnostics.", keyboard: navigationKeyboard({ page }) }
    }
    const text = ({
      status: () => formatTelegramOperatorStatus({ status: result.data }),
      markets: () => formatTelegramOperatorMarkets({ snapshot: result.data }),
      positions: () => formatTelegramOperatorPositions({ snapshot: result.data }),
      orders: () => formatTelegramOperatorOrders({ snapshot: result.data }),
      balances: () => formatTelegramOperatorBalances({ snapshot: result.data }),
    })[page]()
    return { text, keyboard: navigationKeyboard({ page, markets: page === "markets" ? result.data.markets : [] }) }
  }

  const editPage = async ({ page, chatId, messageId, userId, signal }) => {
    const rendered = await readPage({ page, userId })
    await editMessage({ chatId, messageId, text: rendered.text, replyMarkup: rendered.keyboard, signal })
  }

  const executeControl = async ({ action, symbol, userId, requestId, chatId, messageId, signal }) => {
    const method = action === "RESUME" ? "resumeMarket" : "pauseMarket"
    if (typeof operator[method] !== "function") {
      const text = action === "RESUME" ? "Resume is not available in this operator adapter configuration." : "Pause is not available in this operator adapter configuration."
      if (messageId !== undefined) { await editMessage({ chatId, messageId, text, replyMarkup: navigationKeyboard(), signal }) }
      else { await sendMessage({ chatId, text, replyMarkup: navigationKeyboard(), signal }) }
      return
    }
    let result
    try {
      result = await operator[method]({ actor: { id: "telegram-user:" + userId, roles: ["trading-operator"] }, requestId, symbol })
    } catch (error) {
      logger?.error?.({ message: "Telegram operator control use case threw unexpectedly", component: "harvester.operator", operation: method, symbol, error })
      result = { ok: false, errors: [] }
    }
    let reply
    if (!result?.ok) {
      const code = result?.errors?.[0]?.code
      if (code === "INVALID_OPERATOR_MARKET") { reply = "Unknown configured market: " + symbol + "." }
      else if (code === "SAFETY_BLOCKER_ACTIVE") { reply = "Cannot resume " + symbol + ": a safety, recovery, or volatility blocker is still active. The blocker was not changed." }
      else {
        const actionLabel = action === "RESUME" ? "Resume" : "Pause"
        reply = actionLabel + " was not acknowledged. Durable state was not committed; check Harvester logs and retry."
      }
    } else if (action === "RESUME") {
      reply = "Resumed " + symbol + ": the operator-owned pause was removed. Safety, recovery, and volatility controls remain in force."
    } else if (result.data?.alreadyPaused === true) {
      reply = "Already paused " + symbol + ". New strategy BUYs remain blocked."
    } else {
      reply = "Paused " + symbol + ": new strategy BUYs and trailing-BUY replacements are blocked. Existing exchange orders remain open and may still fill. Fill accounting and recovery SELLs continue."
    }
    if (messageId !== undefined) { await editMessage({ chatId, messageId, text: reply, replyMarkup: navigationKeyboard(), signal }) }
    else { await sendMessage({ chatId, text: reply, replyMarkup: navigationKeyboard(), signal }) }
  }

  const respondToCallback = async ({ update, signal }) => {
    const callback = update.callback_query
    const userId = normalizeTelegramUserId(callback?.from?.id)
    const chat = callback?.message?.chat
    const chatId = normalizeTelegramUserId(chat?.id)
    if (!callback || chat?.type !== "private" || !userId || chatId !== userId || !allowedUsers.has(userId) || callback.from?.is_bot === true || typeof callback.id !== "string") { return }
    const messageId = callback.message.message_id
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || typeof callback.data !== "string") {
      await answerCallback({ callbackId: callback.id, text: "Invalid or expired control.", signal })
      return
    }

    const navigation = /^cc:(nav|refresh):(home|status|markets|positions|orders|balances)$/.exec(callback.data)
    if (navigation) {
      await answerCallback({ callbackId: callback.id, signal })
      await editPage({ page: navigation[2], chatId: chat.id, messageId, userId, signal })
      return
    }

    const ask = /^cc:ask:(PAUSE|RESUME):([A-Z0-9]{2,30})$/.exec(callback.data)
    if (ask) {
      const token = String(update.update_id)
      const now = Date.now()
      for (const [pendingToken, pending] of pendingConfirmations) {
        if (pending.expiresAt < now) { pendingConfirmations.delete(pendingToken) }
      }
      while (pendingConfirmations.size >= 1000) { pendingConfirmations.delete(pendingConfirmations.keys().next().value) }
      pendingConfirmations.set(token, { action: ask[1], symbol: ask[2], userId, chatId: String(chat.id), messageId, expiresAt: now + CONFIRMATION_TTL_MS })
      await answerCallback({ callbackId: callback.id, text: "Review the confirmation prompt.", signal })
      await editMessage({
        chatId: chat.id, messageId,
        text: "Confirm " + ask[1].toLowerCase() + " of " + ask[2] + "? No action has been taken yet.",
        replyMarkup: { inline_keyboard: [[
          { text: "Confirm " + ask[1].toLowerCase(), callback_data: "cc:confirm:" + ask[1] + ":" + ask[2] + ":" + token },
          { text: "Cancel", callback_data: "cc:cancel:" + token },
        ], [{ text: "Main menu", callback_data: "cc:nav:home" }]] },
        signal,
      })
      return
    }

    const confirm = /^cc:confirm:(PAUSE|RESUME):([A-Z0-9]{2,30}):(\d+)$/.exec(callback.data)
    if (confirm) {
      const pending = pendingConfirmations.get(confirm[3])
      const valid = pending && pending.action === confirm[1] && pending.symbol === confirm[2] &&
        pending.userId === userId && pending.chatId === String(chat.id) && pending.messageId === messageId &&
        pending.expiresAt >= Date.now()
      pendingConfirmations.delete(confirm[3])
      if (!valid) {
        await answerCallback({ callbackId: callback.id, text: "Confirmation expired or already used. Start again.", signal })
        await editMessage({ chatId: chat.id, messageId, text: "Confirmation expired or already used. No action was taken.", replyMarkup: navigationKeyboard(), signal })
        return
      }
      await answerCallback({ callbackId: callback.id, text: "Processing confirmed action.", signal })
      await executeControl({ action: pending.action, symbol: pending.symbol, userId, requestId: "telegram:callback:" + callback.id, chatId: chat.id, messageId, signal })
      return
    }

    const cancel = /^cc:cancel:(\d+)$/.exec(callback.data)
    if (cancel) {
      const pending = pendingConfirmations.get(cancel[1])
      if (pending && pending.userId === userId && pending.chatId === String(chat.id) && pending.messageId === messageId) { pendingConfirmations.delete(cancel[1]) }
      await answerCallback({ callbackId: callback.id, text: "Cancelled.", signal })
      await editMessage({ chatId: chat.id, messageId, text: "Control action cancelled. No action was taken.", replyMarkup: navigationKeyboard(), signal })
      return
    }
    await answerCallback({ callbackId: callback.id, text: "Unknown or expired action.", signal })
  }

  const respondToUpdate = async ({ update, signal }) => {
    if (update.callback_query) { await respondToCallback({ update, signal }); return }
    const message = update.message
    if (!message || message.chat?.type !== "private" || message.from?.is_bot === true) { return }
    const userId = normalizeTelegramUserId(message.from?.id)
    const privateChatUserId = normalizeTelegramUserId(message.chat.id)
    if (!userId || privateChatUserId !== userId) { return }

    const parsed = parseTelegramOperatorCommand(message.text, { botUsername })
    if (parsed.type === "IGNORE") { return }
    if (!allowedUsers.has(userId)) { await sendMessage({ chatId: message.chat.id, text: "Not authorized.", signal }); return }
    if (parsed.type === "HELP") { await sendMessage({ chatId: message.chat.id, text: helpText(), replyMarkup: navigationKeyboard(), signal }); return }
    if (PAGE_METHODS[parsed.type.toLowerCase()]) {
      const page = parsed.type.toLowerCase()
      const rendered = await readPage({ page, userId })
      await sendMessage({ chatId: message.chat.id, text: rendered.text, replyMarkup: rendered.keyboard, signal })
      return
    }
    if (parsed.type === "UNSUPPORTED") {
      await sendMessage({ chatId: message.chat.id, text: "Unknown command. Use /help to see available commands.", replyMarkup: navigationKeyboard(), signal })
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
    const action = parsed.type === "RESUME" ? "RESUME" : "PAUSE"
    await executeControl({
      action, symbol: parsed.symbol, userId,
      requestId: "telegram:" + update.update_id + ":" + (message.date ?? "0") + ":" + userId,
      chatId: message.chat.id, signal,
    })
  }

  const poll = async ({ signal }) => {
    let currentRetryDelay = retryDelayMs
    while (!signal.aborted) {
      try {
        const payload = {
          timeout: pollTimeoutSeconds,
          allowed_updates: ["message", "callback_query"],
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
          try {
            await callApi({
              method: "setMyCommands",
              payload: { commands: [
                { command: "start", description: "Open the Harvester Command Center" },
                { command: "help", description: "Show commands and safety notes" },
                { command: "status", description: "Read runtime readiness and blockers" },
                { command: "markets", description: "Read configured market state" },
                { command: "positions", description: "Read positions and recovery accounting" },
                { command: "orders", description: "Read Harvester and external open orders" },
                { command: "balances", description: "Read latest exchange balances" },
                { command: "pause", description: "Request a market-scoped operator pause" },
                { command: "resume", description: "Request removal of an operator pause" },
              ] },
              signal: nextController.signal,
            })
          } catch (error) {
            logger?.warn?.({
              message: "Telegram command menu registration failed; text commands remain available",
              component: "harvester.operator",
              operation: "setMyCommands",
              error,
            })
          }
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
        pendingConfirmations.clear()
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
