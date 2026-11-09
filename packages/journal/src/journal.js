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
 * @param {{ startedAt: string, runtimeSessionId: string }} [options.sessionIdentity] - Optional process identity used in the session filename.
 * @param {object} [options.logger] - Optional logger; defaults to the workspace logger.
 */
export class Journal {
  constructor(options = {}) {
    const { eventBus, directory, logger = defaultLogger, sessionIdentity } = options
    this.eventBus = eventBus
    this.directory = directory
    this.logger = logger
    this.sessionIdentity = sessionIdentity ?? null
    this.store = options[JOURNAL_STORE] ?? new FileSystemJournalStore({ directory })

    this.filePath = null
    this.subscription = null
    this.writeQueue = Promise.resolve()

    this.started = false
    this.starting = false
    this.startPromise = null
    this.startupCleanupErrors = []
    // Serializes close calls while `closing` remains the later record-admission gate.
    this.closeInProgress = false
    this.flushPromises = new Set()
    this.flushQueue = Promise.resolve()
    this.closing = false
    this.closed = false
    this.writeErrors = []
    this.writeFailed = false
    this.closeDurable = false
  }

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

  /**
   * Acquire directory ownership, create a session, and subscribe to EventBus messages.
   * If close() races with startup, this promise resolves after startup cancellation and rollback.
   *
   * @returns {Promise<object>} Result indicating whether startup succeeded or was cancelled.
   */
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
    const startPromise = this.startLifecycle()
    this.startPromise = startPromise
    return startPromise
  }

  /**
   * Acquire resources and subscribe while the public start() promise tracks completion.
   *
   * @private
   * @returns {Promise<object>} Startup result after success or complete rollback.
   */
  async startLifecycle() {
    try {
      await this.store.ensureDirectory()
      if (this.closing || this.closed) {
        return toResult({ error: new Error("Journal was closed during startup") })
      }
      await this.store.acquireWriter()
      if (this.closing || this.closed) {
        const errors = [new Error("Journal was closed during startup")]
        this.startupCleanupErrors = await this.cleanupStoreResources(errors)
        return toResult({ errors })
      }
      const { filePath } = await this.store.createSession(this.sessionIdentity)
      this.filePath = filePath
      if (this.closing || this.closed) {
        const errors = [new Error("Journal was closed during startup")]
        this.startupCleanupErrors = await this.cleanupStoreResources(errors)
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
        this.startupCleanupErrors = await this.cleanupStoreResources(errors)
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
      this.startupCleanupErrors = await this.cleanupStoreResources(errors)
      this.reportError({ message: "Failed to start journal", errors })
      return toResult({ errors })
    } finally {
      this.starting = false
      this.startPromise = null
    }
  }

  /**
   * Close the session before releasing writer ownership acquired by this start attempt.
   * The store releases only handles and lock files that it owns.
   *
   * @private
   * @param {Error[]} errors - Cleanup errors are appended without replacing the original failure.
   * @returns {Promise<Error[]>} Cleanup errors, also appended to errors.
   */
  async cleanupStoreResources(errors) {
    const cleanupErrors = []
    try {
      await this.store.closeSession()
    } catch (error) {
      errors.push(error)
      cleanupErrors.push(error)
    }
    try {
      await this.store.releaseWriter()
    } catch (error) {
      errors.push(error)
      cleanupErrors.push(error)
    }
    return cleanupErrors
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
   * Concurrent flushes are serialized; close rejects new flushes and waits for accepted flushes.
   *
   * @returns {Promise<object>} Result; only successful file-content sync reports durable: true.
   */
  async flush({} = {}) {
    if (!this.started || !this.filePath || this.closeInProgress || this.closing || this.closed) {
      return toResult({ error: new Error("Journal must be started to flush durable records") })
    }

    const flushPromise = this.flushQueue.then(() => this.flushLifecycle())
    this.flushPromises.add(flushPromise)
    this.flushQueue = flushPromise.then(() => undefined, () => undefined)
    try {
      return await flushPromise
    } finally {
      this.flushPromises.delete(flushPromise)
    }
  }

  /**
   * Drain EventBus delivery and queued writes, then sync the active session file.
   *
   * @private
   * @returns {Promise<object>} Result; only successful file-content sync reports durable: true.
   */
  async flushLifecycle() {
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
   * Serialize close requests, then cancel startup or stop the active writer and release owned resources.
   * A concurrent close is rejected; active writers are drained before new record admission is stopped.
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
    if (this.closeInProgress || this.closing) {
      return toResult({
        error: new Error("Journal is already closing"),
      })
    }

    this.closeInProgress = true
    try {
      return await this.closeLifecycle()
    } finally {
      this.closeInProgress = false
    }
  }

  /**
   * Perform the single owning shutdown sequence after close admission is claimed.
   *
   * @private
   * @returns {Promise<object>} Result describing close and durability success or failure.
   */
  async closeLifecycle() {
    if (this.starting) {
      this.closing = true
      const startPromise = this.startPromise
      if (startPromise) {
        await startPromise
      }
    }

    if (!this.started) {
      this.closed = true
      this.closing = false
      const cleanupErrors = this.startupCleanupErrors
      this.startupCleanupErrors = []
      if (cleanupErrors.length > 0) {
        this.closeDurable = false
        this.reportError({
          message: "Journal startup cancellation left cleanup errors",
          errors: cleanupErrors,
          filePath: this.filePath,
        })
        return toResult({ errors: cleanupErrors, closed: true, durable: false })
      }
      this.closeDurable = true
      return toResult({ closed: true, durable: true })
    }

    if (this.flushPromises.size > 0) {
      await Promise.all([...this.flushPromises])
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
