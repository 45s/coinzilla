import { mkdir, open } from "node:fs/promises"
import path from "node:path"

import { defaultLogger, toResult } from "@coinzilla/utils"

export class Journal {
  constructor({ eventBus, directory, logger = defaultLogger } = {}) {
    this.eventBus = eventBus
    this.directory = directory
    this.logger = logger

    this.fileHandle = null
    this.filePath = null
    this.subscription = null
    this.writeQueue = Promise.resolve()

    this.started = false
    this.starting = false
    this.closing = false
    this.closed = false
    this.writeErrors = []
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

      const { fileHandle, filePath } = await this.createSessionFile()

      this.fileHandle = fileHandle
      this.filePath = filePath

      if (this.closing || this.closed) {
        await this.fileHandle.close()
        this.fileHandle = null

        return toResult({
          error: new Error("Journal was closed during startup"),
        })
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
        await this.fileHandle.close()
        this.fileHandle = null

        return toResult({
          errors: result.errors,
        })
      }

      this.subscription = result.subscription
      this.started = true

      try {
        this.logger.info?.("Journal started", {
          filePath: this.filePath,
        })
      } catch {
        // Logging must not turn a successful startup into a failure.
      }

      return toResult({
        filePath: this.filePath,
      })
    } catch (error) {
      if (this.fileHandle) {
        await this.fileHandle.close().catch(() => {})
        this.fileHandle = null
      }

      this.reportError({
        message: "Failed to start journal",
        errors: [error],
      })

      return toResult({ error })
    } finally {
      this.starting = false
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

    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return toResult({
        error: new TypeError("A valid event object is required"),
      })
    }

    let line

    try {
      line = `${JSON.stringify(event)}\n`
    } catch (error) {
      return toResult({ error })
    }

    if (line === "undefined\n") {
      return toResult({
        error: new TypeError("Event cannot be serialized to JSON"),
      })
    }

    const task = this.writeQueue.then(async () => {
      try {
        await this.fileHandle.writeFile(line, "utf8")

        return toResult({ written: true })
      } catch (error) {
        this.writeErrors.push(error)

        return toResult({ error })
      }
    })

    this.writeQueue = task.then(() => undefined)

    return task
  }

  async flush({} = {}) {
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
        // Wait for queued writes, then ask the OS to sync file data to storage.
        await this.fileHandle.sync()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      return toResult({ errors })
    }

    return toResult({ flushed: true, filePath: this.filePath })
  }

  async close({} = {}) {
    if (this.closed) {
      return toResult({ closed: true })
    }

    if (this.closing) {
      return toResult({
        error: new Error("Journal is already closing"),
      })
    }

    if (!this.started) {
      this.closed = true

      return toResult({ closed: true })
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

    this.closed = true
    this.started = false
    this.closing = false

    if (errors.length > 0) {
      this.reportError({
        message: "Journal closed with errors",
        errors,
        filePath: this.filePath,
      })

      return toResult({ errors })
    }

    try {
      this.logger.info?.("Journal closed", {
        filePath: this.filePath,
      })
    } catch {
      // Logging must not turn a completed shutdown into a failure.
    }

    return toResult({
      closed: true,
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
