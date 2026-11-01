import { Journal } from "@coinzilla/journal"

export function createJournalAdapter({ eventBus, directory, logger } = {}) {
  return new Journal({ eventBus, directory, logger })
}
