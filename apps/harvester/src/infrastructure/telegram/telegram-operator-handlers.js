import { createTelegramOperatorDiagnostics } from "./telegram-operator-diagnostics.js"
import {
  normalizeTelegramUserId,
  resolveMessageAction,
  callbackAuthorizationFailure,
  messageAuthorizationFailure,
} from "./telegram-operator-interaction.js"
import { parseTelegramOperatorCommand } from "./telegram-operator-commands.js"
import {
  createNavigationKeyboard,
  mainMenuKeyboard,
  helpText,
  PAGE_METHODS,
} from "./telegram-operator-keyboard.js"
import { readTelegramOperatorPage } from "./telegram-operator-pages.js"
import { executeTelegramOperatorControl } from "./telegram-operator-controls.js"
import { createTelegramMessageApi } from "./telegram-operator-transport.js"
import {
  handleNavigationCallback,
  handleMarketSelectionCallback,
  handleConfirmationCallback,
  handleCancelCallback,
} from "./telegram-operator-callbacks.js"
import { respondToAuthorizedMessage } from "./telegram-operator-messages.js"

export function createTelegramOperatorHandlers({
  botToken,
  operator,
  allowedUsers,
  callApi,
  logger,
  getBotUsername,
}) {
  const pendingConfirmations = new Map()
  const CONFIRMATION_TTL_MS = 5 * 60 * 1000
  const buildNavigationKeyboard = createNavigationKeyboard
  const diagnostics = createTelegramOperatorDiagnostics({ logger,
botToken })
  const logStage = ({ interaction, message, stage, level = "info", fields = {} }) => {
    interaction.stage = stage
    diagnostics.log({
      interaction,
      message,
      level,
      fields: { stage,
...fields },
    })
  }

  const { sendMessage, editMessage, answerCallback } = createTelegramMessageApi({ callApi,
logStage })

  const readPage = ({ page, userId, interaction }) => readTelegramOperatorPage({
    page,
    userId,
    interaction,
    operator,
    diagnostics,
    logStage,
    buildNavigationKeyboard,
  })

  const editPage = async ({ page, chatId, messageId, userId, signal, interaction }) => {
    const rendered = await readPage({ page,
userId,
interaction })
    await editMessage({ chatId,
messageId,
text: rendered.text,
replyMarkup: rendered.keyboard,
signal,
interaction })
  }

  const executeControl = request => executeTelegramOperatorControl({
    ...request,
    operator,
    diagnostics,
    logStage,
    sendMessage,
    editMessage,
    buildNavigationKeyboard,
  })

  const respondToCallback = async ({ update, signal, interaction }) => {
    const callback = update.callback_query
    const callbackAction = resolveCallbackAction(callback?.data)
    interaction.action = callbackAction.action
    interaction.symbol = callbackAction.symbol
    const userId = normalizeTelegramUserId(callback?.from?.id)
    const chat = callback?.message?.chat
    const chatId = normalizeTelegramUserId(chat?.id)
    if (typeof callback?.id !== "string" || callback.id.trim() === "") {
      logStage({
        interaction,
        message: "Telegram interaction REJECTED",
        stage: "AUTHORIZATION",
        level: "warn",
        fields: { reason: "INVALID_CALLBACK_ID" },
      })
      return
    }
    const rejectionReason = callbackAuthorizationFailure({
      callback,
      chat,
      userId,
      chatId,
      allowedUsers,
    })
    if (rejectionReason) {
      logStage({
        interaction,
        message: "Telegram interaction REJECTED",
        stage: "AUTHORIZATION",
        level: "warn",
        fields: { reason: rejectionReason },
      })
      await answerCallback({
        callbackId: callback.id,
        text: "Not authorized.",
        signal,
        interaction,
      })
      return
    }
    logStage({
      interaction,
      message: "Telegram interaction AUTHORIZED",
      stage: "AUTHORIZED",
    })
    const messageId = callback.message?.message_id
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || typeof callback.data !== "string") {
      logStage({
        interaction,
        message: "Telegram interaction REJECTED",
        stage: "CALLBACK_VALIDATION",
        level: "warn",
        fields: { reason: "INVALID_OR_EXPIRED_CALLBACK" },
      })
      await answerCallback({
        callbackId: callback.id,
        text: "Invalid or expired control.",
        signal,
        interaction,
      })
      return
    }
    const common = {
      callback,
      chat,
      messageId,
      userId,
      signal,
      interaction,
      logStage,
      answerCallback,
      editMessage,
      editPage,
      executeControl,
      buildNavigationKeyboard,
      pendingConfirmations,
      confirmationTtlMs: CONFIRMATION_TTL_MS,
    }
    const navigation = /^cc:(nav|refresh):(home|status|markets|pause|resume|positions|orders|balances)$/.exec(callback.data)
    if (navigation) {
      await handleNavigationCallback({
        ...common,
        navigation,
      })
      return
    }
    const ask = /^cc:ask:(PAUSE|RESUME):([A-Z0-9]{2,30})$/.exec(callback.data)
    if (ask) {
      await handleMarketSelectionCallback({
        ...common,
        ask,
        update,
      })
      return
    }
    const confirm = /^cc:confirm:(PAUSE|RESUME):([A-Z0-9]{2,30}):(\d+)$/.exec(callback.data)
    if (confirm) {
      await handleConfirmationCallback({
        ...common,
        confirm,
      })
      return
    }
    const cancel = /^cc:cancel:(\d+)$/.exec(callback.data)
    if (cancel) {
      await handleCancelCallback({
        ...common,
        cancel,
      })
      return
    }
    logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "CALLBACK_ROUTING",
      level: "warn",
      fields: { reason: "UNSUPPORTED_CALLBACK_DATA" },
    })
    await answerCallback({
      callbackId: callback.id,
      text: "Unknown or expired action.",
      signal,
      interaction,
    })
  }

  const respondToMenuCommand = async ({ parsed, message, userId, signal, interaction }) => {
    if (parsed.type === "START" || parsed.type === "MENU") {
      logStage({ interaction,
message: "Telegram command STARTED",
stage: "COMMAND_STARTED" })
      await sendMessage({ chatId: message.chat.id,
text: helpText(),
replyMarkup: mainMenuKeyboard(),
signal,
interaction })
      return true
    }
    if (parsed.type === "HELP") {
      logStage({ interaction,
message: "Telegram command STARTED",
stage: "COMMAND_STARTED" })
      await sendMessage({ chatId: message.chat.id,
text: helpText(),
replyMarkup: buildNavigationKeyboard(),
signal,
interaction })
      return true
    }
    if (parsed.type === "PAUSE_MENU" || parsed.type === "RESUME_MENU") {
      const page = parsed.type === "PAUSE_MENU" ? "pause" : "resume"
      interaction.action = page.toUpperCase()
      logStage({ interaction,
message: "Telegram command STARTED",
stage: "COMMAND_STARTED" })
      const rendered = await readPage({ page,
userId,
interaction })
      await sendMessage({ chatId: message.chat.id,
text: rendered.text,
replyMarkup: rendered.keyboard,
signal,
interaction })
      return true
    }
    return false
  }

  const respondToReadCommand = async ({ parsed, message, userId, signal, interaction }) => {
    const page = parsed.type.toLowerCase()
    if (!PAGE_METHODS[page]) { return false }
    interaction.action = parsed.type
    logStage({ interaction,
message: "Telegram command STARTED",
stage: "COMMAND_STARTED" })
    const rendered = await readPage({ page,
userId,
interaction })
    await sendMessage({ chatId: message.chat.id,
text: rendered.text,
replyMarkup: rendered.keyboard,
signal,
interaction })
    return true
  }

  const respondToUpdate = async ({ update, signal, interaction }) => {
    if (update.callback_query) {
      await respondToCallback({ update,
signal,
interaction })
      return
    }
    const {message} = update
    if (!message) {
      logStage({
        interaction,
        message: "Telegram interaction IGNORED",
        stage: "UPDATE_ROUTING",
        fields: { reason: "NO_MESSAGE_OR_CALLBACK" },
      })
      return
    }
    const userId = normalizeTelegramUserId(message.from?.id)
    const chatId = normalizeTelegramUserId(message.chat?.id)
    const authorizationFailure = messageAuthorizationFailure({
      message,
      userId,
      chatId,
    })
    if (authorizationFailure) {
      logStage({
        interaction,
        message: "Telegram interaction REJECTED",
        stage: "AUTHORIZATION",
        level: "warn",
        fields: { reason: authorizationFailure },
      })
      return
    }
    const parsed = parseTelegramOperatorCommand(message.text, { botUsername: getBotUsername() })
    if (parsed.type === "IGNORE") {
      logStage({
        interaction,
        message: "Telegram interaction IGNORED",
        stage: "COMMAND_PARSING",
        fields: { reason: "NOT_A_SUPPORTED_COMMAND_OR_BUTTON" },
      })
      return
    }
    interaction.action = resolveMessageAction(parsed)
    interaction.symbol = parsed.symbol
    if (!allowedUsers.has(userId)) {
      logStage({
        interaction,
        message: "Telegram interaction REJECTED",
        stage: "AUTHORIZATION",
        level: "warn",
        fields: { reason: "USER_NOT_ALLOWLISTED" },
      })
      await sendMessage({
        chatId: message.chat.id,
        text: "Not authorized.",
        signal,
        interaction,
      })
      return
    }
    logStage({
      interaction,
      message: "Telegram interaction AUTHORIZED",
      stage: "AUTHORIZED",
    })
    await respondToAuthorizedMessage({
      parsed,
      update,
      message,
      userId,
      signal,
      interaction,
      logStage,
      respondToMenuCommand,
      respondToReadCommand,
      executeControl,
      sendMessage,
      buildNavigationKeyboard,
    })
  }


  return {
    respondToUpdate,
    logStage,
    pendingConfirmations,
    diagnostics,
  }
}