import { spawnSync as defaultSpawnSync } from "node:child_process"

const REGEXP_SPECIAL_CHARS = new Set([".", "*", "+", "?", "^", "$", "(", ")", "|", "[", "]", "\\", "{", "}"])

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
  return [...value].map((character) => (
    REGEXP_SPECIAL_CHARS.has(character) ? "\\" + character : character
  )).join("")
}

function parseTapLine(line) {
  const match = line.trim().match(/^(ok|not ok)\s+\d+\s+-\s+(.*)$/i)
  if (!match) {
    return null
  }

  const title = match[2]
  const directiveMatch = title.match(/^(.*)\s+#\s*(SKIP|TODO)(?:\s+.*)?$/i)
  return {
    outcome: match[1].toLowerCase(),
    name: (directiveMatch ? directiveMatch[1] : title).trim(),
    directive: directiveMatch?.[2]?.toUpperCase() ?? null,
  }
}

export function parseTapResults({ output = "", expectedTests = [] } = {}) {
  const tapResults = output.split(/\r?\n/).map(parseTapLine).filter(Boolean)

  return expectedTests.map((testCase) => {
    const matchingResults = tapResults.filter((result) => result.name === testCase.name)
    let status = "NOT_FOUND"

    if (matchingResults.length > 1) {
      status = "AMBIGUOUS"
    } else if (matchingResults.length === 1) {
      const [result] = matchingResults
      if (result.directive) {
        status = "SKIPPED"
      } else if (result.outcome === "not ok") {
        status = "FAILED"
      } else {
        status = "PASSED"
      }
    }

    return {
      ...testCase,
      status,
    }
  })
}

function testKey(testCase) {
  return testCase.path + "::" + testCase.name
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
  const pattern = "(?:" + group.testCases.map(({ name }) => escapeRegExp(name)).join("|") + ")"
  const args = [
    "--test",
    "--test-reporter=tap",
    "--test-name-pattern=" + pattern,
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
  const processFailed = Boolean(execution.error) || execution.status !== 0
  const executionError = execution.error?.message ??
    (processFailed ? "Node test process exited with status " + (execution.status ?? "unknown") + "." : null)
  const observedTapTitles = (execution.stdout ?? "").split(String.fromCharCode(10))
    .map(parseTapLine)
    .filter(Boolean)
    .map((result) => result.name)
    .slice(0, 20)
  const missingTestError = observedTapTitles.length === 0
    ? "Node test process emitted no parseable TAP result titles."
    : "No exact TAP title match. Observed titles: " + observedTapTitles.join(" | ")

  return parsed.map((result) => {
    const status = processFailed && result.status === "PASSED"
      ? "PROCESS_FAILED"
      : result.status

    return {
      ...result,
      status,
      exitCode: execution.status,
      error: result.status === "NOT_FOUND" ? (executionError ?? missingTestError) : (processFailed ? executionError : null),
      stderr: processFailed ? (execution.stderr ?? "").slice(0, 2000) : null,
    }
  })
}

function scenarioResult({ scenario, testResults }) {
  let status = "PASSED"
  if (testResults.length === 0) {
    status = "NOT_EXECUTABLE"
  } else if (testResults.some((result) => ["FAILED", "PROCESS_FAILED", "AMBIGUOUS"].includes(result.status))) {
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
