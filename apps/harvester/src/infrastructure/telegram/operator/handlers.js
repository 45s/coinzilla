import { createTelegramOperatorDiagnostics } from "./diagnostics.js"
import { createNavigationKeyboard } from "./keyboard.js"
import { readTelegramOperatorPage } from "./pages.js"
import { executeTelegramOperatorControl } from "./controls.js"
import { createTelegramMessageApi } from "./transport.js"
import { respondToTelegramUpdate } from "./routing.js"

export function createTelegramOperatorHandlers({
  botToken,
  operator,
  allowedUsers,
  callApi,
  logger,
  getBotUsername,
}) {
  const pendingConfirmations = new Map()
  const confirmationTtlMs = 5 * 60 * 1000
  const diagnostics = createTelegramOperatorDiagnostics({ logger,
 botToken })
  const logStage = ({ interaction,
 message,
 stage,
 level = "info",
 fields = {} }) => {
    interaction.stage = stage
    diagnostics.log({ interaction,
 message,
 level,
 fields: { stage,
 ...fields } })
  }
  const messageApi = createTelegramMessageApi({ callApi,
 logStage })
  const buildNavigationKeyboard = createNavigationKeyboard
  const readPage = (options) => readTelegramOperatorPage({
    ...options,
    operator,
    diagnostics,
    logStage,
    buildNavigationKeyboard,
  })
  const editPage = async ({ page,
 chatId,
 messageId,
 userId,
 signal,
 interaction }) => {
    const rendered = await readPage({ page,
 userId,
 interaction })
    await messageApi.editMessage({
      chatId,
      messageId,
      text: rendered.text,
      replyMarkup: rendered.keyboard,
      signal,
      interaction,
    })
  }
  const executeControl = (request) => executeTelegramOperatorControl({
    ...request,
    operator,
    diagnostics,
    logStage,
    sendMessage: messageApi.sendMessage,
    editMessage: messageApi.editMessage,
    buildNavigationKeyboard,
  })
  const context = {
    allowedUsers,
    getBotUsername,
    logStage,
    ...messageApi,
    readPage,
    editPage,
    executeControl,
    buildNavigationKeyboard,
    pendingConfirmations,
    confirmationTtlMs,
  }
  const respondToUpdate = (request) => respondToTelegramUpdate({ ...request,
 context })
  return { respondToUpdate,
 logStage,
 pendingConfirmations,
 diagnostics }
}