import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { defaultLogger } from "@coinzilla/utils"

const CONSOLE_TRANSPORT_NAME = "console"
const DEBUG_TRANSPORT_NAME = "harvester-debug-file"
const TRACE_TRANSPORT_NAME = "harvester-trace-file"
const CONSOLE_DETAIL_KEYS = Object.freeze([
  "errorName",
  "errorMessage",
  "orderCount",
  "readiness",
  "symbol",
  "symbols",
  "enabledSymbols",
  "action",
  "side",
  "price",
  "quantity",
  "phase",
  "auditStatus",
  "balanceCount",
  "assetCount",
  "strategyMode",
  "broker",
  "reason",
])
const MAX_CONSOLE_LINE_LENGTH = 200

function summarizeConsoleData({ data } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { message: String(data ?? "") }
  }

  const message = String(data.message ?? "Harvester event")
    .replace(/[\r\n]+/g, " ")
  const details = Object.fromEntries(
    CONSOLE_DETAIL_KEYS
      .filter((key) => data[key] !== undefined && data[key] !== null)
      .map((key) => {
        const value = data[key]
        if (typeof value === "string") {
          const maxLength = key === "errorMessage" ? 72 : 100
          if (value.length > maxLength) {
            return [key, value.slice(0, maxLength - 3) + "..."]
          }
        }
        if (Array.isArray(value)) {
          return [key, value.slice(0, 3)]
        }
        return [key, value]
      }),
  )
  return { message, details }
}

/**
 * Attach independent DEBUG and TRACE JSONL destinations to the shared logger.
 * The compact console destination remains independently configurable.
 *
 * @param {{ logger?: object, directory?: string, output?: NodeJS.WritableStream }} input
 * @returns {Promise<{ directory: string, close: () => Promise<void> }>}
 */
export async function configureHarvesterLogging({
  logger = defaultLogger,
  directory = path.resolve(process.cwd(), "logs"),
  output = process.stdout,
} = {}) {
  if (
    typeof logger?.addTransport !== "function"
    || typeof logger?.removeTransport !== "function"
    || typeof logger?.setLevel !== "function"
  ) {
    throw new TypeError(
      "Harvester logging requires @coinzilla/utils Logger transport support; update the shared utils dependency first",
    )
  }

  await mkdir(directory, { recursive: true })

  const createFileTransport = ({ name, level, filename }) => {
    const stream = createWriteStream(path.join(directory, filename), {
      flags: "a",
      encoding: "utf8",
    })
    let streamError

    // Keep the stream's error event handled even when no write is in flight.
    stream.on("error", (error) => {
      streamError = error
    })

    return {
      name,
      level,
      write(entry) {
        if (streamError) return Promise.reject(streamError)
        let serialized
        try {
          serialized = JSON.stringify(entry)
        } catch (error) {
          return Promise.reject(error)
        }
        return new Promise((resolve, reject) => {
          stream.write(serialized + "\n", (error) => {
            if (error) {
              reject(error)
              return
            }
            if (streamError) {
              reject(streamError)
              return
            }
            resolve()
          })
        })
      },
      close() {
        return new Promise((resolve, reject) => {
          stream.end((error) => {
            if (error || streamError) {
              reject(error ?? streamError)
              return
            }
            resolve()
          })
        })
      },
    }
  }

  const consoleTransport = createHarvesterConsoleTransport({ output })
  const debugTransport = createFileTransport({
    name: DEBUG_TRANSPORT_NAME,
    level: "debug",
    filename: "harvester.log",
  })
  const traceTransport = createFileTransport({
    name: TRACE_TRANSPORT_NAME,
    level: "trace",
    filename: "harvester-trace.log",
  })

  try {
    await logger.removeTransport(CONSOLE_TRANSPORT_NAME)
    await logger.removeTransport(DEBUG_TRANSPORT_NAME)
    await logger.removeTransport(TRACE_TRANSPORT_NAME)
    logger.addTransport(consoleTransport)
    logger.addTransport(debugTransport)
    logger.addTransport(traceTransport)
    logger.setLevel({ transport: CONSOLE_TRANSPORT_NAME, level: "info" })
  } catch (error) {
    const debugRemoved = await logger.removeTransport(DEBUG_TRANSPORT_NAME).catch(() => false)
    const traceRemoved = await logger.removeTransport(TRACE_TRANSPORT_NAME).catch(() => false)
    await Promise.allSettled([
      ...(debugRemoved ? [] : [debugTransport.close()]),
      ...(traceRemoved ? [] : [traceTransport.close()]),
    ])
    throw error
  }

  let closed = false
  return Object.freeze({
    directory,
    async close() {
      if (closed) return
      closed = true
      const results = await Promise.allSettled([
        logger.removeTransport(DEBUG_TRANSPORT_NAME),
        logger.removeTransport(TRACE_TRANSPORT_NAME),
      ])
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to close Harvester log transports")
      }
    },
  })
}export function createHarvesterConsoleTransport({ output = process.stdout } = {}) {
  let previousFingerprint
  let previousTimestamp
  let suppressedCount = 0

  const flushSuppressed = () => {
    if (suppressedCount === 0) return
    const time = new Date(previousTimestamp).toLocaleTimeString()
    output.write(time + " INFO Previous identical log entry repeated " + suppressedCount + " additional time(s)\n")
    suppressedCount = 0
  }

  return {
    name: CONSOLE_TRANSPORT_NAME,
    level: "info",
    write({ timestamp, level, data }) {
      const summary = summarizeConsoleData({ data })
      const fingerprint = JSON.stringify({ level, summary })
      if (fingerprint === previousFingerprint) {
        suppressedCount += 1
        return
      }

      flushSuppressed()
      previousFingerprint = fingerprint
      previousTimestamp = timestamp

      const time = new Date(timestamp).toLocaleTimeString()
      const prefix = time + " " + level.toUpperCase() + " " + summary.message
      const serializedDetails = Object.keys(summary.details ?? {}).length > 0
        ? " " + JSON.stringify(summary.details)
        : ""
      const availableDetailsLength = Math.max(0, MAX_CONSOLE_LINE_LENGTH - prefix.length - 1)
      const suffix = serializedDetails.length > availableDetailsLength
        ? (availableDetailsLength > 3
          ? serializedDetails.slice(0, availableDetailsLength - 3) + "..."
          : "")
        : serializedDetails
      const line = prefix + suffix
      output.write((line.length > MAX_CONSOLE_LINE_LENGTH
        ? line.slice(0, MAX_CONSOLE_LINE_LENGTH - 3) + "..."
        : line) + "\n")
    },
    close: flushSuppressed,
  }
}

/**
 * Attach independent DEBUG and TRACE JSONL destinations to the shared logger.
 * The compact console destination remains independently configurable.
 *
 * @param {{ logger?: object, directory?: string, output?: NodeJS.WritableStream }} input
 * @returns {Promise<{ directory: string, close: () => Promise<void> }>}
 */
export async function configureHarvesterLogging({
  logger = defaultLogger,
  directory = path.resolve(process.cwd(), "logs"),
  output = process.stdout,
} = {}) {
  if (
    typeof logger?.addTransport !== "function"
    || typeof logger?.removeTransport !== "function"
    || typeof logger?.setLevel !== "function"
  ) {
    throw new TypeError(
      "Harvester logging requires @coinzilla/utils Logger transport support; update the shared utils dependency first",
    )
  }

  await mkdir(directory, { recursive: true })

  const createFileTransport = ({ name, level, filename }) => {
    const stream = createWriteStream(path.join(directory, filename), {
      flags: "a",
      encoding: "utf8",
    })
    let streamError

    // Keep the stream's error event handled even when no write is in flight.
    stream.on("error", (error) => {
      streamError = error
    })

    return {
      name,
      level,
      write(entry) {
        if (streamError) return Promise.reject(streamError)
        let serialized
        try {
          serialized = JSON.stringify(entry)
        } catch (error) {
          return Promise.reject(error)
        }
        return new Promise((resolve, reject) => {
          stream.write(serialized + "\n", (error) => {
            if (error) {
              reject(error)
              return
            }
            if (streamError) {
              reject(streamError)
              return
            }
            resolve()
          })
        })
      },
      close() {
        return new Promise((resolve, reject) => {
          stream.end((error) => {
            if (error || streamError) {
              reject(error ?? streamError)
              return
            }
            resolve()
          })
        })
      },
    }
  }

  const consoleTransport = createHarvesterConsoleTransport({ output })
  const debugTransport = createFileTransport({
    name: DEBUG_TRANSPORT_NAME,
    level: "debug",
    filename: "harvester.log",
  })
  const traceTransport = createFileTransport({
    name: TRACE_TRANSPORT_NAME,
    level: "trace",
    filename: "harvester-trace.log",
  })

  try {
    await logger.removeTransport(CONSOLE_TRANSPORT_NAME)
    await logger.removeTransport(DEBUG_TRANSPORT_NAME)
    await logger.removeTransport(TRACE_TRANSPORT_NAME)
    logger.addTransport(consoleTransport)
    logger.addTransport(debugTransport)
    logger.addTransport(traceTransport)
    logger.setLevel({ transport: CONSOLE_TRANSPORT_NAME, level: "info" })
  } catch (error) {
    const debugRemoved = await logger.removeTransport(DEBUG_TRANSPORT_NAME).catch(() => false)
    const traceRemoved = await logger.removeTransport(TRACE_TRANSPORT_NAME).catch(() => false)
    await Promise.allSettled([
      ...(debugRemoved ? [] : [debugTransport.close()]),
      ...(traceRemoved ? [] : [traceTransport.close()]),
    ])
    throw error
  }

  let closed = false
  return Object.freeze({
    directory,
    async close() {
      if (closed) return
      closed = true
      const results = await Promise.allSettled([
        logger.removeTransport(DEBUG_TRANSPORT_NAME),
        logger.removeTransport(TRACE_TRANSPORT_NAME),
      ])
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to close Harvester log transports")
      }
    },
  })
}
