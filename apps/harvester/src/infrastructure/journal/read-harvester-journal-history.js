import { readdir } from "node:fs/promises"
import path from "node:path"
import { Journal } from "@coinzilla/journal"
import { toResult } from "@coinzilla/utils"

/**
 * Read legacy flat Journal sessions and the newer per-process session folders.
 * Legacy records are returned first; new folders follow their UTC/session-ID order.
 *
 * @param {{ directory: string, journalFactory?: (options: object) => object, logger?: object }} input
 * @returns {Promise<object>} Combined validated Journal records or the first read failure.
 */
export async function readHarvesterJournalHistory({
  directory,
  journalFactory = (options) => new Journal(options),
  logger = { info() {}, error() {} },
} = {}) {
  try {
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new TypeError("Harvester Journal history directory must be a non-empty string")
    }
    if (typeof journalFactory !== "function") {
      throw new TypeError("Harvester Journal history journalFactory must be a function")
    }

    const rootDirectory = path.resolve(directory)
    let sessionEntries = []
    try {
      sessionEntries = await readdir(path.join(rootDirectory, "sessions"), { withFileTypes: true })
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }

    const sessionDirectories = sessionEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(rootDirectory, "sessions", entry.name))
      .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    const records = []

    for (const journalDirectory of [rootDirectory, ...sessionDirectories]) {
      const journal = journalFactory({ directory: journalDirectory, logger })
      if (typeof journal?.read !== "function") {
        throw new TypeError("Harvester Journal history reader must provide read()")
      }
      const result = await journal.read()
      if (result?.ok !== true) {
        if (result?.ok === false) return result
        return toResult({ error: new TypeError("Harvester Journal history read returned an invalid result") })
      }
      records.push(...result.records)
    }

    return toResult({ records, count: records.length })
  } catch (error) {
    return toResult({ error })
  }
}
