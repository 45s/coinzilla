import { Console } from "node:console"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import { getScenarioRunFailures } from "../test/scenarios/shared/assertions.js"
import { loadConservativeScenarios, PACKAGE_ROOT } from "../test/scenarios/shared/loader.js"
import { buildScenarioReports, writeScenarioReports } from "../test/scenarios/shared/reporter.js"
import { filterScenarios, runScenarioSuite } from "../test/scenarios/shared/runner.js"

const logger = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
})
const PACKAGE_JSON = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8"))
const DEFAULT_REPORT_DIRECTORY = "reports/conservative-scenarios"
const FILTER_OPTIONS = new Map([
  ["--id", "id"],
  ["--category", "category"],
  ["--priority", "priority"],
  ["--tag", "tag"],
  ["--status", "coverageStatus"],
])

function splitOption({ token }) {
  const separator = token.indexOf("=")
  if (separator === -1) {
    return {
      name: token,
      value: null,
    }
  }
  return {
    name: token.slice(0, separator),
    value: token.slice(separator + 1),
  }
}

function appendFilter({ filters, field, value }) {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean)
  filters[field] = [...(filters[field] ?? []), ...values]
}

export function parseScenarioCliArguments({ argv = [] } = {}) {
  const filters = {}
  let reportDirectory = DEFAULT_REPORT_DIRECTORY
  let listOnly = false
  let help = false
  let version = false

  for (let index = 0; index < argv.length; index += 1) {
    const option = splitOption({ token: argv[index] })
    if (option.name === "--help" || option.name === "-h") {
      help = true
    } else if (option.name === "--version" || option.name === "-v") {
      version = true
    } else if (option.name === "--list") {
      listOnly = true
    } else if (option.name === "--report-dir") {
      const value = option.value ?? argv[index + 1]
      if (!value) {
        throw new Error("--report-dir requires a directory.")
      }
      reportDirectory = value
      if (option.value === null) {
        index += 1
      }
    } else if (FILTER_OPTIONS.has(option.name)) {
      const value = option.value ?? argv[index + 1]
      if (!value) {
        throw new Error(`${option.name} requires a value.`)
      }
      appendFilter({
        filters,
        field: FILTER_OPTIONS.get(option.name),
        value,
      })
      if (option.value === null) {
        index += 1
      }
    } else {
      throw new Error(`Unknown option: ${option.name}`)
    }
  }

  return {
    filters,
    reportDirectory,
    listOnly,
    help,
    version,
  }
}

function printUsage() {
  logger.log([
    "Usage: pnpm --filter @coinzilla/harvester scenarios:conservative -- [filters]",
    "",
    "Filters:",
    "  --id CON-BUY-001",
    "  --category recovery-lifecycle",
    "  --priority P0",
    "  --tag accounting",
    "  --status TEST-MAPPED",
    "  --report-dir reports/conservative-scenarios",
    "  --list",
    "  --help",
    "  --version",
  ].join("\n"))
}

function printBuildIdentity({ buildMetadata }) {
  const { source } = buildMetadata
  logger.log(`[harvester-conservative-scenarios] ${buildMetadata.application}@${buildMetadata.version}`)
  logger.log(`[harvester-conservative-scenarios] branch=${source.branch ?? "unknown"} commit=${source.commit ?? "unknown"} worktree=${source.workingTree}`)
  logger.log(`[harvester-conservative-scenarios] runtime=${process.version} metadataSource=${source.metadataSource}`)
}

function printScenarioList({ scenarios }) {
  for (const scenario of scenarios) {
    logger.log(`${scenario.id} | ${scenario.priority} | ${scenario.coverageStatus} | ${scenario.title}`)
  }
}

function printRunSummary({ suite, reportPaths }) {
  const counts = suite.results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] ?? 0) + 1
    return summary
  }, {})
  logger.log(`Scenarios selected: ${suite.selectedScenarios.length}`)
  logger.log(`Scenario execution: ${JSON.stringify(counts)}`)
  logger.log(`Named tests executed: ${suite.testResults.length}`)
  logger.log(`Reports: ${reportPaths.inventory}, ${reportPaths.results}, ${reportPaths.coverage}`)
}

export async function runConservativeScenarioCli({ argv = process.argv.slice(2) } = {}) {
  const options = parseScenarioCliArguments({ argv })
  if (options.version) {
    logger.log(`@coinzilla/harvester ${PACKAGE_JSON.version}`)
    return 0
  }
  if (options.help) {
    printUsage()
    return 0
  }

  const buildMetadata = captureBuildMetadata({
    application: "harvester-conservative-scenarios",
    version: PACKAGE_JSON.version,
    cwd: PACKAGE_ROOT,
    env: process.env,
  })
  printBuildIdentity({ buildMetadata })

  const { scenarios, requirements, criticalBehaviorContract } = loadConservativeScenarios()
  const selectedScenarios = filterScenarios({
    scenarios,
    filters: options.filters,
  })
  if (selectedScenarios.length === 0) {
    logger.error("No Conservative scenarios matched the supplied filters.")
    return 2
  }
  if (options.listOnly) {
    printScenarioList({ scenarios: selectedScenarios })
    return 0
  }

  const suite = await runScenarioSuite({
    scenarios,
    filters: options.filters,
    cwd: PACKAGE_ROOT,
  })
  const reports = buildScenarioReports({
    scenarios,
    results: suite.results,
    requirements,
    criticalBehaviorContract,
    buildMetadata,
    filters: options.filters,
  })
  const reportPaths = await writeScenarioReports({
    reports,
    outputDirectory: resolve(PACKAGE_ROOT, options.reportDirectory),
  })
  printRunSummary({
    suite,
    reportPaths,
  })

  return getScenarioRunFailures({ results: suite.results }).length > 0 ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConservativeScenarioCli().then((exitCode) => {
    process.exitCode = exitCode
  }).catch((error) => {
    logger.error(error.stack ?? error.message)
    process.exitCode = 1
  })
}
