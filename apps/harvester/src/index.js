import { pathToFileURL } from "node:url"
import { EventBus } from "@coinzilla/event-bus"
import { makeEventPublisher } from "./application/events/event-publisher.js"
import { prepareOptionalJournal } from "./infrastructure/journal/prepare-optional-journal.js"
import { defaultLogger } from "@coinzilla/utils"
import { startHarvester } from "./bootstrap/start-harvester.js"

const describeError = (error) => {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      errors: [...error.errors].map(describeError),
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? describeError(error.cause) : undefined,
    }
  }
  return { message: String(error) }
}

export async function main({
  start = startHarvester,
  logger = defaultLogger,
  createEventBus = ({ logger: eventBusLogger } = {}) => new EventBus({ logger: eventBusLogger }),
  createJournalService = prepareOptionalJournal,
  env = process.env,
} = {}) {
  try {
    const eventBus = createEventBus({ logger })
    const eventPublisher = makeEventPublisher({ eventBus, logger })
    const journalService = createJournalService({
      eventBus,
      logger,
      enabled: env.HARVESTER_JOURNAL_ENABLED?.toLowerCase() !== "false",
      directory: env.HARVESTER_JOURNAL_DIRECTORY,
    })
    logger.debug?.({ message: "Harvester process startup requested" })
    const runtime = await start({ eventPublisher })
    logger.debug?.({
      message: "Harvester bootstrap completed",
      connected: runtime.connected === true,
      tradingEnabled: runtime.tradingEnabled === true,
      strategyMode: runtime.strategyMode ?? "read-only",
      subscriptions: runtime.subscriptions ?? [],
    })
    const startupMessage = runtime.connected
      ? runtime.tradingEnabled && runtime.strategyMode === "conservative"
        ? "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness."
        : "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s) in read-only mode; order execution is disabled."
      : "Harvester configuration validated; broker connection and market data are disabled."
    logger.info(startupMessage)

    if (runtime.connected && typeof runtime.stop === "function") {
      let shuttingDown = false
      const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true
        try {
          await runtime.stop()
          logger.info("Harvester broker disconnected.")
        } catch (error) {
          logger.error({ message: "Harvester shutdown failed.", error })
          process.exitCode = 1
        }
      }
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    }
    return { runtime, journalService }
  } catch (error) {
    logger.error({
      message: "Harvester startup failed.",
      error,
      errorDetails: describeError(error),
    })
    process.exitCode = 1
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) await main()
