import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultLogger } from "@coinzilla/utils"

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url))
const CONTRACT_PATH = path.join(APP_ROOT, "docs", "critical-behaviors.json")
const METRICS = ["lines", "branches", "functions"]

function parseCoverageRow(tableLine) {
  const row = /^(\s*)([^|]+?)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/.exec(tableLine)
  if (!row) {
    return undefined
  }

  const [, indentationText, nameText, linesText, branchesText, functionsText] = row
  const name = nameText.trim()
  if (name === "all files") {
    return undefined
  }
  const depth = Math.max(0, indentationText.length - 1)
  if (linesText.trim().length === 0) {
    return {
      type: "directory",
      depth,
      name,
    }
  }

  const values = [linesText, branchesText, functionsText]
    .map((value) => Number.parseFloat(value.trim()))
  if (!values.every(Number.isFinite)) {
    return undefined
  }
  return {
    type: "file",
    depth,
    name,
    coverage: {
      lines: values[0],
      branches: values[1],
      functions: values[2],
    },
  }
}

function updateDirectoryStack({ directories, depth, name }) {
  if (name === "src") {
    directories.length = 0
    return
  }
  directories.length = depth + 1
  directories[depth] = name
}

function buildModulePath({ directories, depth, name }) {
  const parentDirectories = directories.slice(1, depth).filter(Boolean)
  return ["src", ...parentDirectories, name].join("/")
}

/**
 * Parse the hierarchical table emitted by Node's built-in test coverage reporter.
 *
 * @param {string} reportText Captured Node test-runner output.
 * @returns {Map<string, { lines: number, branches: number, functions: number }>}
 */
export function parseNodeCoverageReport(reportText) {
  const coverage = new Map()
  const directories = []
  for (const reportLine of reportText.split(/\r?\n/)) {
    const markerIndex = reportLine.indexOf("ℹ")
    if (markerIndex < 0) {
      continue
    }
    const parsedRow = parseCoverageRow(reportLine.slice(markerIndex + 1))
    if (!parsedRow) {
      continue
    }
    if (parsedRow.type === "directory") {
      updateDirectoryStack({
        directories,
        depth: parsedRow.depth,
        name: parsedRow.name,
      })
      continue
    }

    const modulePath = buildModulePath({
      directories,
      depth: parsedRow.depth,
      name: parsedRow.name,
    })
    coverage.set(modulePath, parsedRow.coverage)
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
  const [, , reportPath] = process.argv
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
