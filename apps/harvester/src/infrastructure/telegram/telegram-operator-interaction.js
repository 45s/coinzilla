import { parseTelegramOperatorCommand } from "./telegram-operator-commands.js"

export function normalizeTelegramUserId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numericValue = Number(value)
    if (Number.isSafeInteger(numericValue) && numericValue > 0) {return String(numericValue)}
  }
  return undefined
}


export function resolveMessageAction(parsed) {
  if (parsed.type === "PAUSE_MENU") { return "PAUSE" }
  if (parsed.type === "RESUME_MENU") { return "RESUME" }
  if (parsed.type === "INVALID" && parsed.command) { return parsed.command }
  return parsed.type
}

export function createTelegramInteraction({ update, botUsername }) {
  const interaction = {
    correlationId: `telegram:${update.update_id}`,
    interactionType: update.callback_query ? "callback" : "message",
    action: "UNKNOWN",
    stage: "UPDATE_RECEIVED",
    applicationOperationInvoked: false,
    applicationOperationCompleted: false,
    stateChanged: false,
    failed: false,
    rejected: false,
    loggedErrors: new Set(),
  }
  if (update.callback_query) {
    Object.assign(interaction, resolveCallbackAction(update.callback_query.data))
  } else if (update.message) {
    const parsed = parseTelegramOperatorCommand(update.message.text, { botUsername })
    interaction.action = resolveMessageAction(parsed)
    interaction.symbol = parsed.symbol
  }
  return interaction
}

export function resolveCallbackAction(data) {
  const control = /^cc:(?:ask|confirm):(PAUSE|RESUME):([A-Z0-9]{2,30})(?::\d+)?$/.exec(data ?? "")
  if (control) {
    return { action: control[1],
symbol: control[2] }
  }
  const navigation = /^cc:(?:nav|refresh):(home|status|markets|pause|resume|positions|orders|balances)$/.exec(data ?? "")
  if (navigation) {
    return { action: navigation[1] === "home" ? "MENU" : navigation[1].toUpperCase() }
  }
  if (/^cc:cancel:\d+$/.test(data ?? "")) {
    return { action: "CANCEL" }
  }
  return { action: "UNKNOWN" }
}

export function callbackAuthorizationFailure({ callback, chat, userId, chatId, allowedUsers }) {
  if (!callback || callback.from?.is_bot === true) {
    return "INVALID_CALLBACK_SENDER"
  }
  if (chat?.type !== "private") {
    return "PRIVATE_CHAT_REQUIRED"
  }
  if (!userId || chatId !== userId) {
    return "PRIVATE_CHAT_IDENTITY_MISMATCH"
  }
  if (!allowedUsers.has(userId)) {
    return "USER_NOT_ALLOWLISTED"
  }
  return undefined
}

export function messageAuthorizationFailure({ message, userId, chatId }) {
  if (message.chat?.type !== "private") {
    return "PRIVATE_CHAT_REQUIRED"
  }
  if (message.from?.is_bot === true) {
    return "BOT_SENDER_NOT_ALLOWED"
  }
  if (!userId || chatId !== userId) {
    return "PRIVATE_CHAT_IDENTITY_MISMATCH"
  }
  return undefined
}
