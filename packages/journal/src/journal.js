import { FileSystemJournalStore } from "./adapters/filesystem-journal-store.js"
import { JOURNAL_STORE } from "./journal-store-injection.js"

import { defaultLogger, toResult } from "@coinzilla/utils"
import { serializeJournalRecord } from "./helpers/journal-record.js"
import { readJournalRecords } from "./read-journal-records.js"
import { replayJournalRecords } from "./replay-journal-records.js"


/**
 * Persist EventBus source events as ordered JSONL records and recover them later.
 * Journal preserves event fields and adds its own stable identity/schema metadata;
 * consumers retain ownership of business interpretation and replay effects.
 *
 * @param {object} options
 * @param {object} options.eventBus - EventBus exposing subscribeAll({ handler }) and flush().
 * @param {string} options.directory - Directory used for session files and the exclusive writer lock.
 * @param {object} [options.logger] - Optional logger; defaults to the workspace logger.
 */
export class Journal {
  constructor(options = {}) {
    const { eventBus, directory, logger = defaultLogger } = options
    this.eventBus = eventBus
    this.directory = directory
    this.logger = logger
    this.store = options[JOURNAL_STORE] ?? new FileSystemJournalStore({ directory })

    this.filePath = null
    this.subscription = null
    this.writeQueue = Promise.resolve()

    this.started = false
    this.starting = false
    this.closing = false
    this.closed = false
    this.writeErrors = []
    this.writeFailed = false
    this.closeDurable = false
  }

  /**
   * Acquire directory ownership, create a session, and subscribe to EventBus messages.
   *
   * @returns {Promise<object>} Result indicating whether startup succeeded.
   */
  /**
   * Legacy internal compatibility accessor for package-level failure-injection tests.
   * The persistence store remains the sole owner of the session handle.
   *
   * @deprecated
   * @internal
   * @returns {object|null} Active session handle, including a test override when installed.
   */
  get fileHandle() {
    return this.store.sessionHandle
  }

  /**
   * Forward a legacy internal test override to the persistence store.
   *
   * @deprecated
   * @internal
   * @param {object|null} handle - Test handle implementing writeFile(), sync(), and close().
   * @returns {void}
   */
  set fileHandle(handle) {
    this.store.sessionHandle = handle
  }

  async start({} = {}) {
    if (this.started || this.starting || this.closing || this.closed) {
      return toResult({ error: new Error("Journal has already started or closed") })
    }
    if (!this.eventBus || typeof this.eventBus.subscribeAll !== "function") {
      return toResult({ error: new TypeError("A valid eventBus is required") })
    }
    if (typeof this.directory !== "string" || this.directory.trim() === "") {
      return toResult({ error: new TypeError("A journal directory is required") })
    }

    this.starting = true
    try {
      await this.store.ensureDirectory()
      if (this.closing || this.closed) {
        return toResult({ error: new Error("Journal was closed during startup") })
      }
      await this.store.acquireWriter()
      const { filePath } = await this.store.createSession()
      this.filePath = filePath
      if (this.closing || this.closed) {
        const errors = [new Error("Journal was closed during startup")]
        await this.cleanupStoreResources(errors)
        return toResult({ errors })
      }
      const result = this.eventBus.subscribeAll({
        handler: async (event) => {
          const writeResult = await this.record({ event })
          if (!writeResult.ok) {
            this.reportError({ message: "Failed to write journal event", errors: writeResult.errors, eventId: event.id, eventName: event.name })
          }
        },
      })
      if (!result.ok) {
        const errors = [...result.errors]
        await this.cleanupStoreResources(errors)
        return toResult({ errors })
      }
      this.subscription = result.subscription
      this.started = true
      try {
        this.logger.system?.("Journal started", { filePath: this.filePath })
      } catch {
        // Logging must not turn a successful startup into a failure.
      }
      return toResult({ filePath: this.filePath })
    } catch (error) {
      const errors = [error]
      await this.cleanupStoreResources(errors)
      this.reportError({ message: "Failed to start journal", errors })
      return toResult({ errors })
    } finally {
      this.starting = false
    }
  }

  /**
   * Close the session before releasing writer ownership acquired by this start attempt.
   * The store releases only handles and lock files that it owns.
   *
   * @private
   * @param {Error[]} errors - Cleanup errors are appended without replacing the original failure.
   */
  async cleanupStoreResources(errors) {
    try {
      await this.store.closeSession()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.store.releaseWriter()
    } catch (error) {
      errors.push(error)
    }
  }
  async record({ event } = {}) {
    if (!this.started || this.closing || this.closed || !this.filePath) {
      return toResult({
        error: new Error("Journal is not accepting records"),
      })
    }
    if (this.writeFailed) {
      return toResult({
        error: new Error("Journal session is failed after a previous write error"),
      })
    }

    let line
    try {
      line = serializeJournalRecord({ event })
    } catch (error) {
      return toResult({ error })
    }

    const task = this.writeQueue.then(async () => {
      if (this.writeFailed) {
        return toResult({
          error: new Error("Journal session is failed after a previous write error"),
        })
      }
      try {
        await this.store.append(line)
        return toResult({ written: true, durable: false, recordId: event.id })
      } catch (error) {
        this.writeFailed = true
        this.writeErrors.push(error)
        return toResult({ error })
      }
    })

    this.writeQueue = task.then(() => undefined)
    return task
  }

  /**
   * Read and validate all persisted sessions. Call before start or after close.
   * @param {{ maxRecords?: number, maxSessions?: number, maxBytes?: number, maxRecordBytes?: number }} options
   */
  async read({ maxRecords, maxSessions, maxBytes, maxRecordBytes } = {}) {
    if (this.started || this.starting || this.closing) {
      return toResult({ error: new Error("Journal records can only be read while the journal is stopped") })
    }
    return readJournalRecords({
      store: this.store,
      directory: this.directory,
      maxRecords,
      maxSessions,
      maxBytes,
      maxRecordBytes,
    })
  }

  /**
   * Replay a fully validated snapshot in deterministic order.
   * @param {{ handler: (input: { record: object }) => unknown, maxRecords?: number, maxSessions?: number, maxBytes?: number, maxRecordBytes?: number }} options
   */
  async replay({ handler, maxRecords, maxSessions, maxBytes, maxRecordBytes } = {}) {
    if (this.started || this.starting || this.closing) {
      return toResult({ error: new Error("Journal can only be replayed while stopped") })
    }
    return replayJournalRecords({
      store: this.store,
      directory: this.directory,
      handler,
      maxRecords,
      maxSessions,
      maxBytes,
      maxRecordBytes,
    })
  }

  /**
   * Flush EventBus delivery and queued writes, then sync the active session file.
   *
   * @returns {Promise<object>} Result; only successful file-content sync reports durable: true.
   */
  async flush({} = {}) {
    if (!this.started || !this.filePath || this.closing || this.closed) {
      return toResult({ error: new Error("Journal must be started to flush durable records") })
    }

    const errors = []

    try {
      const busResult = await this.eventBus.flush()

      if (!busResult.ok) {
        errors.push(...busResult.errors)
      }
    } catch (error) {
      errors.push(error)
    }

    await this.writeQueue
    errors.push(...this.writeErrors)

    if (errors.length === 0 && this.filePath && !this.closed) {
      try {
        // record() acknowledges a completed write; flush() acknowledges an fsync.
        await this.store.sync()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      return toResult({ errors })
    }

    return toResult({ flushed: true, durable: true, filePath: this.filePath })
  }

  /**
   * Stop accepting events, drain and sync writes, close the session, and release this writer's lock.
   *
   * @returns {Promise<object>} Result describing close and durability success or failure.
   */
  async close({} = {}) {
    if (this.closed) {
      if (!this.closeDurable) {
        return toResult({
          error: new Error("Journal closed without durable confirmation"),
          closed: true,
          durable: false,
        })
      }
      return toResult({ closed: true, durable: true })
    }

    if (this.closing) {
      return toResult({
        error: new Error("Journal is already closing"),
      })
    }

    if (!this.started) {
      this.closed = true
      this.closeDurable = true
      return toResult({ closed: true, durable: true })
    }

    const errors = []

    if (this.subscription) {
      try {
        this.subscription.unsubscribe()
      } catch (error) {
        errors.push(error)
      } finally {
        this.subscription = null
      }
    }

    try {
      const busResult = await this.eventBus.flush()

      if (!busResult.ok) {
        errors.push(...busResult.errors)
      }
    } catch (error) {
      errors.push(error)
    }

    this.closing = true
    await this.writeQueue

    errors.push(...this.writeErrors)
    this.writeErrors = []

    if (this.filePath) {
      try {
        // Sync the final queued writes before closing the session file.
        await this.store.sync()
      } catch (error) {
        errors.push(error)
      }
      try {
        await this.store.closeSession()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await this.store.releaseWriter()
    } catch (error) {
      errors.push(error)
    }
    this.closed = true
    this.started = false
    this.closing = false

    if (errors.length > 0) {
      this.closeDurable = false
      this.reportError({
        message: "Journal closed with errors",
        errors,
        filePath: this.filePath,
      })

      return toResult({ errors })
    }

    this.closeDurable = true
    try {
      this.logger.system?.("Journal closed", {
        filePath: this.filePath,
      })
    } catch {
      // Logging must not turn a completed shutdown into a failure.
    }

    return toResult({
      closed: true,
      durable: true,
      filePath: this.filePath,
    })
  }

  reportError({ message, errors, ...context } = {}) {
    try {
      this.logger.error?.(message, {
        ...context,
        errors,
      })
    } catch {
      // Logging must not interrupt journal cleanup or error reporting.
    }
  }
}
