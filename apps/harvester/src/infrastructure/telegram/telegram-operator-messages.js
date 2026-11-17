import { getInvalidCommandUsage } from "./telegram-operator-commands.js"

export async function respondToAuthorizedMessage({
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
}) {
  if (await respondToMenuCommand({ parsed,
message,
userId,
signal,
interaction })) {
    return
  }
  if (await respondToReadCommand({ parsed,
message,
userId,
signal,
interaction })) {
    return
  }
  logStage({
    interaction,
    message: "Telegram command STARTED",
    stage: "COMMAND_STARTED",
  })
  if (parsed.type === "UNSUPPORTED") {
    await sendMessage({
      chatId: message.chat.id,
      text: "Unknown command. Use /help to see available commands.",
      replyMarkup: buildNavigationKeyboard(),
      signal,
      interaction,
    })
    return
  }
  if (parsed.type === "INVALID") {
    const text = getInvalidCommandUsage(parsed.command)
    await sendMessage({
      chatId: message.chat.id,
      text,
      signal,
      interaction,
    })
    return
  }
  const action = parsed.type
  await executeControl({
    action,
    symbol: parsed.symbol,
    userId,
    requestId: `telegram:${update.update_id}:${message.date ?? "0"}:${userId}`,
    chatId: message.chat.id,
    signal,
    interaction,
  })
}



