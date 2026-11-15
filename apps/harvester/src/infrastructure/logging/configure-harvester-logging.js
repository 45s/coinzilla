import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { once } from "node:events"
import { finished } from "node:stream/promises"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { defaultLogger } from "@coinzilla/utils"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"
import { createConsoleRecordPresentation } from "./create-console-record-presentation.js"

const CONSOLE_TRANSPORT_NAME = "console"
const DEBUG_TRANSPORT_NAME = "harvester-debug-file"
const TRACE_TRANSPORT_NAME = "harvester-trace-file"
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
      const {
        isOrderLifecycle,
        shutdownPresentation,
        fingerprint,
      } = createConsoleRecordPresentation({
        timestamp,
        level,
        method,
        data,
      })
      if (fingerprint === previousFingerprint) {
        suppressedCount += 1
        return
      }

      flushSuppressed()
      previousFingerprint = fingerprint
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
        data,
      })
    },
    close: flushSuppressed,
  }
}
