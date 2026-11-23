import { spawnSync as defaultSpawnSync } from "node:child_process"

function normalizeFilterValues(value) {
  if (value === undefined || value === null || value === "") {
    return []
  }
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).toLowerCase())
}

function matchesFilter({ candidate, filter }) {
  const values = normalizeFilterValues(filter)
  if (values.length === 0) {
    return true
  }
  return values.includes(String(candidate ?? "").toLowerCase())
}

export function filterScenarios({ scenarios = [], filters = {} } = {}) {
  return scenarios.filter((scenario) => (
    matchesFilter({ candidate: scenario.id, filter: filters.id }) &&
    matchesFilter({ candidate: scenario.category, filter: filters.category }) &&
    matchesFilter({ candidate: scenario.priority, filter: filters.priority }) &&
    matchesFilter({ candidate: scenario.coverageStatus, filter: filters.coverageStatus }) &&
    normalizeFilterValues(filters.tag).every((tag) => scenario.tags.some((item) => String(item).toLowerCase() === tag))
  ))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function parseTapResults({ output = "", expectedTests = [] } = {}) {
  const lines = output.split(/\r?\n/).filter((line) => /^\s*(?:ok|not ok)\s+\d+\s+-/.test(line))
  return expectedTests.map((testCase) => {
    const matchingLines = lines.filter((line) => line.includes(testCase.name))
    let status = "NOT_FOUND"
    if (matchingLines.some((line) => /^\s*not ok\s/.test(line))) {
      status = "FAILED"
    } else if (matchingLines.some((line) => /#\s*(?:SKIP|TODO)/i.test(line))) {
      status = "SKIPPED"
    } else if (matchingLines.some((line) => /^\s*ok\s/.test(line))) {
      status = "PASSED"
    }
    return {
      ...testCase,
      status,
    }
  })
}

function testKey(testCase) {
  return `${testCase.path}::${testCase.name}`
}

function groupTestsByPath({ scenarios }) {
  const groups = new Map()
  for (const scenario of scenarios) {
    for (const testCase of scenario.relatedExistingTests) {
      if (!groups.has(testCase.path)) {
        groups.set(testCase.path, new Map())
      }
      groups.get(testCase.path).set(testKey(testCase), testCase)
    }
  }
  return [...groups.entries()].map(([path, testMap]) => ({
    path,
    testCases: [...testMap.values()],
  }))
}

function executeTestGroup({
  group,
  cwd,
  spawnSync,
  nodeExecutable,
  timeoutMs,
}) {
  const pattern = `(?:${group.testCases.map(({ name }) => escapeRegExp(name)).join("|")})`
  const args = [
    "--test",
    "--test-reporter=tap",
    `--test-name-pattern=${pattern}`,
    group.path,
  ]
  const execution = spawnSync(nodeExecutable, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  const parsed = parseTapResults({
    output: execution.stdout ?? "",
    expectedTests: group.testCases,
  })
  const executionError = execution.error?.message ??
    (execution.status === 0 ? null : `Node test process exited with status ${execution.status}.`)

  return parsed.map((result) => ({
    ...result,
    exitCode: execution.status,
    error: result.status === "NOT_FOUND" ? executionError : null,
    stderr: result.status === "FAILED" ? (execution.stderr ?? "").slice(0, 2000) : null,
  }))
}

function scenarioResult({ scenario, testResults }) {
  let status = "PASSED"
  if (testResults.length === 0) {
    status = "NOT_EXECUTABLE"
  } else if (testResults.some((result) => result.status === "FAILED")) {
    status = "FAILED"
  } else if (testResults.some((result) => result.status === "NOT_FOUND")) {
    status = "TEST_NOT_FOUND"
  } else if (testResults.some((result) => result.status === "SKIPPED")) {
    status = "SKIPPED"
  }
  return {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    coverageStatus: scenario.coverageStatus,
    status,
    testResults,
  }
}

export async function runScenarioSuite({
  scenarios = [],
  filters = {},
  cwd = process.cwd(),
  spawnSync = defaultSpawnSync,
  nodeExecutable = process.execPath,
  timeoutMs = 300000,
} = {}) {
  const selectedScenarios = filterScenarios({ scenarios, filters })
  const testResultsByKey = new Map()
  const groups = groupTestsByPath({ scenarios: selectedScenarios })

  for (const group of groups) {
    const groupResults = executeTestGroup({
      group,
      cwd,
      spawnSync,
      nodeExecutable,
      timeoutMs,
    })
    for (const result of groupResults) {
      testResultsByKey.set(testKey(result), result)
    }
  }

  const results = selectedScenarios.map((scenario) => {
    const testResults = scenario.relatedExistingTests.map((testCase) => (
      testResultsByKey.get(testKey(testCase)) ?? {
        ...testCase,
        status: "NOT_FOUND",
      }
    ))
    return scenarioResult({
      scenario,
      testResults,
    })
  })

  return {
    selectedScenarios,
    results,
    testResults: [...testResultsByKey.values()],
    filters,
  }
}
