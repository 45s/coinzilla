import { createTelegramInteraction } from "./telegram-operator-interaction.js"

const MAX_RETRY_DELAY_MS = 30000

export async function processTelegramUpdate({
  update,
  botUsername,
  signal,
  respondToUpdate,
  diagnostics,
  logStage,
}) {
  const interaction = createTelegramInteraction({
    update,
    botUsername,
  })
  logStage({
    interaction,
    message: "Telegram update RECEIVED",
    stage: "UPDATE_RECEIVED",
  })
  try {
    await respondToUpdate({
      update,
      signal,
      interaction,
    })
  } catch (error) {
    diagnostics.fail({
      interaction,
      error,
      stage: interaction.stage,
    })
    return {
      interaction,
      error,
    }
  }
  let outcome = "SUCCESS"
  let completionMessage = "Telegram interaction COMPLETED"
  let completionStage = "COMPLETED"
  if (interaction.failed) {
    outcome = "FAILURE_REPORTED"
    completionMessage = "Telegram interaction HANDLED"
    completionStage = "HANDLED"
  } else if (interaction.rejected) {
    outcome = "REJECTED"
    completionMessage = "Telegram interaction HANDLED"
    completionStage = "HANDLED"
  }
  logStage({
    interaction,
    message: completionMessage,
    stage: completionStage,
    fields: { outcome },
  })
  return { interaction }
}

export function waitForRetry({ milliseconds, signal }) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    let timer = null
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    timer = setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
    if (signal.aborted) {finish()}
  })
}


export async function pollTelegramOperatorUpdates({ signal, offsetState, botUsername, callApi, respondToUpdate, diagnostics, logger, retryDelayMs, pollTimeoutSeconds, logStage }) {
    let currentRetryDelay = retryDelayMs
    while (!signal.aborted) {
      let failedInteraction
      try {
        const payload = {
          timeout: pollTimeoutSeconds,
          allowed_updates: ["message", "callback_query"],
        }
        if (offsetState.value !== undefined) {payload.offset = offsetState.value}
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
          const processed = await processTelegramUpdate({
            update,
            botUsername,
            signal,
            respondToUpdate,
            diagnostics,
            logStage,
          })
          if (processed.error) {
            failedInteraction = processed.interaction
            throw processed.error
          }
          offsetState.value = update.update_id + 1
        }
        currentRetryDelay = retryDelayMs
      } catch (error) {
        if (signal.aborted) {break}
        if (failedInteraction) {
          logStage({
            interaction: failedInteraction,
            message: "Telegram polling retry scheduled",
            stage: "RETRY_SCHEDULED",
            fields: {
              retryDelayMs: Number.isSafeInteger(error?.retryAfter)
                ? Math.min(error.retryAfter * 1000, MAX_RETRY_DELAY_MS)
                : currentRetryDelay,
            },
          })
        } else {
          const errorDetails = diagnostics.describeError(error)
          logger?.warn?.({
            message: "Telegram polling FAILED; retrying",
            component: "harvester.operator",
            operation: "getUpdates",
            failureClassification: errorDetails.code ?? errorDetails.name,
            errorDetails,
          })
        }
        const retryAfterMs = Number.isSafeInteger(error?.retryAfter)
          ? Math.min(error.retryAfter * 1000, MAX_RETRY_DELAY_MS)
          : currentRetryDelay
        await waitForRetry({
          milliseconds: retryAfterMs,
          signal,
        })
        currentRetryDelay = Math.min(currentRetryDelay * 2, MAX_RETRY_DELAY_MS)
      }
    }
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