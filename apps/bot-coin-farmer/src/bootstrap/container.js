import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createEventBusAdapter } from "../infrastructure/event-bus/event-bus-adapter.js"
import { createJournalAdapter } from "../infrastructure/journal/journal-adapter.js"
import { createLoggerAdapter } from "../infrastructure/logging/logger-adapter.js"
import { assertEventBusPort } from "../ports/event-bus.js"
import { assertJournalPort } from "../ports/journal.js"

const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
)

/**
 * Compose the runtime without opening broker connections or enabling trading.
 *
 * @param {{
 *   config: object,
 *   logger?: object,
 *   eventBus?: object,
 *   journal?: object,
 *   journalDirectory?: string
 * }} options
 */
export function createContainer({
  config,
  logger,
  eventBus,
  journal,
  journalDirectory = resolve(PACKAGE_ROOT, "logs"),
} = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("A validated config object is required")
  }

  const loggerAdapter = createLoggerAdapter({ logger })
  const runtimeEventBus = eventBus ?? createEventBusAdapter({
    logger: loggerAdapter,
  })
  const runtimeJournal = journal ?? createJournalAdapter({
    eventBus: runtimeEventBus,
    directory: journalDirectory,
    logger: loggerAdapter,
  })

  assertEventBusPort(runtimeEventBus)
  assertJournalPort(runtimeJournal)

  return {
    config,
    logger: loggerAdapter,
    eventBus: runtimeEventBus,
    journal: runtimeJournal,
    state: "created",
    shutdownPromise: null,
  }
}
