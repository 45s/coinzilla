import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import {
  areCandlesEqual,
  calculateVolatilityMetrics,
  validateCandle,
  validateCandleSeries,
} from "../src/domain/market/volatility-candle.js"
import {
  createVolatilityProtectionState,
  transitionVolatilityProtection,
  VOLATILITY_PROTECTION_MODES,
  VOLATILITY_PROTECTION_THRESHOLDS,
} from "../src/domain/market/volatility-protection-state.js"

const CANDLE_INTERVAL = "1m"
const CANDLE_INTERVAL_MS = 60_000
const STARTUP_HISTORY_CANDLES = 100
const ATR_PERIOD = 14
const REFERENCE_OBSERVATIONS = 60
const INDICATOR_SCALE = 18
const RATIO_SCALE = 8

function normalizeArchiveTimestamp(value, { field, sourceFile, lineNumber } = {}) {
  if (!/^\d+$/.test(value)) {
    throw new TypeError(`${sourceFile} line ${lineNumber}: ${field} must be an integer timestamp`)
  }
  const raw = Number(value)
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new RangeError(`${sourceFile} line ${lineNumber}: ${field} is outside the safe timestamp range`)
  }
  const unit = raw >= 100_000_000_000_000 ? "microseconds" : "milliseconds"
  const timestamp = unit === "microseconds" ? Math.floor(raw / 1_000) : raw
  if (!Number.isSafeInteger(timestamp)) {
    throw new RangeError(`${sourceFile} line ${lineNumber}: normalized ${field} is outside the safe timestamp range`)
  }
  return { timestamp, unit }
}

/** Parse one official Binance Spot 1m Kline CSV file into normalized closed candles. */
export function parseBinanceSpotKlineCsv({ content, symbol, sourceFile = "input.csv" } = {}) {
  if (typeof content !== "string") {
    throw new TypeError("Binance Kline CSV content must be a string")
  }
  if (typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new TypeError("Binance Kline CSV symbol must be uppercase alphanumeric")
  }

  const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (rows[0]?.split(",")[0]?.trim().toLowerCase() === "open_time") rows.shift()
  if (rows.length === 0) {
    throw new RangeError(`${sourceFile}: Binance Kline CSV contains no candle rows`)
  }

  const candles = []
  let timestampUnit = null
  let previousOpenTime = null

  for (let index = 0; index < rows.length; index += 1) {
    const lineNumber = index + 1
    const fields = rows[index].split(",").map((field) => field.trim())
    if (fields.length !== 12) {
      throw new RangeError(`${sourceFile} line ${lineNumber}: expected 12 Binance Spot Kline columns, received ${fields.length}`)
    }

    const openTime = normalizeArchiveTimestamp(fields[0], {
      field: "openTime",
      sourceFile,
      lineNumber,
    })
    const closeTime = normalizeArchiveTimestamp(fields[6], {
      field: "closeTime",
      sourceFile,
      lineNumber,
    })
    if (openTime.unit !== closeTime.unit) {
      throw new RangeError(`${sourceFile} line ${lineNumber}: openTime and closeTime use different timestamp units`)
    }
    if (timestampUnit !== null && timestampUnit !== openTime.unit) {
      throw new RangeError(`${sourceFile} line ${lineNumber}: mixed timestamp units in one CSV file`)
    }
    timestampUnit = openTime.unit

    const candle = validateCandle({
      symbol,
      interval: CANDLE_INTERVAL,
      intervalMs: CANDLE_INTERVAL_MS,
      candle: {
        symbol,
        interval: CANDLE_INTERVAL,
        openTime: openTime.timestamp,
        closeTime: closeTime.timestamp,
        open: fields[1],
        high: fields[2],
        low: fields[3],
        close: fields[4],
        volume: fields[5],
        isClosed: true,
      },
    })
    if (previousOpenTime !== null && candle.openTime <= previousOpenTime) {
      throw new RangeError(`${sourceFile} line ${lineNumber}: candle rows must be strictly ordered with no duplicate open times`)
    }
    candles.push(candle)
    previousOpenTime = candle.openTime
  }

  return Object.freeze({
    symbol,
    interval: CANDLE_INTERVAL,
    timestampUnit,
    candles: Object.freeze(candles),
  })
}

/** Merge monthly/daily archive files, deduplicate identical overlaps and reject conflicts/gaps. */
export function mergeAndValidateCandles({ symbol, candleGroups } = {}) {
  if (typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new TypeError("historical candle merge requires an uppercase symbol")
  }
  if (!Array.isArray(candleGroups) || candleGroups.length === 0) {
    throw new TypeError("historical candle merge requires at least one candle group")
  }

  const byOpenTime = new Map()
  for (const group of candleGroups) {
    if (!group || !Array.isArray(group.candles)) {
      throw new TypeError("historical candle group must contain a candles array")
    }
    for (const candle of group.candles) {
      if (candle?.symbol !== symbol || candle?.interval !== CANDLE_INTERVAL) {
        throw new RangeError("historical candle group contains a different market or interval")
      }
      const existing = byOpenTime.get(candle.openTime)
      if (existing && !areCandlesEqual(existing.candle, candle)) {
        throw new RangeError(`conflicting duplicate candle at openTime ${candle.openTime} in ${existing.sourceFile} and ${group.sourceFile ?? "another file"}`)
      }
      if (!existing) {
        byOpenTime.set(candle.openTime, {
          candle,
          sourceFile: group.sourceFile ?? "unknown source",
        })
      }
    }
  }

  const candles = [...byOpenTime.values()]
    .map(({ candle }) => candle)
    .sort((left, right) => left.openTime - right.openTime)
  if (candles.length === 0) {
    throw new RangeError("historical candle merge contains no candles")
  }

  return Object.freeze(validateCandleSeries({
    candles,
    symbol,
    interval: CANDLE_INTERVAL,
    intervalMs: CANDLE_INTERVAL_MS,
  }))
}

/** Validate candidate ratios without changing the runtime's accepted thresholds. */
export function validateCalibrationThresholds(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("calibration thresholds must be an object")
  }
  const thresholds = {
    ...VOLATILITY_PROTECTION_THRESHOLDS,
    ...overrides,
  }
  for (const field of ["recoverRatio", "warningRatio", "protectRatio"]) {
    assertDecimalString({ value: thresholds[field], field: "calibration " + field })
    if (compareDecimal({ left: thresholds[field], right: "0" }) <= 0) {
      throw new RangeError(`calibration ${field} must be positive`)
    }
  }
  if (
    compareDecimal({ left: thresholds.recoverRatio, right: thresholds.warningRatio }) >= 0 ||
    compareDecimal({ left: thresholds.warningRatio, right: thresholds.protectRatio }) >= 0
  ) {
    throw new RangeError("recovery threshold must be below warning, which must be below protection")
  }
  if (!Number.isSafeInteger(thresholds.requiredStableCandles) || thresholds.requiredStableCandles < 1) {
    throw new RangeError("requiredStableCandles must be a positive safe integer")
  }
  return Object.freeze(thresholds)
}

function percentile(sortedValues, percent) {
  const rank = Math.max(1, Math.ceil((percent / 100) * sortedValues.length))
  return sortedValues[rank - 1]
}

/**
 * Replay the production volatility metric and state-transition functions over
 * validated history. This is a threshold diagnostic, not an execution backtest.
 */
export function analyzeVolatilityHistory({ symbol, candles, thresholds: thresholdOverrides } = {}) {
  const thresholds = validateCalibrationThresholds(thresholdOverrides)
  const history = validateCandleSeries({
    candles,
    symbol,
    interval: CANDLE_INTERVAL,
    intervalMs: CANDLE_INTERVAL_MS,
  })
  if (history.length < STARTUP_HISTORY_CANDLES) {
    throw new RangeError(`historical calibration requires at least ${STARTUP_HISTORY_CANDLES} contiguous completed candles`)
  }

  let state = createVolatilityProtectionState({ symbol })
  const stateCounts = {
    [VOLATILITY_PROTECTION_MODES.NORMAL]: 0,
    [VOLATILITY_PROTECTION_MODES.PROTECTED]: 0,
    [VOLATILITY_PROTECTION_MODES.RECOVERING]: 0,
  }
  const thresholdCounts = {
    warning: 0,
    protection: 0,
    recovery: 0,
  }
  const ratios = []
  let unavailableObservations = 0
  let protectionEntries = 0
  let recoveryTransitions = 0
  let protectionRuns = 0
  let currentProtectedRun = 0
  let longestProtectedRunMinutes = 0
  let latestMetrics = null

  for (let index = STARTUP_HISTORY_CANDLES - 1; index < history.length; index += 1) {
    const window = history.slice(index - STARTUP_HISTORY_CANDLES + 1, index + 1)
    const calculated = calculateVolatilityMetrics({
      candles: window,
      intervalMs: CANDLE_INTERVAL_MS,
      period: ATR_PERIOD,
      referenceObservations: REFERENCE_OBSERVATIONS,
      indicatorScale: INDICATOR_SCALE,
      ratioScale: RATIO_SCALE,
    })
    latestMetrics = calculated.metrics ?? null

    let snapshot
    if (!calculated.metrics) {
      unavailableObservations += 1
      snapshot = {
        ok: true,
        data: {
          status: { isReady: false, reason: calculated.reason ?? "VOLATILITY_METRICS_UNAVAILABLE" },
          metrics: null,
        },
      }
    } else {
      const ratio = calculated.metrics.volatilityRatio
      ratios.push(ratio)
      if (compareDecimal({ left: ratio, right: thresholds.warningRatio }) >= 0) thresholdCounts.warning += 1
      if (compareDecimal({ left: ratio, right: thresholds.protectRatio }) >= 0) thresholdCounts.protection += 1
      if (compareDecimal({ left: ratio, right: thresholds.recoverRatio }) <= 0) thresholdCounts.recovery += 1
      snapshot = {
        ok: true,
        data: {
          status: {
            isReady: true,
            isFresh: true,
            reason: null,
            lastClosedCandleOpenTime: calculated.metrics.openTime,
          },
          metrics: calculated.metrics,
        },
      }
    }

    const transition = transitionVolatilityProtection({
      state,
      snapshot,
      activeBuyOrderCount: 0,
      thresholds,
    })
    state = transition.state
    stateCounts[state.mode] += 1
    if (transition.enteredProtected) protectionEntries += 1
    if (transition.recovered) recoveryTransitions += 1

    if (state.mode !== VOLATILITY_PROTECTION_MODES.NORMAL) {
      if (currentProtectedRun === 0) protectionRuns += 1
      currentProtectedRun += 1
      longestProtectedRunMinutes = Math.max(longestProtectedRunMinutes, currentProtectedRun)
    } else {
      currentProtectedRun = 0
    }
  }

  if (ratios.length === 0 || !latestMetrics) {
    throw new RangeError("historical calibration produced no valid volatility-ratio observations")
  }
  const sortedRatios = [...ratios].sort((left, right) => compareDecimal({ left, right }))
  const protectedObservations =
    stateCounts[VOLATILITY_PROTECTION_MODES.PROTECTED] +
    stateCounts[VOLATILITY_PROTECTION_MODES.RECOVERING]
  const observationCount = history.length - STARTUP_HISTORY_CANDLES + 1

  return Object.freeze({
    symbol,
    interval: CANDLE_INTERVAL,
    candleCount: history.length,
    historyStartTime: history[0].openTime,
    historyEndTime: history.at(-1).openTime,
    analyzedStartTime: history[STARTUP_HISTORY_CANDLES - 1].openTime,
    analyzedEndTime: history.at(-1).openTime,
    observationCount,
    ratioObservations: ratios.length,
    unavailableObservations,
    thresholds,
    thresholdCounts: Object.freeze(thresholdCounts),
    ratioPercentiles: Object.freeze({
      p50: percentile(sortedRatios, 50),
      p90: percentile(sortedRatios, 90),
      p95: percentile(sortedRatios, 95),
      p99: percentile(sortedRatios, 99),
    }),
    maximumRatio: sortedRatios.at(-1),
    stateCounts: Object.freeze(stateCounts),
    protectionEntries,
    recoveryTransitions,
    protectionRuns,
    longestProtectedRunMinutes,
    protectedPercent: Number(((protectedObservations / observationCount) * 100).toFixed(2)),
    latestMetrics,
    assumptions: Object.freeze({
      startupHistoryCandles: STARTUP_HISTORY_CANDLES,
      activeBuyOrderCount: 0,
      exchangeOrderExecutionSimulated: false,
      streamFreshnessSimulated: false,
      strategyProfitabilityEvaluated: false,
    }),
  })
}

export function parseCalibrationArguments(args = []) {
  if (!Array.isArray(args)) throw new TypeError("calibration CLI arguments must be an array")
  const inputPaths = []
  const thresholdOverrides = {}
  let outputPath = null
  let help = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--help" || argument === "-h") {
      help = true
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new TypeError(`missing value for ${argument}`)
    }
    if (argument === "--input") inputPaths.push(value)
    else if (argument === "--output") outputPath = value
    else if (argument === "--warning-ratio") thresholdOverrides.warningRatio = value
    else if (argument === "--protect-ratio") thresholdOverrides.protectRatio = value
    else if (argument === "--recover-ratio") thresholdOverrides.recoverRatio = value
    else if (argument === "--stable-candles") thresholdOverrides.requiredStableCandles = Number(value)
    else throw new TypeError(`unknown calibration argument: ${argument}`)
    index += 1
  }

  if (!help && inputPaths.length === 0) {
    throw new TypeError("provide at least one --input Binance Spot 1m CSV file")
  }
  const thresholds = validateCalibrationThresholds(thresholdOverrides)
  return Object.freeze({
    inputPaths: Object.freeze(inputPaths),
    outputPath,
    thresholds,
    help,
  })
}

function printUsage() {
  return [
    "Usage: pnpm --filter @coinzilla/harvester run volatility:calibrate -- --input <SYMBOL-1m-YYYY-MM.csv> [--input <another.csv>]",
    "Options:",
    "  --output <file.json>       Write the report to a file instead of stdout",
    "  --warning-ratio <decimal>  Candidate warning threshold (default: 1.5)",
    "  --protect-ratio <decimal>  Candidate protection threshold (default: 2)",
    "  --recover-ratio <decimal>  Candidate recovery threshold (default: 1.3)",
    "  --stable-candles <count>   Consecutive stable candles required (default: 3)",
    "  --help                     Show this help",
  ].join("\n")
}

function symbolFromArchiveFilename(filePath) {
  const match = basename(filePath).match(/^([A-Z0-9]+)-1m-\d{4}-\d{2}(?:-\d{2})?\.csv$/i)
  if (!match) {
    throw new TypeError(`input filename must match SYMBOL-1m-YYYY-MM.csv or SYMBOL-1m-YYYY-MM-DD.csv: ${basename(filePath)}`)
  }
  return match[1].toUpperCase()
}

export function runCalibrationCli(args = process.argv.slice(2)) {
  const options = parseCalibrationArguments(args)
  if (options.help) {
    process.stdout.write(printUsage() + "\n")
    return
  }

  const groupsBySymbol = new Map()
  const fileReports = []
  for (const filePath of options.inputPaths) {
    const symbol = symbolFromArchiveFilename(filePath)
    const content = readFileSync(filePath, "utf8")
    const parsed = parseBinanceSpotKlineCsv({
      content,
      symbol,
      sourceFile: basename(filePath),
    })
    const group = {
      sourceFile: basename(filePath),
      candles: parsed.candles,
    }
    const groups = groupsBySymbol.get(symbol) ?? []
    groups.push(group)
    groupsBySymbol.set(symbol, groups)
    fileReports.push(Object.freeze({
      file: basename(filePath),
      symbol,
      candleCount: parsed.candles.length,
      timestampUnit: parsed.timestampUnit,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    }))
  }

  const markets = [...groupsBySymbol.entries()].map(([symbol, groups]) => {
    const candles = mergeAndValidateCandles({ symbol, candleGroups: groups })
    return analyzeVolatilityHistory({ symbol, candles, thresholds: options.thresholds })
  })
  const report = Object.freeze({
    dataSource: "Binance Spot Public Data archive (data.binance.vision)",
    interval: CANDLE_INTERVAL,
    thresholds: options.thresholds,
    files: Object.freeze(fileReports),
    markets: Object.freeze(markets),
    limitations: Object.freeze([
      "Historical analysis assumes no active or unresolved owned BUY orders.",
      "Exchange cancellation latency, fills, fees, slippage and order execution are not simulated.",
      "The report measures threshold/state behavior; it does not establish strategy profitability or prove that a threshold is optimal.",
      "No runtime threshold is changed by this command.",
    ]),
  })
  const serialized = JSON.stringify(report, null, 2) + "\n"
  if (options.outputPath) writeFileSync(resolve(options.outputPath), serialized, "utf8")
  else process.stdout.write(serialized)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    runCalibrationCli()
  } catch (error) {
    process.stderr.write(`Volatility calibration failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
