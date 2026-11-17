import {
  normalizeTelegramUserId,
  resolveMessageAction,
  resolveCallbackAction,
  callbackAuthorizationFailure,
  messageAuthorizationFailure,
} from "./telegram-operator-interaction.js"
import { parseTelegramOperatorCommand } from "./telegram-operator-commands.js"
import { helpText, mainMenuKeyboard, PAGE_METHODS } from "./telegram-operator-keyboard.js"
import {
  handleNavigationCallback,
  handleMarketSelectionCallback,
  handleConfirmationCallback,
  handleCancelCallback,
} from "./telegram-operator-callbacks.js"
import { respondToAuthorizedMessage } from "./telegram-operator-messages.js"

async function authorizeTelegramCallback({
  callback,
  chat,
  userId,
  chatId,
  signal,
  interaction,
  allowedUsers,
  logStage,
  answerCallback,
}) {
  if (typeof callback?.id !== "string" || callback.id.trim() === "") {
    logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "AUTHORIZATION",
      level: "warn",
      fields: { reason: "INVALID_CALLBACK_ID" },
    })
    return undefined
  }
  const rejectionReason = callbackAuthorizationFailure({ callback,
 chat,
 userId,
 chatId,
 allowedUsers })
  if (rejectionReason) {
    logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "AUTHORIZATION",
      level: "warn",
      fields: { reason: rejectionReason },
    })
    await answerCallback({ callbackId: callback.id,
 text: "Not authorized.",
 signal,
 interaction })
    return undefined
  }
  logStage({ interaction,
 message: "Telegram interaction AUTHORIZED",
 stage: "AUTHORIZED" })
  const messageId = callback.message?.message_id
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || typeof callback.data !== "string") {
    logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "CALLBACK_VALIDATION",
      level: "warn",
      fields: { reason: "INVALID_OR_EXPIRED_CALLBACK" },
    })
    await answerCallback({ callbackId: callback.id,
 text: "Invalid or expired control.",
 signal,
 interaction })
    return undefined
  }
  return { messageId }
}

async function routeTelegramCallbackData({ callback,
 update,
 common }) {
  const navigation = /^cc:(nav|refresh):(home|status|markets|pause|resume|positions|orders|balances)$/.exec(callback.data)
  if (navigation) {
    await handleNavigationCallback({ ...common,
 navigation })
    return
  }
  const ask = /^cc:ask:(PAUSE|RESUME):([A-Z0-9]{2,30})$/.exec(callback.data)
  if (ask) {
    await handleMarketSelectionCallback({ ...common,
 ask,
 update })
    return
  }
  const confirm = /^cc:confirm:(PAUSE|RESUME):([A-Z0-9]{2,30}):(\d+)$/.exec(callback.data)
  if (confirm) {
    await handleConfirmationCallback({ ...common,
 confirm })
    return
  }
  const cancel = /^cc:cancel:(\d+)$/.exec(callback.data)
  if (cancel) {
    await handleCancelCallback({ ...common,
 cancel })
    return
  }
  common.logStage({
    interaction: common.interaction,
    message: "Telegram interaction REJECTED",
    stage: "CALLBACK_ROUTING",
    level: "warn",
    fields: { reason: "UNSUPPORTED_CALLBACK_DATA" },
  })
  await common.answerCallback({
    callbackId: callback.id,
    text: "Unknown or expired action.",
    signal: common.signal,
    interaction: common.interaction,
  })
}

export async function respondToTelegramCallback({ update,
 signal,
 interaction,
 context }) {
  const callback = update.callback_query
  const callbackAction = resolveCallbackAction(callback?.data)
  interaction.action = callbackAction.action
  interaction.symbol = callbackAction.symbol
  const userId = normalizeTelegramUserId(callback?.from?.id)
  const chat = callback?.message?.chat
  const chatId = normalizeTelegramUserId(chat?.id)
  const authorization = await authorizeTelegramCallback({
    callback,
    chat,
    userId,
    chatId,
    signal,
    interaction,
    allowedUsers: context.allowedUsers,
    logStage: context.logStage,
    answerCallback: context.answerCallback,
  })
  if (!authorization) {
    return
  }
  const common = {
    callback,
    chat,
    messageId: authorization.messageId,
    userId,
    signal,
    interaction,
    ...context,
  }
  await routeTelegramCallbackData({ callback,
 update,
 common })
}

async function respondToMenuCommand({ parsed,
 message,
 userId,
 signal,
 interaction,
 context }) {
  if (parsed.type === "START" || parsed.type === "MENU" || parsed.type === "HELP") {
    context.logStage({ interaction,
 message: "Telegram command STARTED",
 stage: "COMMAND_STARTED" })
    const replyMarkup = parsed.type === "HELP" ? context.buildNavigationKeyboard() : mainMenuKeyboard()
    await context.sendMessage({
      chatId: message.chat.id,
      text: helpText(),
      replyMarkup,
      signal,
      interaction,
    })
    return true
  }
  if (parsed.type !== "PAUSE_MENU" && parsed.type !== "RESUME_MENU") {
    return false
  }
  const page = parsed.type === "PAUSE_MENU" ? "pause" : "resume"
  interaction.action = page.toUpperCase()
  context.logStage({ interaction,
 message: "Telegram command STARTED",
 stage: "COMMAND_STARTED" })
  const rendered = await context.readPage({ page,
 userId,
 interaction })
  await context.sendMessage({
    chatId: message.chat.id,
    text: rendered.text,
    replyMarkup: rendered.keyboard,
    signal,
    interaction,
  })
  return true
}

async function respondToReadCommand({ parsed,
 message,
 userId,
 signal,
 interaction,
 context }) {
  const page = parsed.type.toLowerCase()
  if (!PAGE_METHODS[page]) {
    return false
  }
  interaction.action = parsed.type
  context.logStage({ interaction,
 message: "Telegram command STARTED",
 stage: "COMMAND_STARTED" })
  const rendered = await context.readPage({ page,
 userId,
 interaction })
  await context.sendMessage({
    chatId: message.chat.id,
    text: rendered.text,
    replyMarkup: rendered.keyboard,
    signal,
    interaction,
  })
  return true
}

async function respondToTelegramMessage({ update,
 signal,
 interaction,
 context }) {
  const { message } = update
  if (!message) {
    context.logStage({
      interaction,
      message: "Telegram interaction IGNORED",
      stage: "UPDATE_ROUTING",
      fields: { reason: "NO_MESSAGE_OR_CALLBACK" },
    })
    return
  }
  const userId = normalizeTelegramUserId(message.from?.id)
  const chatId = normalizeTelegramUserId(message.chat?.id)
  const authorizationFailure = messageAuthorizationFailure({ message,
 userId,
 chatId })
  if (authorizationFailure) {
    context.logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "AUTHORIZATION",
      level: "warn",
      fields: { reason: authorizationFailure },
    })
    return
  }
  const parsed = parseTelegramOperatorCommand(message.text, { botUsername: context.getBotUsername() })
  if (parsed.type === "IGNORE") {
    context.logStage({
      interaction,
      message: "Telegram interaction IGNORED",
      stage: "COMMAND_PARSING",
      fields: { reason: "NOT_A_SUPPORTED_COMMAND_OR_BUTTON" },
    })
    return
  }
  interaction.action = resolveMessageAction(parsed)
  interaction.symbol = parsed.symbol
  if (!context.allowedUsers.has(userId)) {
    context.logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "AUTHORIZATION",
      level: "warn",
      fields: { reason: "USER_NOT_ALLOWLISTED" },
    })
    await context.sendMessage({ chatId: message.chat.id,
 text: "Not authorized.",
 signal,
 interaction })
    return
  }
  context.logStage({ interaction,
 message: "Telegram interaction AUTHORIZED",
 stage: "AUTHORIZED" })
  await respondToAuthorizedMessage({
    parsed,
    update,
    message,
    userId,
    signal,
    interaction,
    logStage: context.logStage,
    respondToMenuCommand: (options) => respondToMenuCommand({ ...options,
 context }),
    respondToReadCommand: (options) => respondToReadCommand({ ...options,
 context }),
    executeControl: context.executeControl,
    sendMessage: context.sendMessage,
    buildNavigationKeyboard: context.buildNavigationKeyboard,
  })
}

export async function respondToTelegramUpdate({ update,
 signal,
 interaction,
 context }) {
  if (update.callback_query) {
    await respondToTelegramCallback({ update,
 signal,
 interaction,
 context })
    return
  }
  await respondToTelegramMessage({ update,
 signal,
 interaction,
 context })
}