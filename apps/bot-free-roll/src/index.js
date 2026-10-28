import { EventBus } from "@coinzilla/event-bus"
import { defaultLogger as logger } from "@coinzilla/utils"

import tradingConfig from "../trading-config.json" with { type: "json" }

import { prepareBroker } from "./prepare-broker.js"
import { prepareJournal } from "./prepare-journal.js"
import { FreeRollBot } from "./bot/index.js"
import { validateTradingConfig } from "./validate-config.js"

const validatedTradingConfig = validateTradingConfig({ tradingConfig })

if (!validatedTradingConfig.ok) {
  throw new Error(
    `Invalid trading config:\n- ${validatedTradingConfig.errors.join("\n- ")}`,
  )
}

const eventBus = new EventBus({ logger })
const { data: journal } = prepareJournal({
  eventBus,
  logger,
  folderPath: "../../../logs_bot-free-roll",
})

const { data: broker } = await prepareBroker()

const bot = new FreeRollBot({
  broker,
  eventBus,
  tradingConfig,
})

let shuttingDown = false

async function shutdown() {
  const startedAt = Date.now()
  const errors = []
  const TIMEOUT_MS = 10_000
  let stage = "initialization"

  // Use synchronous stderr so diagnostics don't depend on the logger,
  // event bus, journal, or asynchronous stdout flushing.
  function debug(message, details) {
    try {
      const suffix =
        details === undefined
          ? ""
          : ` ${JSON.stringify(details, (_, value) => {
              if (value instanceof Error) {
                return {
                  name: value.name,
                  message: value.message,
                  stack: value.stack,
                  code: value.code,
                }
              }

              if (typeof value === "bigint") return value.toString()
              return value
            })}`

      process.stderr.write(
        `[SHUTDOWN +${Date.now() - startedAt}ms] ${message}${suffix}\n`,
      )
    } catch (loggingError) {
      try {
        process.stderr.write(
          `[SHUTDOWN] Diagnostic logging failed: ${String(loggingError)}\n`,
        )
      } catch {
        // Nothing else can safely be done if stderr itself fails.
      }
    }
  }

  function recordError(label, error) {
    errors.push({ stage: label, error })

    debug(`ERROR: ${label}`, {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
              code: error.code,
            }
          : String(error),
    })

    try {
      logger.error?.(`[bot] Shutdown error: ${label}`, { error })
    } catch (loggerError) {
      debug("Logger also failed", String(loggerError))
    }
  }

  async function runStage(label, operation, timeoutMs = TIMEOUT_MS) {
    stage = label
    debug(`START: ${label}`)

    let timeoutId

    try {
      // The timeout prevents shutdown from waiting forever for a promise.
      // Note: it does not cancel the underlying operation.
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        timeoutId.unref?.()
      })

      const result = await Promise.race([
        Promise.resolve().then(operation),
        timeout,
      ])

      debug(`SUCCESS: ${label}`, result)
      return { ok: true, result }
    } catch (error) {
      recordError(label, error)
      return { ok: false, error }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  debug("01: shutdown() ENTERED")

  try {
    debug("02: Checking shutdown guard", {
      shuttingDownType: typeof shuttingDown,
      shuttingDownValue: shuttingDown,
    })

    if (shuttingDown) {
      debug("03: Already shutting down; exiting duplicate invocation")
      return
    }

    shuttingDown = true
    debug("04: Shutdown guard set")

    debug("05: Current runtime state", {
      hasBroker: Boolean(broker),
      hasBot: Boolean(bot),
      hasEventBus: Boolean(eventBus),
      hasJournal: Boolean(journal),
      exitCode: process.exitCode,
    })

    // Stage 1: stop the bot. Do this before disconnecting the broker
    // so the bot can finish any broker-dependent cleanup.
    if (bot) {
      await runStage("bot.stop()", () => bot.stop())
    } else {
      debug("SKIP: bot.stop() — bot is not initialized")
    }

    // Stage 2: disconnect the exchange connection.
    if (broker) {
      await runStage("broker.disconnect()", () => broker.disconnect())
    } else {
      debug("SKIP: broker.disconnect() — broker is not initialized")
    }

    // Stage 3: publish a final strategy/accounting snapshot while the
    // journal is still active. Wallet figures are included only when
    // confirmed by Binance account-position events.
    await runStage("final trading summary", () => {
      const summary = bot.getSummary()
      logger.info?.("Final trading summary", summary)

      const result = eventBus.publish({
        name: "trading.summary",
        source: "free-roll-bot",
        data: {
          reason: "bot_shutdown",
          summary,
        },
      })

      if (!result?.ok) {
        throw new Error(`eventBus.publish failed: ${JSON.stringify(result)}`)
      }

      return summary
    })

    // Stage 4: publish bot.stopped while the journal is still subscribed.
    await runStage("eventBus.publish(bot.stopped)", () => {
      const result = eventBus.publish({
        name: "bot.stopped",
        source: "free-roll-bot",
      })

      debug("bot.stopped publish returned", result)

      if (!result?.ok) {
        throw new Error(`eventBus.publish failed: ${JSON.stringify(result)}`)
      }

      return result
    })

    // Stage 5: flush pending event handlers and close the journal.
    await runStage("journal.close()", async () => {
      const result = await journal.close()

      if (!result?.ok) {
        throw new Error(`journal.close failed: ${JSON.stringify(result)}`)
      }

      return result
    })

    // Stage 6: close the event bus after the journal has flushed.
    await runStage("eventBus.close()", async () => {
      const result = await eventBus.close()

      if (!result?.ok) {
        throw new Error(`eventBus.close failed: ${JSON.stringify(result)}`)
      }

      return result
    })

    stage = "finalization"

    if (errors.length > 0) {
      process.exitCode = 1

      debug("SHUTDOWN COMPLETED WITH ERRORS", {
        errorCount: errors.length,
        failedStages: errors.map((item) => item.stage),
      })
    } else {
      debug("SHUTDOWN COMPLETED SUCCESSFULLY")
    }
  } catch (error) {
    recordError(`unexpected failure at stage "${stage}"`, error)
    process.exitCode = 1
  } finally {
    debug("FINALIZER ENTERED", {
      stage,
      errorCount: errors.length,
      elapsedMs: Date.now() - startedAt,
    })

    // Do not call process.exit() here. It could truncate pending output
    // or journal writes. Let Node exit naturally after handles close.
    try {
      logger.info?.("[bot] Shutdown function finished", {
        stage,
        errorCount: errors.length,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      debug("Final logger call failed", String(error))
    }

    debug("SHUTDOWN FUNCTION RETURNING", {
      exitCode: process.exitCode,
      errorCount: errors.length,
    })
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown().catch((error) => {
      logger.error?.("[bot] Shutdown failed", { error })
      process.exitCode = 1
    })
  })
}

try {
  const journalResult = await journal.start()

  if (!journalResult.ok) {
    throw new Error("Failed to start journal", {
      cause: journalResult.errors,
    })
  }

  eventBus.subscribe({
    name: "order.filled",
    handler: async ({ data }) => {
      logger.info?.("Order filled", {
        orderId: data.orderId,
        symbol: data.symbol,
        side: data.side,
        price: data.price,
        quantity: data.quantity,
      })
    },
  })

  const flushResult = await journal.flush()

  if (!flushResult.ok) {
    throw new Error("Failed to flush journal", {
      cause: flushResult.errors,
    })
  }

  eventBus.publish({
    name: "bot.started",
    source: "free-roll-bot",
    data: {
      pid: process.pid,
    },
  })

  await bot.run()

  eventBus.publish({
    name: "bot.ready",
    source: "free-roll-bot",
    data: {
      pid: process.pid,
      pairs: Object.keys(tradingConfig.strategies["free-roll"].pairs),
    },
  })
} catch (error) {
  logger.error?.("[bot] Failed", { error })

  if (!shuttingDown) {
    await shutdown()
  }

  process.exitCode = 1
}
