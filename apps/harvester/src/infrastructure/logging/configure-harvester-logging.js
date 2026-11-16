import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { once } from "node:events"
import { finished } from "node:stream/promises"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { defaultLogger } from "@coinzilla/utils"
import { strategyLogMarkers } from "../../application/logging/strategy-log-markers.js"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"
import { createConsoleRecordPresentation } from "./create-console-record-presentation.js"

const CONSOLE_TRANSPORT_NAME = "console"
const DEBUG_TRANSPORT_NAME = "harvester-debug-file"
const TRACE_TRANSPORT_NAME = "harvester-trace-file"

const MAX_CONSOLE_LINE_LENGTH = 200
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



const ORDER_STATUS_PRESENTATION = Object.freeze({
  SUBMITTED: "SUBMITTED",
  ACCEPTED: "ACCEPTED",
  PARTIAL_FILL: "PARTIAL FILL",
  FILLED: "FILLED",
  CANCEL_REQUESTED: "CANCEL REQUESTED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  CANCEL_UNKNOWN: "CANCEL UNKNOWN",
  CANCEL_NOT_CONFIRMED: "CANCEL UNCONFIRMED",
  CANCEL_NOT_SENT: "CANCEL NOT SENT",
  CANCEL_FAILED: "CANCEL FAILED",
  STALE_CANCEL_IGNORED: "STALE CANCEL IGNORED",
})

function formatOrderLifecycleConsoleLine({ timestamp, data } = {}) {
  const time = new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const strategy = strategyLogMarkers[data.strategyId]
  const status = String(
    ORDER_STATUS_PRESENTATION[data.lifecycleStatus] ?? data.lifecycleStatus ?? "INFO",
  )
  const orderId = data.brokerOrderId ? `#${data.brokerOrderId}` : "#pending"
  const symbol = String(data.symbol ?? "-")
  const side = String(data.side ?? "-")
  const quantity = String(data.quantity ?? "-")
  const price = String(data.price ?? "-")
  const clientOrderId = !data.brokerOrderId && typeof data.clientOrderId === "string"
    ? data.clientOrderId
    : ""
  const rawDetail = typeof data.detail === "string" && data.detail.length > 0
    ? data.detail.replace(/[\r\n]+/g, " ")
    : ""
  const detail = rawDetail
    .split(/\s*\|\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== `Client order ID: ${clientOrderId}`)
    .join(" | ")

  return [
    time,
    ...(strategy ? [strategy] : []),
    status,
    orderId,
    symbol,
    side,
    quantity,
    "@",
    price,
    clientOrderId,
    detail ? "|" : "",
    detail,
  ].filter(Boolean).join(" ")
}

/**
 * Attach independent DEBUG and TRACE JSONL destinations to the shared logger.
 * The compact console destination remains independently configurable.
 *
 * @param {{ logger?: object, directory?: string, output?: NodeJS.WritableStream, processIdentity?: { startedAt: string, runtimeSessionId: string } }} input
 * @returns {Promise<{ directory: string, cumulativeDirectory: string, sessionPaths: object, close: () => Promise<void> }>}
 */
async function closeHarvesterLogStreams({ streams } = {}) {
  const results = await Promise.allSettled(streams.map(async (stream) => {
    if (stream.closed) {
      return
    }
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
}

async function createHarvesterFileTransport({
  cumulativeDirectory,
  name,
  level,
  filename,
  sessionFilename,
} = {}) {
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
      if (!stream.destroyed) {
        stream.destroy()
      }
      if (!stream.closed) {
        await once(stream, "close")
      }
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
        stream.write(`${serialized}\n`, (error) => {
          const currentError = error ?? streamErrors.get(index)
          if (currentError) {
            reject(currentError)
            return
          }
          resolve()
        })
      })))
    },
    close: () => closeHarvesterLogStreams({ streams }),
  }
}

async function registerHarvesterLogTransports({
  logger,
  consoleTransport,
  cumulativeDirectory,
  sessionPaths,
} = {}) {
  let debugTransport
  let traceTransport
  let debugTransportRegistered = false
  let traceTransportRegistered = false
  try {
    debugTransport = await createHarvesterFileTransport({
      cumulativeDirectory,
      name: DEBUG_TRANSPORT_NAME,
      level: "debug",
      filename: "harvester.log",
      sessionFilename: sessionPaths.debug,
    })
    traceTransport = await createHarvesterFileTransport({
      cumulativeDirectory,
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
}

function createHarvesterLogCloseHandler({ logger } = {}) {
  let closed = false
  return async () => {
    if (closed) {
      return
    }
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
  }
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
  await registerHarvesterLogTransports({
    logger,
    consoleTransport: createHarvesterConsoleTransport({ output }),
    cumulativeDirectory,
    sessionPaths,
  })

  return Object.freeze({
    directory,
    cumulativeDirectory,
    sessionPaths,
    close: createHarvesterLogCloseHandler({ logger }),
  })
}

function writeOrderLifecycleRecord({ output, color, timestamp, level, method, data } = {}) {
  const line = formatOrderLifecycleConsoleLine({
    timestamp,
    data,
  })
  output.write(formatConsoleLine({
    line,
    level,
    method,
    color,
  }) + "\n")
}

function formatPortfolioBaseQuantity(value) {
  const text = String(value ?? "-")
  const match = /^(-?(?:\d+\.\d+|\d+|\.\d+))(?:\s+[A-Z0-9]+)?$/.exec(text)
  return match ? match[1] : text
}

function formatPortfolioNet(value) {
  const text = String(value ?? "-")
  const match = /^([+-]?(?:\d+\.\d*|\.\d+))(?:\s+[A-Z0-9]+)?$/.exec(text)
  if (!match) {
    return text
  }

  const amount = Number(match[1])
  return Number.isFinite(amount) ? amount.toFixed(3) : text
}

function createPortfolioStatsConsoleLine({ time, strategyPrefix, details } = {}) {
  const portfolioLine = [
    time,
    [strategyPrefix, "PORTFOLIO ", String(details.symbol ?? "-"), ":"].join(""),
    ["amount: ", formatPortfolioBaseQuantity(details.inventory?.totalBaseQuantity)].join(""),
    "|",
    ["earned: ", formatPortfolioBaseQuantity(details.inventory?.freeBaseQuantity)].join(""),
    "|",
    ["spent: ", formatPortfolioBaseQuantity(details.accounting?.spent)].join(""),
    "|",
    ["net: ", formatPortfolioNet(details.accounting?.quoteNetCashFlow)].join(""),
  ].join(" ")
  return portfolioLine.length > MAX_CONSOLE_LINE_LENGTH
    ? portfolioLine.slice(0, MAX_CONSOLE_LINE_LENGTH - 3).concat("...")
    : portfolioLine
}

function formatStartupConsoleMessage(message) {
  const subscriptionMatch = /^Connected; subscribed to (\d+) enabled market\(s\)\. (.+)$/.exec(message)
  if (subscriptionMatch) {
    return `Binance market-data stream connected; active market subscriptions: ${subscriptionMatch[1]}. ${subscriptionMatch[2]}`
  }

  const modeMatch = /^Connected; Binance trading mode is (.+)\.$/.exec(message)
  if (modeMatch) {
    return `Binance market-data stream connected; Binance trading mode is ${modeMatch[1]}.`
  }

  return message
}

function formatConsoleDetailValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (
      item && typeof item === "object"
        ? JSON.stringify(item)
        : String(item).replace(/[\\r\\n]+/g, " ")
    )).join(", ")
  }
  return String(value).replace(/[\\r\\n]+/g, " ")
}

function appendConsoleDetail({ parts, key, value } = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      appendConsoleDetail({
        parts,
        key: `${key}.${nestedKey}`,
        value: nestedValue,
      })
    }
    return
  }
  parts.push(`${key} ${formatConsoleDetailValue(value)}`)
}

function formatConsoleDetails(details = {}) {
  const parts = []
  if (details.symbol !== undefined && details.symbol !== null) {
    parts.push(formatConsoleDetailValue(details.symbol))
  }
  for (const [key, value] of Object.entries(details)) {
    if (key !== "symbol") {
      appendConsoleDetail({ parts, key, value })
    }
  }
  return parts.length > 0 ? `: ${parts.join(", ")}` : ""
}

function writeStandardConsoleRecord({ output, color, timestamp, level, method, summary, strategyId } = {}) {
  const time = new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const normalizedMethod = String(method ?? level).toLowerCase()
  const levelLabel = normalizedMethod === "info" || normalizedMethod === "system"
    ? ""
    : `${normalizedMethod.toUpperCase()} `
  const strategyMarker = strategyLogMarkers[strategyId]
  const strategyPrefix = strategyMarker ? `${strategyMarker} ` : ""
  const summaryMessage = formatStartupConsoleMessage(summary.message)

  if (summaryMessage === "Portfolio Stats") {
    const line = createPortfolioStatsConsoleLine({
      time,
      strategyPrefix,
      details: summary.details ?? {},
    })
    output.write(formatConsoleLine({
      line,
      level,
      method,
      color,
    }) + "\n")
    return
  }

  const plainPrefix = `${time} ${strategyPrefix}${levelLabel}${summaryMessage}`
  const formattedDetails = formatConsoleDetails(summary.details ?? {})
  const availableDetailsLength = Math.max(0, MAX_CONSOLE_LINE_LENGTH - plainPrefix.length)
  const suffix = formattedDetails.length > availableDetailsLength
    ? availableDetailsLength > 3
      ? `${formattedDetails.slice(0, availableDetailsLength - 3)}...`
      : ""
    : formattedDetails
  const plainLine = `${plainPrefix}${suffix}`
  const boundedLine = plainLine.length > MAX_CONSOLE_LINE_LENGTH
    ? `${plainLine.slice(0, MAX_CONSOLE_LINE_LENGTH - 3)}...`
    : plainLine
  output.write(formatConsoleLine({
    line: boundedLine,
    level,
    method,
    color,
  }) + "\n")
}

function writeSuppressedConsoleRecord({ output, color, timestamp, count } = {}) {
  const time = new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const line = `${time} Previous identical log entry repeated ${count} additional time(s)`
  output.write(formatConsoleLine({
    line,
    level: "info",
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
    writeSuppressedConsoleRecord({
      output,
      color,
      timestamp: previousTimestamp,
      count: suppressedCount,
    })
    suppressedCount = 0
  }

  return {
    name: CONSOLE_TRANSPORT_NAME,
    level: "info",
    write({ timestamp, level, method = level, data }) {
      const {
        isOrderLifecycle,
        shutdownPresentation,
        summary,
        fingerprint,
      } = createConsoleRecordPresentation({
        timestamp,
        level,
        method,
        data,
      })
      const strategyFingerprint = `${fingerprint}:${data?.strategyId ?? "SYSTEM"}`
      if (strategyFingerprint === previousFingerprint) {
        suppressedCount += 1
        return
      }

      flushSuppressed()
      previousFingerprint = strategyFingerprint
      previousTimestamp = timestamp
      if (shutdownPresentation) {
        output.write(`${formatConsoleLine({
          line: shutdownPresentation.line,
          level,
          method,
          color,
        })}\n`)
        return
      }
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
        summary,
        strategyId: data?.strategyId,
      })
    },
    close: flushSuppressed,
  }
}
