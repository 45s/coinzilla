import { createTelegramOperatorDiagnostics } from "./telegram-operator-diagnostics.js"
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

const KEYBOARD_ACTIONS = Object.freeze({
  pause: Object.freeze({ type: "PAUSE_MENU" }),
  resume: Object.freeze({ type: "RESUME_MENU" }),
  status: Object.freeze({ type: "STATUS" }),
  markets: Object.freeze({ type: "MARKETS" }),
  portfolio: Object.freeze({ type: "POSITIONS" }),
  "open orders": Object.freeze({ type: "ORDERS" }),
})

const ENTRY_COMMAND_TYPES = Object.freeze({
  "/start": "START",
  "/menu": "MENU",
  "/help": "HELP",
})

function parseEntryCommand({ command, argumentsList }) {
  const type = ENTRY_COMMAND_TYPES[command]
  if (!type) { return undefined }
  if (argumentsList.length !== 0) { return Object.freeze({ type: "INVALID" }) }
  return Object.freeze({ type })
}

function resolveMarketAction(page) {
  if (page === "pause") { return "PAUSE" }
  if (page === "resume") { return "RESUME" }
  return undefined
}

function selectMarketsForAction({ markets, action }) {
  if (action === "PAUSE") {
    return markets.filter((market) => market?.enabled === true && market.operatorPaused !== true)
  }
  if (action === "RESUME") {
    return markets.filter((market) => market?.enabled === true && market.operatorPaused === true)
  }
  return []
}

function formatMarketActionPrompt({ action, eligibleMarkets, text }) {
  const prompt = action === "PAUSE"
    ? "Choose an enabled market to pause."
    : "Choose an enabled market to resume."
  if (eligibleMarkets.length > 0) { return `${prompt}\n\n${text}` }
  const emptyMessage = action === "PAUSE"
    ? "No enabled markets are currently available to pause."
    : "No enabled operator-paused markets are currently available to resume."
  return `${prompt}\n${emptyMessage}\n\n${text}`
}

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
  if (typeof text !== "string" || text.trim() === "") {
    return Object.freeze({ type: "IGNORE" })
  }
  const normalizedText = text.trim()
  if (!normalizedText.startsWith("/")) {
    return KEYBOARD_ACTIONS[normalizedText.toLowerCase()] ?? Object.freeze({ type: "IGNORE" })
  }

  const [commandToken, ...argumentsList] = normalizedText.split(/\s+/)
  const commandParts = commandToken.split("@")
  if (commandParts.length > 2) {return Object.freeze({ type: "INVALID" })}
  const [command, targetUsername] = commandParts
  if (targetUsername !== undefined &&
      (typeof botUsername !== "string" || targetUsername.toLowerCase() !== botUsername.toLowerCase())) {
    return Object.freeze({ type: "IGNORE" })
  }
  const entryCommand = parseEntryCommand({ command, argumentsList })
  if (entryCommand) { return entryCommand }
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
      const description = typeof body?.description === "string" ? body.description : undefined
      const error = new Error("Telegram API " + method + " failed (HTTP " + response.status + ")" + (description ? ": " + description : ""))
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
  const diagnostics = createTelegramOperatorDiagnostics({ logger, botToken })
  const createInteraction = ({ update }) => ({
    correlationId: "telegram:" + update.update_id,
    interactionType: update.callback_query ? "callback" : "message",
    action: "UNKNOWN",
    stage: "UPDATE_RECEIVED",
    applicationOperationInvoked: false,
    applicationOperationCompleted: false,
    stateChanged: false,
    failed: false,
    loggedErrors: new Set(),
  })
  const resolveCallbackAction = (data) => {
    const control = /^cc:(?:ask|confirm):(PAUSE|RESUME):([A-Z0-9]{2,30})(?::\d+)?$/.exec(data ?? "")
    if (control) { return { action: control[1], symbol: control[2] } }
    const navigation = /^cc:(?:nav|refresh):(home|status|markets|pause|resume|positions|orders|balances)$/.exec(data ?? "")
    if (navigation) {
      return { action: navigation[2] === "home" ? "MENU" : navigation[2].toUpperCase() }
    }
    if (/^cc:cancel:\d+$/.test(data ?? "")) { return { action: "CANCEL" } }
    return { action: "UNKNOWN" }
  }

  const sendMessage = async ({ chatId, text, replyMarkup, signal, interaction }) => {
    if (interaction) { interaction.stage = "RESPONSE_DELIVERY" }
    const startedAt = Date.now()
    const result = await callApi({
      method: "sendMessage",
      payload: { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) },
      signal,
    })
    diagnostics.log({
      interaction,
      message: "Telegram response SENT",
      fields: { stage: "RESPONSE_DELIVERED", delivery: "SEND_MESSAGE", durationMs: Date.now() - startedAt },
    })
    return result
  }

  const editMessage = async ({ chatId, messageId, text, replyMarkup, signal, interaction }) => {
    if (interaction) { interaction.stage = "RESPONSE_DELIVERY" }
    const startedAt = Date.now()
    try {
      const result = await callApi({
        method: "editMessageText",
        payload: { chat_id: chatId, message_id: messageId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) },
        signal,
      })
      diagnostics.log({
        interaction,
        message: "Telegram response SENT",
        fields: { stage: "RESPONSE_DELIVERED", delivery: "EDIT_MESSAGE", durationMs: Date.now() - startedAt },
      })
      return result
    } catch (error) {
      if (/message is not modified/i.test(error?.message ?? "")) {
        diagnostics.log({
          interaction,
          message: "Telegram response SENT",
          fields: { stage: "RESPONSE_DELIVERED", delivery: "ALREADY_CURRENT", durationMs: Date.now() - startedAt },
        })
        return undefined
      }
      throw error
    }
  }

  const answerCallback = async ({ callbackId, text, signal, interaction }) => {
    if (interaction) { interaction.stage = "CALLBACK_ACKNOWLEDGEMENT" }
    const startedAt = Date.now()
    try {
      const result = await callApi({
        method: "answerCallbackQuery",
        payload: { callback_query_id: callbackId, ...(text ? { text } : {}) },
        signal,
      })
      diagnostics.log({
        interaction,
        message: "Telegram callback ACKNOWLEDGED",
        fields: { stage: "CALLBACK_ACKNOWLEDGED", durationMs: Date.now() - startedAt },
      })
      return result
    } catch (error) {
      if (/query is too old|query id is invalid|query has expired/i.test(error?.message ?? "")) {
        diagnostics.log({
          interaction,
          message: "Telegram callback acknowledgement EXPIRED",
          fields: { stage: "CALLBACK_ACKNOWLEDGEMENT", acknowledged: false },
        })
        return undefined
      }
      throw error
    }
  }

  const navigationKeyboard = ({ page = "home", markets = [], marketAction } = {}) => {
    const rows = [
      [{ text: "Status", callback_data: "cc:nav:status" }, { text: "Markets", callback_data: "cc:nav:markets" }],
      [{ text: "Positions", callback_data: "cc:nav:positions" }, { text: "Orders", callback_data: "cc:nav:orders" }],
      [{ text: "Balances", callback_data: "cc:nav:balances" }],
    ]
    if (page === "markets") {
      let actionCount = 0
      for (const market of markets) {
        if (actionCount >= 20) { break }
        if (typeof market?.symbol !== "string" || !/^[A-Z0-9]{2,30}$/.test(market.symbol) || market.enabled !== true) { continue }
        if (marketAction === "PAUSE" && market.operatorPaused === true) { continue }
        if (marketAction === "RESUME" && market.operatorPaused !== true) { continue }
        const action = market.operatorPaused === true ? "RESUME" : "PAUSE"
        rows.push([{ text: (action === "PAUSE" ? "Pause " : "Resume ") + market.symbol, callback_data: "cc:ask:" + action + ":" + market.symbol }])
        actionCount += 1
      }
    }
    const refreshPage = marketAction ? marketAction.toLowerCase() : page
    rows.push([{ text: "Refresh", callback_data: "cc:refresh:" + refreshPage }, { text: "Main menu", callback_data: "cc:nav:home" }])
    return { inline_keyboard: rows }
  }

  const mainMenuKeyboard = () => ({
    keyboard: [
      [{ text: "Pause" }, { text: "Resume" }],
      [{ text: "Status" }, { text: "Markets" }],
      [{ text: "Portfolio" }, { text: "Open Orders" }],
    ],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Command Center",
  })

  const helpText = () => [
    "Harvester Command Center",
    "/start — open the persistent Command Center keyboard",
    "/menu — restore the persistent keyboard",
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

  const readPage = async ({ page, userId, interaction }) => {
    if (page === "home") { return { text: helpText(), keyboard: navigationKeyboard() } }
    const marketAction = resolveMarketAction(page)
    const queryPage = marketAction ? "markets" : page
    const method = PAGE_METHODS[queryPage]
    if (!method || typeof operator[method] !== "function") {
      const error = Object.assign(new Error("Read-only operator query is not available: " + queryPage), {
        code: "OPERATOR_QUERY_UNAVAILABLE",
      })
      diagnostics.fail({ interaction, error, stage: "QUERY_CONFIGURATION", operation: method ?? queryPage })
      return {
        text: "This read-only query is not available in the current operator configuration.",
        keyboard: navigationKeyboard({ page: queryPage }),
      }
    }
    interaction.operation = method
    const startedAt = Date.now()
    diagnostics.log({
      interaction,
      message: "Telegram query STARTED",
      fields: { stage: "QUERY_STARTED", queryPage },
    })
    let result
    try {
      result = await operator[method]({
        actor: { id: "telegram-user:" + userId, roles: ["trading-operator"] },
      })
    } catch (error) {
      diagnostics.fail({ interaction, error, stage: "QUERY_EXECUTION", operation: method })
      return {
        text: "Unable to read the Harvester " + PAGE_TITLES[queryPage] + ". No trading state was changed; check Harvester diagnostics.",
        keyboard: navigationKeyboard({ page: queryPage }),
      }
    }
    if (result?.ok !== true) {
      const error = result?.errors?.[0] ?? result?.error ??
        new Error("Operator read query returned ok:false without error details: " + method)
      diagnostics.fail({ interaction, error, stage: "QUERY_RESULT", operation: method })
      return {
        text: "Unable to read the Harvester " + PAGE_TITLES[queryPage] + ". No trading state was changed; check Harvester diagnostics.",
        keyboard: navigationKeyboard({ page: queryPage }),
      }
    }
    diagnostics.log({
      interaction,
      message: "Telegram query COMPLETED",
      fields: { stage: "QUERY_COMPLETED", durationMs: Date.now() - startedAt },
    })
    const text = ({
      status: () => formatTelegramOperatorStatus({ status: result.data }),
      markets: () => formatTelegramOperatorMarkets({ snapshot: result.data }),
      positions: () => formatTelegramOperatorPositions({ snapshot: result.data }),
      orders: () => formatTelegramOperatorOrders({ snapshot: result.data }),
      balances: () => formatTelegramOperatorBalances({ snapshot: result.data }),
    })[queryPage]()
    const markets = queryPage === "markets" ? result.data.markets : []
    const keyboard = navigationKeyboard({ page: queryPage, markets, marketAction })
    if (!marketAction) { return { text, keyboard } }
    const eligibleMarkets = selectMarketsForAction({ markets, action: marketAction })
    diagnostics.log({
      interaction,
      message: "Telegram market selection READY",
      fields: { stage: "MARKET_SELECTION_READY", eligibleMarketCount: eligibleMarkets.length },
    })
    return {
      text: formatMarketActionPrompt({ action: marketAction, eligibleMarkets, text }),
      keyboard,
    }
  }

  const editPage = async ({ page, chatId, messageId, userId, signal, interaction }) => {
    const rendered = await readPage({ page, userId, interaction })
    await editMessage({
      chatId,
      messageId,
      text: rendered.text,
      replyMarkup: rendered.keyboard,
      signal,
      interaction,
    })
  }

  const executeControl = async ({ action, symbol, userId, requestId, chatId, messageId, signal, interaction }) => {
    const method = action === "RESUME" ? "resumeMarket" : "pauseMarket"
    interaction.action = action
    interaction.symbol = symbol
    interaction.operation = method
    if (typeof operator[method] !== "function") {
      const error = Object.assign(new Error("Operator control use case is unavailable: " + method), {
        code: "OPERATOR_CONTROL_UNAVAILABLE",
      })
      diagnostics.fail({ interaction, error, stage: "APPLICATION_OPERATION_UNAVAILABLE", operation: method, symbol })
      const text = action === "RESUME"
        ? "Resume is not available in this operator configuration."
        : "Pause is not available in this operator configuration."
      if (messageId !== undefined) {
        await editMessage({ chatId, messageId, text, replyMarkup: navigationKeyboard(), signal, interaction })
      } else {
        await sendMessage({ chatId, text, replyMarkup: navigationKeyboard(), signal, interaction })
      }
      return
    }
    const startedAt = Date.now()
    interaction.stage = "APPLICATION_OPERATION"
    interaction.applicationOperationInvoked = true
    diagnostics.log({
      interaction,
      message: "Telegram application operation STARTED",
      fields: { stage: "APPLICATION_OPERATION_STARTED" },
    })
    let result
    try {
      result = await operator[method]({
        actor: { id: "telegram-user:" + userId, roles: ["trading-operator"] },
        requestId,
        symbol,
      })
    } catch (error) {
      diagnostics.fail({ interaction, error, stage: "APPLICATION_OPERATION", operation: method, symbol })
    }
    let reply
    if (result?.ok !== true) {
      if (!interaction.failed) {
        const error = result?.errors?.[0] ?? result?.error ??
          new Error("Operator control use case returned ok:false without error details: " + method)
        diagnostics.fail({ interaction, error, stage: "APPLICATION_OPERATION_RESULT", operation: method, symbol })
      }
      const code = result?.errors?.[0]?.code ?? result?.error?.code
      if (code === "INVALID_OPERATOR_MARKET") {
        reply = "Unknown configured market: " + symbol + "."
      } else if (code === "SAFETY_BLOCKER_ACTIVE") {
        reply = "Cannot resume " + symbol + ": a safety, recovery, or volatility blocker is still active. The blocker was not changed."
      } else {
        const actionLabel = action === "RESUME" ? "Resume" : "Pause"
        reply = actionLabel + " was not acknowledged; check Harvester logs and retry."
      }
    } else if (action === "RESUME" && result.data?.resumed === true) {
      interaction.applicationOperationCompleted = true
      interaction.stateChanged = true
      reply = "Resumed " + symbol + ": the operator-owned pause was removed. Safety, recovery, and volatility controls remain in force."
    } else if (action === "RESUME" && result.data?.resumed === false) {
      interaction.applicationOperationCompleted = true
      interaction.stateChanged = false
      reply = symbol + " is not operator-paused. No state change was made."
    } else if (action === "PAUSE" && result.data?.paused === true) {
      interaction.applicationOperationCompleted = true
      interaction.stateChanged = result.data?.alreadyPaused !== true
      if (result.data?.alreadyPaused === true) {
        reply = "Already paused " + symbol + ". New strategy BUYs remain blocked."
      } else {
        reply = "Paused " + symbol + ": new strategy BUYs and trailing-BUY replacements are blocked. Existing exchange orders remain open and may still fill. This pause is process-local and is not restored after restart."
      }
    } else {
      const error = Object.assign(new Error("Operator control use case returned an invalid success result: " + method), {
        code: "OPERATOR_CONTROL_RESULT_INVALID",
      })
      diagnostics.fail({ interaction, error, stage: "APPLICATION_OPERATION_RESULT", operation: method, symbol })
      reply = (action === "RESUME" ? "Resume" : "Pause") + " was not acknowledged; check Harvester logs and retry."
    }
    if (interaction.applicationOperationCompleted) {
      diagnostics.log({
        interaction,
        message: "Telegram application operation COMPLETED",
        level: interaction.stateChanged ? "info" : "debug",
        fields: {
          stage: "APPLICATION_OPERATION_COMPLETED",
          durationMs: Date.now() - startedAt,
          result: action === "PAUSE" ? "PAUSED" : "RESUME_PROCESSED",
        },
      })
    }
    if (messageId !== undefined) {
      await editMessage({ chatId, messageId, text: reply, replyMarkup: navigationKeyboard(), signal, interaction })
    } else {
      await sendMessage({ chatId, text: reply, replyMarkup: navigationKeyboard(), signal, interaction })
    }
  }

  const respondToCallback = async ({ update, signal, interaction }) => {
    const callback = update.callback_query
    const callbackAction = resolveCallbackAction(callback?.data)
    interaction.action = callbackAction.action
    interaction.symbol = callbackAction.symbol
    const userId = normalizeTelegramUserId(callback?.from?.id)
    const chat = callback?.message?.chat
    const chatId = normalizeTelegramUserId(chat?.id)
    const callbackIdIsValid = typeof callback?.id === "string" && callback.id.trim() !== ""
    if (!callbackIdIsValid) {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "AUTHORIZATION", reason: "INVALID_CALLBACK_ID" },
      })
      return
    }
    let rejectionReason
    if (!callback || callback.from?.is_bot === true) {
      rejectionReason = "INVALID_CALLBACK_SENDER"
    } else if (chat?.type !== "private") {
      rejectionReason = "PRIVATE_CHAT_REQUIRED"
    } else if (!userId || chatId !== userId) {
      rejectionReason = "PRIVATE_CHAT_IDENTITY_MISMATCH"
    } else if (!allowedUsers.has(userId)) {
      rejectionReason = "USER_NOT_ALLOWLISTED"
    }
    if (rejectionReason) {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "AUTHORIZATION", reason: rejectionReason },
      })
      await answerCallback({ callbackId: callback.id, text: "Not authorized.", signal, interaction })
      return
    }
    diagnostics.log({
      interaction,
      message: "Telegram interaction AUTHORIZED",
      fields: { stage: "AUTHORIZED" },
    })
    const messageId = callback.message?.message_id
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || typeof callback.data !== "string") {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "CALLBACK_VALIDATION", reason: "INVALID_OR_EXPIRED_CALLBACK" },
      })
      await answerCallback({ callbackId: callback.id, text: "Invalid or expired control.", signal, interaction })
      return
    }

    const navigation = /^cc:(nav|refresh):(home|status|markets|pause|resume|positions|orders|balances)$/.exec(callback.data)
    if (navigation) {
      diagnostics.log({ interaction, message: "Telegram command STARTED", fields: { stage: "COMMAND_STARTED" } })
      await answerCallback({ callbackId: callback.id, signal, interaction })
      await editPage({ page: navigation[2], chatId: chat.id, messageId, userId, signal, interaction })
      return
    }

    const ask = /^cc:ask:(PAUSE|RESUME):([A-Z0-9]{2,30})$/.exec(callback.data)
    if (ask) {
      interaction.action = ask[1]
      interaction.symbol = ask[2]
      diagnostics.log({
        interaction,
        message: "Telegram market selection RECEIVED",
        fields: { stage: "MARKET_SELECTION_RECEIVED" },
      })
      const token = String(update.update_id)
      const now = Date.now()
      for (const [pendingToken, pending] of pendingConfirmations) {
        if (pending.expiresAt < now) { pendingConfirmations.delete(pendingToken) }
      }
      while (pendingConfirmations.size >= 1000) { pendingConfirmations.delete(pendingConfirmations.keys().next().value) }
      pendingConfirmations.set(token, {
        action: ask[1],
        symbol: ask[2],
        userId,
        chatId: String(chat.id),
        messageId,
        expiresAt: now + CONFIRMATION_TTL_MS,
      })
      await answerCallback({ callbackId: callback.id, text: "Review the confirmation prompt.", signal, interaction })
      diagnostics.log({
        interaction,
        message: "Telegram confirmation REQUESTED",
        fields: { stage: "CONFIRMATION_REQUESTED", confirmationExpiresInMs: CONFIRMATION_TTL_MS },
      })
      await editMessage({
        chatId: chat.id,
        messageId,
        text: "Confirm " + ask[1].toLowerCase() + " of " + ask[2] + "? No action has been taken yet.",
        replyMarkup: { inline_keyboard: [[
          { text: "Confirm " + ask[1].toLowerCase(), callback_data: "cc:confirm:" + ask[1] + ":" + ask[2] + ":" + token },
          { text: "Cancel", callback_data: "cc:cancel:" + token },
        ], [{ text: "Main menu", callback_data: "cc:nav:home" }]] },
        signal,
        interaction,
      })
      return
    }

    const confirm = /^cc:confirm:(PAUSE|RESUME):([A-Z0-9]{2,30}):(\d+)$/.exec(callback.data)
    if (confirm) {
      interaction.action = confirm[1]
      interaction.symbol = confirm[2]
      const pending = pendingConfirmations.get(confirm[3])
      const valid = pending && pending.action === confirm[1] && pending.symbol === confirm[2] &&
        pending.userId === userId && pending.chatId === String(chat.id) && pending.messageId === messageId &&
        pending.expiresAt >= Date.now()
      pendingConfirmations.delete(confirm[3])
      if (!valid) {
        diagnostics.log({
          interaction,
          message: "Telegram interaction REJECTED",
          level: "warn",
          fields: { stage: "CONFIRMATION_VALIDATION", reason: "STALE_OR_REPLAYED_CONFIRMATION" },
        })
        await answerCallback({ callbackId: callback.id, text: "Confirmation expired or already used. Start again.", signal, interaction })
        await editMessage({
          chatId: chat.id,
          messageId,
          text: "Confirmation expired or already used. No action was taken.",
          replyMarkup: navigationKeyboard(),
          signal,
          interaction,
        })
        return
      }
      diagnostics.log({
        interaction,
        message: "Telegram confirmation RECEIVED",
        fields: { stage: "CONFIRMATION_RECEIVED" },
      })
      await answerCallback({ callbackId: callback.id, text: "Processing confirmed action.", signal, interaction })
      await executeControl({
        action: pending.action,
        symbol: pending.symbol,
        userId,
        requestId: "telegram:callback:" + callback.id,
        chatId: chat.id,
        messageId,
        signal,
        interaction,
      })
      return
    }

    const cancel = /^cc:cancel:(\d+)$/.exec(callback.data)
    if (cancel) {
      const pending = pendingConfirmations.get(cancel[1])
      if (pending && pending.userId === userId && pending.chatId === String(chat.id) && pending.messageId === messageId) {
        pendingConfirmations.delete(cancel[1])
      }
      interaction.action = "CANCEL"
      diagnostics.log({
        interaction,
        message: "Telegram confirmation CANCELLED",
        fields: { stage: "CONFIRMATION_CANCELLED" },
      })
      await answerCallback({ callbackId: callback.id, text: "Cancelled.", signal, interaction })
      await editMessage({
        chatId: chat.id,
        messageId,
        text: "Control action cancelled. No action was taken.",
        replyMarkup: navigationKeyboard(),
        signal,
        interaction,
      })
      return
    }
    diagnostics.log({
      interaction,
      message: "Telegram interaction REJECTED",
      level: "warn",
      fields: { stage: "CALLBACK_ROUTING", reason: "UNSUPPORTED_CALLBACK_DATA" },
    })
    await answerCallback({ callbackId: callback.id, text: "Unknown or expired action.", signal, interaction })
  }

  const respondToMenuCommand = async ({ parsed, message, userId, signal, interaction }) => {
    if (parsed.type === "START" || parsed.type === "MENU") {
      interaction.action = parsed.type
      diagnostics.log({ interaction, message: "Telegram command STARTED", fields: { stage: "COMMAND_STARTED" } })
      await sendMessage({ chatId: message.chat.id, text: helpText(), replyMarkup: mainMenuKeyboard(), signal, interaction })
      return true
    }
    if (parsed.type === "HELP") {
      interaction.action = parsed.type
      diagnostics.log({ interaction, message: "Telegram command STARTED", fields: { stage: "COMMAND_STARTED" } })
      await sendMessage({ chatId: message.chat.id, text: helpText(), replyMarkup: navigationKeyboard(), signal, interaction })
      return true
    }
    if (parsed.type === "PAUSE_MENU" || parsed.type === "RESUME_MENU") {
      const page = parsed.type === "PAUSE_MENU" ? "pause" : "resume"
      interaction.action = page.toUpperCase()
      diagnostics.log({ interaction, message: "Telegram command STARTED", fields: { stage: "COMMAND_STARTED" } })
      const rendered = await readPage({ page, userId, interaction })
      await sendMessage({ chatId: message.chat.id, text: rendered.text, replyMarkup: rendered.keyboard, signal, interaction })
      return true
    }
    return false
  }

  const respondToReadCommand = async ({ parsed, message, userId, signal, interaction }) => {
    const page = parsed.type.toLowerCase()
    if (!PAGE_METHODS[page]) { return false }
    interaction.action = parsed.type
    diagnostics.log({ interaction, message: "Telegram command STARTED", fields: { stage: "COMMAND_STARTED" } })
    const rendered = await readPage({ page, userId, interaction })
    await sendMessage({ chatId: message.chat.id, text: rendered.text, replyMarkup: rendered.keyboard, signal, interaction })
    return true
  }

  const respondToUpdate = async ({ update, signal, interaction }) => {
    if (update.callback_query) {
      await respondToCallback({ update, signal, interaction })
      return
    }
    const message = update.message
    if (!message) {
      diagnostics.log({
        interaction,
        message: "Telegram interaction IGNORED",
        fields: { stage: "UPDATE_ROUTING", reason: "NO_MESSAGE_OR_CALLBACK" },
      })
      return
    }
    if (message.chat?.type !== "private") {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "AUTHORIZATION", reason: "PRIVATE_CHAT_REQUIRED" },
      })
      return
    }
    if (message.from?.is_bot === true) {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "AUTHORIZATION", reason: "BOT_SENDER_NOT_ALLOWED" },
      })
      return
    }
    const userId = normalizeTelegramUserId(message.from?.id)
    const privateChatUserId = normalizeTelegramUserId(message.chat.id)
    if (!userId || privateChatUserId !== userId) {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "AUTHORIZATION", reason: "PRIVATE_CHAT_IDENTITY_MISMATCH" },
      })
      return
    }

    const parsed = parseTelegramOperatorCommand(message.text, { botUsername })
    if (parsed.type === "IGNORE") {
      diagnostics.log({
        interaction,
        message: "Telegram interaction IGNORED",
        fields: { stage: "COMMAND_PARSING", reason: "NOT_A_SUPPORTED_COMMAND_OR_BUTTON" },
      })
      return
    }
    interaction.action = parsed.type
    interaction.symbol = parsed.symbol
    if (!allowedUsers.has(userId)) {
      diagnostics.log({
        interaction,
        message: "Telegram interaction REJECTED",
        level: "warn",
        fields: { stage: "AUTHORIZATION", reason: "USER_NOT_ALLOWLISTED" },
      })
      await sendMessage({ chatId: message.chat.id, text: "Not authorized.", signal, interaction })
      return
    }
    diagnostics.log({
      interaction,
      message: "Telegram interaction AUTHORIZED",
      fields: { stage: "AUTHORIZED" },
    })
    if (await respondToMenuCommand({ parsed, message, userId, signal, interaction })) { return }
    if (await respondToReadCommand({ parsed, message, userId, signal, interaction })) { return }
    diagnostics.log({ interaction, message: "Telegram command STARTED", fields: { stage: "COMMAND_STARTED" } })
    if (parsed.type === "UNSUPPORTED") {
      await sendMessage({
        chatId: message.chat.id,
        text: "Unknown command. Use /help to see available commands.",
        replyMarkup: navigationKeyboard(),
        signal,
        interaction,
      })
      return
    }
    if (parsed.type === "INVALID") {
      await sendMessage({
        chatId: message.chat.id,
        text: parsed.command === "RESUME" || parsed.command === "PAUSE"
          ? "Usage: /" + parsed.command.toLowerCase() + " <SYMBOL>. Use /help for commands."
          : \`Usage: /\${String(parsed.command ?? "command").toLowerCase()} with no arguments. Use /help for commands.\`,
        signal,
        interaction,
      })
      return
    }
    const action = parsed.type === "RESUME" ? "RESUME" : "PAUSE"
    await executeControl({
      action,
      symbol: parsed.symbol,
      userId,
      requestId: \`telegram:\${update.update_id}:\${message.date ?? "0"}:\${userId}\`,
      chatId: message.chat.id,
      signal,
      interaction,
    })
  }

  const poll = async ({ signal }) => {
    let currentRetryDelay = retryDelayMs
    while (!signal.aborted) {
      let interactionFailureLogged = false
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
          const interaction = createInteraction({ update })
          diagnostics.log({
            interaction,
            message: "Telegram update RECEIVED",
            fields: { stage: "UPDATE_RECEIVED" },
          })
          try {
            await respondToUpdate({ update, signal, interaction })
          } catch (error) {
            diagnostics.fail({ interaction, error, stage: interaction.stage })
            interactionFailureLogged = true
            throw error
          }
          if (interaction.failed) {
            diagnostics.log({
              interaction,
              message: "Telegram interaction HANDLED",
              fields: { stage: "HANDLED", outcome: "FAILURE_REPORTED" },
            })
          } else {
            diagnostics.log({
              interaction,
              message: "Telegram interaction COMPLETED",
              fields: { stage: "COMPLETED" },
            })
          }
          offset = update.update_id + 1
        }
        currentRetryDelay = retryDelayMs
      } catch (error) {
        if (signal.aborted) {break}
        const retryAfterMs = Number.isSafeInteger(error?.retryAfter)
          ? Math.min(error.retryAfter * 1000, MAX_RETRY_DELAY_MS)
          : currentRetryDelay
        if (interactionFailureLogged) {
          diagnostics.log({
            message: "Telegram polling retry scheduled",
            level: "debug",
            fields: { operation: "update-handler", retryDelayMs: retryAfterMs },
          })
        } else {
          const errorDetails = diagnostics.describeError(error)
          logger?.warn?.({
            message: "Telegram polling FAILED; retrying",
            component: "harvester.operator",
            operation: "getUpdates",
            failureClassification: errorDetails.code ?? errorDetails.name,
            errorDetails,
            retryDelayMs: retryAfterMs,
          })
        }
        await waitForRetry({
          milliseconds: retryAfterMs,
          signal,
        })
        currentRetryDelay = Math.min(currentRetryDelay * 2, MAX_RETRY_DELAY_MS)
      }
    }
  }

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
        offset = undefined
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
