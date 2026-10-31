import { TelegramNotifier, subscribeTelegramNotifications } from "@coinzilla/notifiers"
import { defaultLogger, handleErr, toResult } from "@coinzilla/utils"

/**
 * Prepare optional Telegram notifications for the Free-Roll application.
 * Both credentials absent disables notifications; supplying only one is a configuration error.
 */
export function prepareTelegramNotifications({
  eventBus,
  logger = defaultLogger,
  env = process.env,
  createNotifier = (options) => new TelegramNotifier(options),
} = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return toResult({ error: new TypeError("env must be an object") })
  }

  const token = env.TELEGRAM_BOT_TOKEN
  const chatId = env.TELEGRAM_CHAT_ID

  if (!token && !chatId) {
    return toResult({ data: null })
  }

  if (
    typeof token !== "string" ||
    token.trim() === "" ||
    !(typeof chatId === "string" || (typeof chatId === "number" && Number.isSafeInteger(chatId))) ||
    String(chatId).trim() === ""
  ) {
    return toResult({
      error: new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be configured"),
    })
  }

  try {
    const notifier = createNotifier({ token, chatId })
    const notifications = subscribeTelegramNotifications({
      eventBus,
      notifier,
      logger,
    })

    return toResult({ data: notifications })
  } catch (error) {
    try {
      handleErr({
        logger,
        error,
        where: "prepareTelegramNotifications()",
      })
    } catch {
      // Logging must not hide the original setup error.
    }

    return toResult({ error })
  }
}
