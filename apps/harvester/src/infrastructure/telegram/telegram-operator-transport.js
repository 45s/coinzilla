export function createTelegramCallApi({ botToken, fetchImpl }) {
  return async ({ method, payload, signal }) => {
    let response
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (cause) {
      const error = new Error(`Telegram API request failed: ${method}`, { cause })
      throw error
    }

    let body
    try {
      body = await response.json()
    } catch (cause) {
      throw new Error(`Telegram API returned invalid JSON: ${method}`, { cause })
    }
    if (!response.ok || body?.ok !== true) {
      const description = typeof body?.description === "string" ? body.description : undefined
      const error = new Error(`Telegram API ${method} failed (HTTP ${response.status})${description ? `: ${description}` : ""}`)
      if (Number.isSafeInteger(body?.parameters?.retry_after) && body.parameters.retry_after > 0) {
        error.retryAfter = body.parameters.retry_after
      }
      throw error
    }
    return body.result
  }
}

export function createTelegramMessageApi({ callApi, logStage }) {
  const sendMessage = async ({ chatId, text, replyMarkup, signal, interaction }) => {
    if (interaction) { interaction.stage = "RESPONSE_DELIVERY" }
    const startedAt = Date.now()
    const result = await callApi({
      method: "sendMessage",
      payload: {
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
      signal,
    })
    if (interaction) {
      logStage({
        interaction,
        message: "Telegram response SENT",
        stage: "RESPONSE_DELIVERED",
        fields: {
          delivery: "SEND_MESSAGE",
          durationMs: Date.now() - startedAt,
        },
      })
    }
    return result
  }

  const editMessage = async ({ chatId, messageId, text, replyMarkup, signal, interaction }) => {
    if (interaction) { interaction.stage = "RESPONSE_DELIVERY" }
    const startedAt = Date.now()
    try {
      const result = await callApi({
        method: "editMessageText",
        payload: {
          chat_id: chatId,
          message_id: messageId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        },
        signal,
      })
      if (interaction) {
        logStage({
          interaction,
          message: "Telegram response SENT",
          stage: "RESPONSE_DELIVERED",
          fields: {
            delivery: "EDIT_MESSAGE",
            durationMs: Date.now() - startedAt,
          },
        })
      }
      return result
    } catch (error) {
      if (/message is not modified/i.test(error?.message ?? "")) {
        if (interaction) {
          logStage({
            interaction,
            message: "Telegram response SENT",
            stage: "RESPONSE_DELIVERED",
            fields: {
              delivery: "ALREADY_CURRENT",
              durationMs: Date.now() - startedAt,
            },
          })
        }
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
        payload: {
          callback_query_id: callbackId,
          ...(text ? { text } : {}),
        },
        signal,
      })
      if (interaction) {
        logStage({
          interaction,
          message: "Telegram callback ACKNOWLEDGED",
          stage: "CALLBACK_ACKNOWLEDGED",
          fields: {
            durationMs: Date.now() - startedAt,
          },
        })
      }
      return result
    } catch (error) {
      if (/query is too old|query id is invalid|query has expired/i.test(error?.message ?? "")) {
        if (interaction) {
          logStage({
            interaction,
            message: "Telegram callback acknowledgement EXPIRED",
            stage: "CALLBACK_ACKNOWLEDGEMENT",
            fields: {
              acknowledged: false,
            },
          })
        }
        return undefined
      }
      throw error
    }
  }
  return {
    sendMessage,
    editMessage,
    answerCallback,
  }
}
