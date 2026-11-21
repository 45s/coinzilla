import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultLogger } from "@coinzilla/utils"

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url))
const CONTRACT_PATH = path.join(APP_ROOT, "docs", "critical-behaviors.json")
const METRICS = ["lines", "branches", "functions"]

/**
 * Parse the hierarchical table emitted by Node's built-in test coverage reporter.
 *
 * @param {string} reportText Captured Node test-runner output.
 * @returns {Map<string, { lines: number, branches: number, functions: number }>}
 */
export function parseNodeCoverageReport(reportText) {
  const coverage = new Map()
  const directories = new Map()
  const reportLines = reportText.split(/\r?\n/)

  for (const reportLine of reportLines) {
    const markerIndex = reportLine.indexOf("ℹ")
    if (markerIndex < 0) {
      continue
    }
    const tableLine = reportLine.slice(markerIndex + 1).replace(/\u001b\[[0-9;]*m/g, "")
    const row = /^(\s*)([^|]+?)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/.exec(tableLine)
    if (!row) {
      continue
    }

    const indentation = row[1].length
    const name = row[2].trim()
    const lineCoverage = row[3].trim()
    if (name === "all files") {
      continue
    }

    const depth = Math.max(0, indentation - 1)
    if (lineCoverage.length === 0) {
      if (name === "src") {
        directories.clear()
        continue
      }
      directories.set(depth, name)
      for (const directoryDepth of directories.keys()) {
        if (directoryDepth > depth) {
          directories.delete(directoryDepth)
        }
      }
      continue
    }

    const values = [row[3], row[4], row[5]].map((value) => Number.parseFloat(value.trim()))
    if (!values.every(Number.isFinite)) {
      continue
    }
    const parentDirectories = [...directories.entries()]
      .filter(([directoryDepth]) => directoryDepth < depth)
      .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
      .map(([, directoryName]) => directoryName)
    const modulePath = ["src", ...parentDirectories, name].join("/")
    coverage.set(modulePath, {
      lines: values[0],
      branches: values[1],
      functions: values[2],
    })
  }

  return coverage
}

/**
 * Enforce measured minimum coverage for every critical production module.
 *
 * @param {object} options
 * @param {Array<object>} options.moduleCoverage Critical module baseline/floor entries.
 * @param {Map<string, object>} options.coverage Parsed actual coverage.
 * @returns {{ errors: string[], checkedModules: string[] }}
 */
export function validateCriticalModuleCoverage({ moduleCoverage, coverage } = {}) {
  const errors = []
  const checkedModules = []
  if (!Array.isArray(moduleCoverage) || moduleCoverage.length === 0) {
    return {
      errors: ["Critical module coverage floors are missing."],
      checkedModules,
    }
  }
  if (!(coverage instanceof Map)) {
    return {
      errors: ["Parsed critical module coverage must be a Map."],
      checkedModules,
    }
  }

  for (const entry of moduleCoverage) {
    const modulePath = entry?.path
    if (typeof modulePath !== "string" || modulePath.length === 0) {
      errors.push("Critical module coverage contains an entry without a source path.")
      continue
    }
    const actual = coverage.get(modulePath)
    if (!actual) {
      errors.push(`Critical module ${modulePath} is missing from the Node coverage report.`)
      continue
    }
    checkedModules.push(modulePath)

    for (const metric of METRICS) {
      const minimum = entry.minimum?.[metric]
      const measured = actual[metric]
      if (!Number.isFinite(minimum) || !Number.isFinite(measured)) {
        errors.push(`Critical module ${modulePath} has invalid ${metric} coverage evidence.`)
      } else if (measured < minimum) {
        errors.push(
          `Critical module ${modulePath} ${metric} coverage ${measured.toFixed(2)}% is below its ${minimum.toFixed(2)}% minimum.`,
        )
      }
    }
  }

  return {
    errors,
    checkedModules: checkedModules.sort(),
  }
}

function runCriticalModuleCoverageCheck() {
  const reportPath = process.argv[2]
  if (!reportPath) {
    defaultLogger.error({
      message: "Harvester critical module coverage report path is required",
    })
    process.exitCode = 1
    return
  }

  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"))
  const reportText = readFileSync(path.resolve(process.cwd(), reportPath), "utf8")
  const coverage = parseNodeCoverageReport(reportText)
  const result = validateCriticalModuleCoverage({
    moduleCoverage: contract.moduleCoverage,
    coverage,
  })

  if (result.errors.length > 0) {
    defaultLogger.error({
      message: "Harvester critical module coverage gate failed",
      errors: result.errors,
      checkedModuleCount: result.checkedModules.length,
    })
    process.exitCode = 1
  } else {
    defaultLogger.info({
      message: "Harvester critical module coverage gate passed",
      checkedModuleCount: result.checkedModules.length,
      checkedModules: result.checkedModules,
    })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCriticalModuleCoverageCheck()
}
