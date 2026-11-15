import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { once } from "node:events"
import { finished } from "node:stream/promises"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { defaultLogger } from "@coinzilla/utils"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"

const CONSOLE_TRANSPORT_NAME = "console"
const DEBUG_TRANSPORT_NAME = "harvester-debug-file"
const TRACE_TRANSPORT_NAME = "harvester-trace-file"
const CONSOLE_DETAIL_KEYS = Object.freeze([
  "errorCode",
  "symbol",
  "inventory",
  "accounting",
  "sourceFilterTypes",
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
const MAX_PORTFOLIO_STATS_LINE_LENGTH = 360
const LEVEL_COLORS = Object.freeze({
  trace: "\u001b[95m",
  debug: "\u001b[35m",
  info: "\u001b[34m",
  success: "\u001b[32m",
  system: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
})
const ANSI_RESET = "\u001b[0m"

function formatConsoleLine({ line, level, method = level, color }) {
  const code = LEVEL_COLORS[method] ?? LEVEL_COLORS[level]
  return color && code ? code + line + ANSI_RESET : line
}

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


const STRATEGY_COLUMN_WIDTH = 5
const STATUS_COLUMN_WIDTH = 23
const ORDER_ID_COLUMN_WIDTH = 22
const SYMBOL_COLUMN_WIDTH = 20
const SIDE_COLUMN_WIDTH = 5
const QUANTITY_COLUMN_WIDTH = 18
const PRICE_COLUMN_WIDTH = 18
const ORDER_DETAIL_INDENT = 15

const STRATEGY_LABELS = Object.freeze({
  [StrategyId.COIN_GRABBER]: "🟡GC",
  [StrategyId.RECOVERY_SELLER]: "🔴RS",
})

const ORDER_STATUS_PRESENTATION = Object.freeze({
  SUBMITTED: {
    indicator: "🔵",
    label: "SUBMITTED",
  },
  ACCEPTED: {
    indicator: "🔵",
    label: "ACCEPTED",
  },
  PARTIAL_FILL: {
    indicator: "🟠",
    label: "PARTIAL FILL",
  },
  FILLED: {
    indicator: "🟢",
    label: "FILLED",
  },
  CANCEL_REQUESTED: {
    indicator: "🔵",
    label: "CANCEL REQUESTED",
  },
  CANCELLED: {
    indicator: "🔴",
    label: "CANCELLED",
  },
  REJECTED: {
    indicator: "🔴",
    label: "REJECTED",
  },
  EXPIRED: {
    indicator: "🔴",
    label: "EXPIRED",
  },
  FAILED: {
    indicator: "🔴",
    label: "FAILED",
  },
  UNKNOWN: {
    indicator: "🟠",
    label: "UNKNOWN",
  },
  CANCEL_UNKNOWN: {
    indicator: "🟠",
    label: "CANCEL UNKNOWN",
  },
  CANCEL_NOT_CONFIRMED: {
    indicator: "🟠",
    label: "CANCEL UNCONFIRMED",
  },
  CANCEL_NOT_SENT: {
    indicator: "🔴",
    label: "CANCEL NOT SENT",
  },
  CANCEL_FAILED: {
    indicator: "🔴",
    label: "CANCEL FAILED",
  },
  STALE_CANCEL_IGNORED: {
    indicator: "⚪",
    label: "STALE CANCEL IGNORED",
  },
})

function formatOrderLifecycleConsoleLine({ timestamp, data } = {}) {
  const time = new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const strategy = (STRATEGY_LABELS[data.strategyId] ?? "⚪SYS").padEnd(STRATEGY_COLUMN_WIDTH)
  const statusPresentation = ORDER_STATUS_PRESENTATION[data.lifecycleStatus] ?? {
    indicator: "⚪",
    label: String(data.lifecycleStatus ?? "INFO"),
  }
  const status = (statusPresentation.indicator + " " + statusPresentation.label)
    .padEnd(STATUS_COLUMN_WIDTH)
  const orderId = (data.brokerOrderId ? "#" + data.brokerOrderId : "#pending")
    .padEnd(ORDER_ID_COLUMN_WIDTH)
  const symbol = String(data.symbol ?? "-").padEnd(SYMBOL_COLUMN_WIDTH)
  const side = String(data.side ?? "-").padEnd(SIDE_COLUMN_WIDTH)
  const quantity = String(data.quantity ?? "-").padStart(QUANTITY_COLUMN_WIDTH)
  const price = String(data.price ?? "-").padStart(PRICE_COLUMN_WIDTH)

  return [
    time,
    strategy,
    status,
    orderId,
    symbol,
    side,
    quantity,
    "@",
    price,
  ].join(" ")
}

function formatOrderLifecycleDetailLine({ detail } = {}) {
  return " ".repeat(ORDER_DETAIL_INDENT) + String(detail).replace(/[\r\n]+/g, " ")
}

/**
 * Attach independent DEBUG and TRACE JSONL destinations to the shared logger.
 * The compact console destination remains independently configurable.
 *
 * @param {{ logger?: object, directory?: string, output?: NodeJS.WritableStream, processIdentity?: { startedAt: string, runtimeSessionId: string } }} input
 * @returns {Promise<{ directory: string, cumulativeDirectory: string, sessionPaths: object, close: () => Promise<void> }>}
 */
export async function configureHarvesterLogging({
  logger = defaultLogger,
  directory = path.resolve(process.cwd(), "logs"),
  output = process.stdout,
  processIdentity = {
    startedAt: new Date().toISOString(),
    runtimeSessionId: randomUUID(),
  },
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

  const sessionPaths = createHarvesterLogSessionPaths({
    directory,
    startedAt: processIdentity.startedAt,
    runtimeSessionId: processIdentity.runtimeSessionId,
  })
  const cumulativeDirectory = path.join(directory, "cumulative")
  await Promise.all([
    mkdir(cumulativeDirectory, { recursive: true }),
    mkdir(sessionPaths.sessionDirectory, { recursive: true }),
  ])

  const createFileTransport = async ({ name, level, filename, sessionFilename }) => {
    const streams = [
      createWriteStream(path.join(cumulativeDirectory, filename), {
        flags: "a",
        encoding: "utf8",
      }),
      createWriteStream(sessionFilename, {
        flags: "wx",
        encoding: "utf8",
      }),
    ]
    const streamErrors = new Map()
    streams.forEach((stream, index) => stream.on("error", (error) => streamErrors.set(index, error)))

    const openResults = await Promise.allSettled(streams.map((stream) => new Promise((resolve, reject) => {
      stream.once("open", resolve)
      stream.once("error", reject)
    })))
    const openErrors = openResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)
    if (openErrors.length > 0) {
      await Promise.allSettled(streams.map(async (stream) => {
        if (!stream.destroyed) stream.destroy()
        if (!stream.closed) await once(stream, "close")
      }))
      throw openErrors[0]
    }

    return {
      name,
      level,
      write(entry) {
        const streamError = [...streamErrors.values()][0]
        if (streamError) {
          return Promise.reject(streamError)
        }
        let serialized
        try {
          serialized = JSON.stringify(entry)
        } catch (error) {
          return Promise.reject(error)
        }
        return Promise.all(streams.map((stream, index) => new Promise((resolve, reject) => {
          stream.write(serialized + "\n", (error) => {
            const currentError = error ?? streamErrors.get(index)
            if (currentError) { reject(currentError); return }
            resolve()
          })
        })))
      },
      async close() {
        const results = await Promise.allSettled(streams.map(async (stream) => {
          if (stream.closed) return
          if (stream.destroyed) {
            await once(stream, "close")
            return
          }
          const completion = finished(stream)
          stream.end()
          await completion
        }))
        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason)
        if (errors.length > 0) {
          throw new AggregateError(errors, "Failed to flush and close Harvester log streams")
        }
      },
    }
  }

  const consoleTransport = createHarvesterConsoleTransport({ output })
  let debugTransport
  let traceTransport
  let debugTransportRegistered = false
  let traceTransportRegistered = false

  try {
    debugTransport = await createFileTransport({
      name: DEBUG_TRANSPORT_NAME,
      level: "debug",
      filename: "harvester.log",
      sessionFilename: sessionPaths.debug,
    })
    traceTransport = await createFileTransport({
      name: TRACE_TRANSPORT_NAME,
      level: "trace",
      filename: "trace.log",
      sessionFilename: sessionPaths.trace,
    })

    await logger.removeTransport(CONSOLE_TRANSPORT_NAME)
    await logger.removeTransport(DEBUG_TRANSPORT_NAME)
    await logger.removeTransport(TRACE_TRANSPORT_NAME)
    logger.addTransport(consoleTransport)
    logger.addTransport(debugTransport)
    debugTransportRegistered = true
    logger.addTransport(traceTransport)
    traceTransportRegistered = true
    logger.setLevel({
      transport: CONSOLE_TRANSPORT_NAME,
      level: "info",
    })
  } catch (error) {
    const cleanup = []
    if (debugTransportRegistered) {
      cleanup.push(logger.removeTransport(DEBUG_TRANSPORT_NAME))
    } else if (debugTransport) {
      cleanup.push(debugTransport.close())
    }
    if (traceTransportRegistered) {
      cleanup.push(logger.removeTransport(TRACE_TRANSPORT_NAME))
    } else if (traceTransport) {
      cleanup.push(traceTransport.close())
    }
    await Promise.allSettled(cleanup)
    throw error
  }

  let closed = false
  return Object.freeze({
    directory,
    cumulativeDirectory,
    sessionPaths,
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

function writeOrderLifecycleRecord({ output, color, timestamp, level, method, data } = {}) {
  const lines = [formatOrderLifecycleConsoleLine({
    timestamp,
    data,
  })]
  if (typeof data.detail === "string" && data.detail.length > 0) {
    lines.push(formatOrderLifecycleDetailLine({ detail: data.detail }))
  }
  for (const line of lines) {
    output.write(formatConsoleLine({
      line,
      level,
      method,
      color,
    }) + "\n")
  }
}

function writeStandardConsoleRecord({ output, color, timestamp, level, method, data } = {}) {
  const summary = summarizeConsoleData({ data })
  const time = new Date(timestamp).toLocaleTimeString()
  const normalizedMethod = String(method ?? level).toLowerCase()
  const levelLabel = normalizedMethod === "info" || normalizedMethod === "system"
    ? ""
    : normalizedMethod.toUpperCase() + " "
  const plainPrefix = `${time} ${levelLabel}${summary.message}`
  const serializedDetails = Object.keys(summary.details ?? {}).length > 0
    ? ` ${JSON.stringify(summary.details)}`
    : ""
  const maxLineLength = summary.message === "Portfolio Stats"
    ? MAX_PORTFOLIO_STATS_LINE_LENGTH
    : MAX_CONSOLE_LINE_LENGTH
  const availableDetailsLength = Math.max(0, maxLineLength - plainPrefix.length - 1)
  let suffix = serializedDetails
  if (serializedDetails.length > availableDetailsLength) {
    suffix = availableDetailsLength > 3
      ? `${serializedDetails.slice(0, availableDetailsLength - 3)}...`
      : ""
  }
  const plainLine = plainPrefix + suffix
  const boundedLine = plainLine.length > maxLineLength
    ? `${plainLine.slice(0, maxLineLength - 3)}...`
    : plainLine
  output.write(formatConsoleLine({
    line: boundedLine,
    level,
    method,
    color,
  }) + "\n")
}

export function createHarvesterConsoleTransport({
  output = process.stdout,
  color = process.env.NO_COLOR === undefined && (
    process.env.COINZILLA_LOG_COLOR === "1" || Boolean(output.isTTY)
  ),
} = {}) {
  let previousFingerprint
  let previousTimestamp
  let suppressedCount = 0

  const flushSuppressed = () => {
    if (suppressedCount === 0) return
    const time = new Date(previousTimestamp).toLocaleTimeString()
    const line = `${time} Previous identical log entry repeated ${suppressedCount} additional time(s)`
    output.write(formatConsoleLine({
      line,
      level: "info",
      color,
    }) + "\n")
    suppressedCount = 0
  }

  return {
    name: CONSOLE_TRANSPORT_NAME,
    level: "info",
    write({ timestamp, level, method = level, data }) {
      const isOrderLifecycle = data?.orderLifecycle === true
      const summary = isOrderLifecycle
        ? {
          message: "Order lifecycle",
          details: data,
        }
        : summarizeConsoleData({ data })
      const fingerprint = JSON.stringify({
        level,
        method,
        summary,
      })
      if (fingerprint === previousFingerprint) {
        suppressedCount += 1
        return
      }

      flushSuppressed()
      previousFingerprint = fingerprint
      previousTimestamp = timestamp

      if (isOrderLifecycle) {
        writeOrderLifecycleRecord({
          output,
          color,
          timestamp,
          level,
          method,
          data,
        })
        return
      }
      writeStandardConsoleRecord({
        output,
        color,
        timestamp,
        level,
        method,
        data,
      })
    },
    close: flushSuppressed,
  }
}
