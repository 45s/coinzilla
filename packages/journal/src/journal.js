import { mkdir, open, unlink } from "node:fs/promises"
import path from "node:path"

import { defaultLogger, toResult } from "@coinzilla/utils"
import { serializeJournalRecord } from "./helpers/journal-record.js"
import { readJournalRecords } from "./read-journal-records.js"
import { replayJournalRecords } from "./replay-journal-records.js"

const JOURNAL_DIRECTORY_LOCK_FILE = ".coinzilla-journal.lock"

export class Journal {
  constructor({ eventBus, directory, logger = defaultLogger } = {}) {
    this.eventBus = eventBus
    this.directory = directory
    this.logger = logger

    this.fileHandle = null
    this.filePath = null
    this.lockFileHandle = null
    this.lockFilePath = null
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

  async start({} = {}) {
    if (this.started || this.starting || this.closing || this.closed) {
      return toResult({
        error: new Error("Journal has already started or closed"),
      })
    }

    if (!this.eventBus || typeof this.eventBus.subscribeAll !== "function") {
      return toResult({
        error: new TypeError("A valid eventBus is required"),
      })
    }

    if (typeof this.directory !== "string" || this.directory.trim() === "") {
      return toResult({
        error: new TypeError("A journal directory is required"),
      })
    }

    this.starting = true

    try {
      await mkdir(this.directory, { recursive: true })

      if (this.closing || this.closed) {
        return toResult({
          error: new Error("Journal was closed during startup"),
        })
      }

      await this.acquireDirectoryLock()

      const { fileHandle, filePath } = await this.createSessionFile()

      this.fileHandle = fileHandle
      this.filePath = filePath

      if (this.closing || this.closed) {
        const errors = [new Error("Journal was closed during startup")]

        try {
          await this.fileHandle.close()
        } catch (error) {
          errors.push(error)
        }
        this.fileHandle = null

        try {
          await this.releaseDirectoryLock()
        } catch (error) {
          errors.push(error)
        }

        return toResult({ errors })
      }

      const result = this.eventBus.subscribeAll({
        handler: async (event) => {
          const writeResult = await this.record({ event })

          if (!writeResult.ok) {
            this.reportError({
              message: "Failed to write journal event",
              errors: writeResult.errors,
              eventId: event.id,
              eventName: event.name,
            })
          }
        },
      })

      if (!result.ok) {
        const errors = [...result.errors]

        try {
          await this.fileHandle.close()
        } catch (error) {
          errors.push(error)
        }
        this.fileHandle = null

        try {
          await this.releaseDirectoryLock()
        } catch (error) {
          errors.push(error)
        }

        return toResult({ errors })
      }

      this.subscription = result.subscription
      this.started = true

      try {
        this.logger.system?.("Journal started", {
          filePath: this.filePath,
        })
      } catch {
        // Logging must not turn a successful startup into a failure.
      }

      return toResult({
        filePath: this.filePath,
      })
    } catch (error) {
      const errors = [error]

      if (this.fileHandle) {
        try {
          await this.fileHandle.close()
        } catch (cleanupError) {
          errors.push(cleanupError)
        }
        this.fileHandle = null
      }

      try {
        await this.releaseDirectoryLock()
      } catch (cleanupError) {
        errors.push(cleanupError)
      }

      this.reportError({
        message: "Failed to start journal",
        errors,
      })

      return toResult({ errors })
    } finally {
      this.starting = false
    }
  }

  /**
   * Acquire exclusive ownership before creating a session file.
   * An existing lock is never removed automatically; it may belong to a live
   * process or be a stale lock left by a process that did not close cleanly.
   */
  async acquireDirectoryLock() {
    const lockFilePath = path.join(this.directory, JOURNAL_DIRECTORY_LOCK_FILE)
    let lockFileHandle

    try {
      lockFileHandle = await open(lockFilePath, "wx", 0o600)
    } catch (cause) {
      if (cause.code !== "EEXIST") {
        throw cause
      }

      const error = new Error(
        `Journal directory is already locked: ${this.directory}. Verify that no writer is active before removing ${lockFilePath}.`,
      )
      error.code = "JOURNAL_DIRECTORY_LOCKED"
      error.details = { directory: this.directory, lockFilePath }
      error.cause = cause
      throw error
    }

    this.lockFileHandle = lockFileHandle
    this.lockFilePath = lockFilePath

    const metadata = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }
    await lockFileHandle.writeFile(`${JSON.stringify(metadata)}\\n`, "utf8")
  }

  /**
   * Release this instance's directory lock after its session file is closed.
   */
  async releaseDirectoryLock() {
    if (this.lockFileHandle) {
      await this.lockFileHandle.close()
      this.lockFileHandle = null
    }

    if (this.lockFilePath) {
      await unlink(this.lockFilePath)
      this.lockFilePath = null
    }
  }

  async createSessionFile({} = {}) {
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replaceAll(":", "-")

    for (let index = 0; ; index += 1) {
      const suffix = index === 0 ? "" : `-${String(index).padStart(3, "0")}`

      const filePath = path.join(this.directory, `${timestamp}${suffix}.jsonl`)

      try {
        const fileHandle = await open(filePath, "wx")

        return { fileHandle, filePath }
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error
        }
      }
    }
  }

  async record({ event } = {}) {
    if (!this.started || this.closing || this.closed || !this.fileHandle) {
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
        await this.fileHandle.writeFile(line, "utf8")
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
      directory: this.directory,
      handler,
      maxRecords,
      maxSessions,
      maxBytes,
      maxRecordBytes,
    })
  }

  async flush({} = {}) {
    if (!this.started || !this.fileHandle || this.closing || this.closed) {
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

    if (errors.length === 0 && this.fileHandle && !this.closed) {
      try {
        // record() acknowledges a completed write; flush() acknowledges an fsync.
        await this.fileHandle.sync()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      return toResult({ errors })
    }

    return toResult({ flushed: true, durable: true, filePath: this.filePath })
  }

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

    if (this.fileHandle) {
      try {
        // Sync the final queued writes before closing the session file.
        await this.fileHandle.sync()
      } catch (error) {
        errors.push(error)
      }

      try {
        await this.fileHandle.close()
      } catch (error) {
        errors.push(error)
      }

      this.fileHandle = null
    }

    try {
      await this.releaseDirectoryLock()
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
