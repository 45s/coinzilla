import { fileURLToPath } from "node:url"
import path from "node:path"
import { Journal } from "@coinzilla/journal"
import { defaultLogger, toResult } from "@coinzilla/utils"

const APPLICATION_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../",
)

function reportConstructionFailure({ logger, error }) {
  try {
    logger?.error?.({
      message: "Optional Harvester Journal setup failed",
      errorName: error?.name ?? "Error",
    })
  } catch {
    // Optional observability and its diagnostics must not affect startup.
  }
}

function resolveJournalDirectory({ directory }) {
  if (directory === undefined) return path.resolve(APPLICATION_DIRECTORY, "logs")
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new TypeError("Harvester Journal directory must be a non-empty string")
  }
  return path.resolve(APPLICATION_DIRECTORY, directory)
}

/**
 * Compose and start the Journal without blocking read-only startup.
 * Trading startup explicitly awaits ready and uses flush() before any order.
 * */
export function prepareOptionalJournal({
  eventBus,
  directory,
  enabled = true,
  logger = defaultLogger,
  journalFactory = (options) => new Journal(options),
} = {}) {
  let state = enabled ? "starting" : "disabled"
  let journal

  const reportFailure = ({ error }) => reportConstructionFailure({ logger, error })

  if (!enabled) {
    const ready = Promise.resolve(toResult({ disabled: true }))
    const recovery = Promise.resolve(toResult({
      records: [],
      count: 0,
      sessions: [],
      bytesRead: 0,
      available: false,
      disabled: true,
    }))
    return Object.freeze({
      ready,
      recovery,
      get status() {
        return Object.freeze({
          state,
          enabled: false,
          started: false,
          writeFailed: false,
          writeErrorCount: 0,
          closed: false,
          recoveryAvailable: false,
        })
      },
      flush: async () => toResult({ error: new Error("Durable account audit requires an enabled Journal") }),
      close: async () => toResult({ closed: true, disabled: true }),
    })
  }

  let ready
  let recoveryResult
  try {
    if (typeof journalFactory !== "function") {
      throw new TypeError("journalFactory must be a function")
    }
    journal = journalFactory({
      eventBus,
      directory: resolveJournalDirectory({ directory }),
      logger,
    })
    if (!journal || typeof journal.start !== "function" || typeof journal.close !== "function") {
      throw new TypeError("Journal implementation must provide start() and close()")
    }

    ready = Promise.resolve()
      .then(async () => {
        if (typeof journal.read === "function") {
          const readResult = await journal.read()
          if (readResult?.ok === true && Array.isArray(readResult.records)) {
            recoveryResult = toResult({
              records: readResult.records,
              count: readResult.count ?? readResult.records.length,
              sessions: readResult.sessions ?? [],
              bytesRead: readResult.bytesRead ?? 0,
              available: true,
            })
          } else if (readResult?.errors?.some((error) => error?.code === "JOURNAL_DIRECTORY_NOT_FOUND")) {
            recoveryResult = toResult({
              records: [],
              count: 0,
              sessions: [],
              bytesRead: 0,
              available: true,
              empty: true,
            })
          } else {
            state = "failed"
            return readResult?.ok === false
              ? readResult
              : toResult({ error: new TypeError("Journal read returned an invalid recovery snapshot") })
          }
        } else {
          recoveryResult = toResult({
            records: [],
            count: 0,
            sessions: [],
            bytesRead: 0,
            available: false,
          })
        }
        return journal.start()
      })
      .then((result) => {
        if (result?.ok === true) {
          state = "ready"
          return result
        }
        state = "failed"
        return result?.ok === false
          ? result
          : toResult({ error: new TypeError("Journal start returned an invalid result") })
      })
      .catch((error) => {
        state = "failed"
        reportFailure({ error })
        return toResult({ error })
      })
  } catch (error) {
    state = "failed"
    reportFailure({ error })
    ready = Promise.resolve(toResult({ error }))
  }
  const recovery = ready.then((result) =>
    result?.ok === true
      ? recoveryResult
      : result,
  )

  const getStatus = () => {
    const writeFailed = journal?.writeFailed === true
    const currentState = state === "ready" && writeFailed ? "degraded" : state
    return Object.freeze({
      state: currentState,
      enabled: true,
      started: journal?.started === true,
      writeFailed,
      writeErrorCount: Array.isArray(journal?.writeErrors) ? journal.writeErrors.length : 0,
      closed: journal?.closed === true,
      recoveryAvailable: recoveryResult?.available === true,
    })
  }

  const flush = async () => {
    const startResult = await ready
    if (!startResult.ok || !journal) return startResult
    if (typeof journal.flush !== "function") {
      return toResult({ error: new TypeError("Journal implementation must provide flush() for durable account audits") })
    }
    try {
      const result = await journal.flush()
      if (result?.ok !== true) state = "degraded"
      return result?.ok === true ? result : result?.ok === false ? result
        : toResult({ error: new TypeError("Journal flush returned an invalid result") })
    } catch (error) {
      state = "degraded"
      reportFailure({ error })
      return toResult({ error })
    }
  }

  const close = async () => {
    const startResult = await ready
    if (!startResult.ok || !journal) return startResult

    try {
      const result = await journal.close()
      state = result?.ok === true ? "closed" : "close_failed"
      return result?.ok === true
        ? result
        : result?.ok === false
          ? result
          : toResult({ error: new TypeError("Journal close returned an invalid result") })
    } catch (error) {
      state = "close_failed"
      reportFailure({ error })
      return toResult({ error })
    }
  }

  return Object.freeze({
    ready,
    recovery,
    get status() {
      return getStatus()
    },
    flush,
    close,
  })
}
