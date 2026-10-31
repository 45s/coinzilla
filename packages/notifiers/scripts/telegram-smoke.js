import path from "node:path"
import { fileURLToPath } from "node:url"
import { TelegramNotifier } from "../src/index.js"

/**
 * Send one explicitly requested live Telegram test message.
 * This is intentionally separate from the default test suite and CI.
 */
export async function runTelegramSmokeTest({
  env = process.env,
  createNotifier = (options) => new TelegramNotifier(options),
  now = () => new Date(),
} = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("env must be an object")
  }

  const token = env.TELEGRAM_BOT_TOKEN
  const chatId = env.TELEGRAM_CHAT_ID

  if (
    typeof token !== "string" ||
    token.trim() === "" ||
    !(
      typeof chatId === "string" ||
      (typeof chatId === "number" && Number.isSafeInteger(chatId))
    ) ||
    String(chatId).trim() === ""
  ) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be configured for the live smoke test",
    )
  }

  const timestamp = now()
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
    throw new TypeError("now() must return a valid Date")
  }

  const notifier = createNotifier({ token, chatId })
  if (!notifier || typeof notifier.sendMessage !== "function") {
    throw new TypeError("createNotifier() must return an object exposing sendMessage()")
  }

  const message = [
    "🧪 COINZILLA TELEGRAM SMOKE TEST",
    "This confirms the configured bot can post to this chat.",
    `Time: ${timestamp.toISOString()}`,
  ].join("\n")

  const result = await notifier.sendMessage(message)
  if (
    !result ||
    !Number.isSafeInteger(result.message_id) ||
    result.message_id < 1
  ) {
    throw new TypeError("Telegram smoke test returned an invalid message_id")
  }

  return Object.freeze({ messageId: result.message_id })
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  try {
    const { messageId } = await runTelegramSmokeTest()
    console.info(
      `Telegram smoke test accepted by Telegram (message_id=${messageId}).`,
    )
  } catch (error) {
    console.error(
      `Telegram smoke test failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
