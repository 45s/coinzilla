import { fileURLToPath } from "node:url"
import path from "node:path"
import { Journal } from "@coinzilla/journal"
import { toResult, defaultLogger, handleErr } from "@coinzilla/utils"

export function prepareJournal({
  eventBus,
  logger = defaultLogger,
  folderPath,
}) {
  try {
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      folderPath,
    )
    const journal = new Journal({
      eventBus,
      directory,
      logger,
    })
    return toResult({ data: journal })
  } catch (error) {
    handleErr({
      logger,
      error,
      where: "prepareJournal()",
    })
  }
}
