export async function handleNavigationCallback({
  navigation,
  callback,
  chat,
  messageId,
  userId,
  signal,
  interaction,
  logStage,
  answerCallback,
  editPage,
}) {
  logStage({
    interaction,
    message: "Telegram command STARTED",
    stage: "COMMAND_STARTED",
  })
  await answerCallback({
    callbackId: callback.id,
    signal,
    interaction,
  })
  await editPage({
    page: navigation[2],
    chatId: chat.id,
    messageId,
    userId,
    signal,
    interaction,
  })
}

export async function handleMarketSelectionCallback({
  ask,
  update,
  callback,
  chat,
  messageId,
  userId,
  signal,
  interaction,
  logStage,
  pendingConfirmations,
  confirmationTtlMs,
  answerCallback,
  editMessage,
}) {
  const [, action, symbol] = ask
  interaction.action = action
  interaction.symbol = symbol
  logStage({
    interaction,
    message: "Telegram market selection RECEIVED",
    stage: "MARKET_SELECTION_RECEIVED",
  })
  const token = String(update.update_id)
  const now = Date.now()
  for (const [pendingToken, pending] of pendingConfirmations) {
    if (pending.expiresAt < now) {
      pendingConfirmations.delete(pendingToken)
    }
  }
  while (pendingConfirmations.size >= 1000) {
    pendingConfirmations.delete(pendingConfirmations.keys().next().value)
  }
  pendingConfirmations.set(token, {
    action: ask[1],
    symbol: ask[2],
    userId,
    chatId: String(chat.id),
    messageId,
    expiresAt: now + confirmationTtlMs,
  })
  await answerCallback({
    callbackId: callback.id,
    text: "Review the confirmation prompt.",
    signal,
    interaction,
  })
  logStage({
    interaction,
    message: "Telegram confirmation REQUESTED",
    stage: "CONFIRMATION_REQUESTED",
    fields: {
      confirmationExpiresInMs: confirmationTtlMs,
    },
  })
  await editMessage({
    chatId: chat.id,
    messageId,
    text: `Confirm ${ask[1].toLowerCase()} of ${ask[2]}? No action has been taken yet.`,
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: `Confirm ${ask[1].toLowerCase()}`,
            callback_data: `cc:confirm:${ask[1]}:${ask[2]}:${token}`,
          },
          {
            text: "Cancel",
            callback_data: `cc:cancel:${token}`,
          },
        ],
        [
          {
            text: "Main menu",
            callback_data: "cc:nav:home",
          },
        ],
      ],
    },
    signal,
    interaction,
  })
}

export async function handleConfirmationCallback({
  confirm,
  callback,
  chat,
  messageId,
  userId,
  signal,
  interaction,
  logStage,
  pendingConfirmations,
  answerCallback,
  editMessage,
  executeControl,
  buildNavigationKeyboard,
}) {
  const pending = pendingConfirmations.get(confirm[3])
  const valid = pending &&
    pending.action === confirm[1] &&
    pending.symbol === confirm[2] &&
    pending.userId === userId &&
    pending.chatId === String(chat.id) &&
    pending.messageId === messageId &&
    pending.expiresAt >= Date.now()
  if (!valid) {
    pendingConfirmations.delete(confirm[3])
    logStage({
      interaction,
      message: "Telegram interaction REJECTED",
      stage: "CONFIRMATION_VALIDATION",
      level: "warn",
      fields: {
        reason: "STALE_OR_REPLAYED_CONFIRMATION",
      },
    })
    await answerCallback({
      callbackId: callback.id,
      text: "Confirmation expired or already used. Start again.",
      signal,
      interaction,
    })
    await editMessage({
      chatId: chat.id,
      messageId,
      text: "Confirmation expired or already used. No action was taken.",
      replyMarkup: buildNavigationKeyboard(),
      signal,
      interaction,
    })
    return
  }
  const [, action, symbol] = confirm
  interaction.action = action
  interaction.symbol = symbol
  logStage({
    interaction,
    message: "Telegram confirmation RECEIVED",
    stage: "CONFIRMATION_RECEIVED",
  })
  const acknowledgement = await answerCallback({
    callbackId: callback.id,
    text: "Processing confirmed action.",
    signal,
    interaction,
  })
  if (acknowledgement === undefined) {
    return
  }
  pendingConfirmations.delete(confirm[3])
  await executeControl({
    action: pending.action,
    symbol: pending.symbol,
    userId,
    requestId: `telegram:callback:${callback.id}`,
    chatId: chat.id,
    messageId,
    signal,
    interaction,
  })
}

export async function handleCancelCallback({
  cancel,
  callback,
  chat,
  messageId,
  userId,
  signal,
  interaction,
  logStage,
  pendingConfirmations,
  answerCallback,
  editMessage,
  buildNavigationKeyboard,
}) {
  const pending = pendingConfirmations.get(cancel[1])
  const canCancel = pending &&
    pending.userId === userId &&
    pending.chatId === String(chat.id) &&
    pending.messageId === messageId
  interaction.action = "CANCEL"
  logStage({
    interaction,
    message: "Telegram confirmation CANCEL REQUESTED",
    stage: "CONFIRMATION_CANCEL_REQUESTED",
  })
  await answerCallback({
    callbackId: callback.id,
    text: "Cancelled.",
    signal,
    interaction,
  })
  if (canCancel) {
    pendingConfirmations.delete(cancel[1])
  }
  logStage({
    interaction,
    message: "Telegram confirmation CANCELLED",
    stage: "CONFIRMATION_CANCELLED",
  })
  await editMessage({
    chatId: chat.id,
    messageId,
    text: "Control action cancelled. No action was taken.",
    replyMarkup: buildNavigationKeyboard(),
    signal,
    interaction,
  })
}
