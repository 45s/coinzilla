import {
  mkdir,
  writeFile,
} from "node:fs/promises"
import {
  join,
  resolve,
} from "node:path"

function countBy({
  items,
  field,
}) {
  const counts = {}
  for (const item of items) {
    const key = item[field] ?? "UNSPECIFIED"
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function uniqueTests({ tests }) {
  const testMap = new Map()
  for (const testCase of tests) {
    testMap.set(`${testCase.path}::${testCase.name}`, testCase)
  }
  return [...testMap.values()]
}

function allCriticalTests({ criticalBehaviorContract }) {
  return uniqueTests({
    tests: (criticalBehaviorContract.behaviors ?? []).flatMap((behavior) => (
      (behavior.tests ?? []).map((testCase) => ({
        ...testCase,
        behaviorId: behavior.id,
      }))
    )),
  })
}

function buildInventory({
  scenarios,
  generatedAt,
}) {
  return {
    schemaVersion: 1,
    generatedAt,
    totalScenarios: scenarios.length,
    categories: countBy({
      items: scenarios,
      field: "category",
    }),
    priorities: countBy({
      items: scenarios,
      field: "priority",
    }),
    coverageStatuses: countBy({
      items: scenarios,
      field: "coverageStatus",
    }),
    scenarios,
  }
}

function buildResults({
  scenarios,
  results,
  buildMetadata,
  filters,
  generatedAt,
}) {
  const resultMap = new Map(results.map((result) => [result.id, result]))
  const completeResults = scenarios.map((scenario) => resultMap.get(scenario.id) ?? {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    coverageStatus: scenario.coverageStatus,
    status: "NOT_SELECTED",
    testResults: [],
  })
  return {
    schemaVersion: 1,
    generatedAt,
    buildMetadata,
    filters,
    totalScenarios: scenarios.length,
    selectedScenarios: results.length,
    counts: countBy({
      items: completeResults,
      field: "status",
    }),
    results: completeResults,
  }
}

function buildCoverage({
  scenarios,
  requirements,
  criticalBehaviorContract,
  results,
  generatedAt,
}) {
  const requirementIds = new Set(scenarios.flatMap((scenario) => scenario.relatedRequirements))
  const behaviorIds = new Set(scenarios.flatMap((scenario) => scenario.relatedCriticalBehaviors))
  const mappedTests = new Set(scenarios.flatMap((scenario) => (
    scenario.relatedExistingTests.map((testCase) => `${testCase.path}::${testCase.name}`)
  )))
  const criticalTests = allCriticalTests({ criticalBehaviorContract })
  const scenarioResults = new Map(results.map((result) => [result.id, result]))

  return {
    schemaVersion: 1,
    generatedAt,
    totals: {
      scenarios: scenarios.length,
      requirements: requirements.length,
      criticalBehaviors: criticalBehaviorContract.behaviors.length,
      uniqueCriticalTests: criticalTests.length,
    },
    byCategory: countBy({
      items: scenarios,
      field: "category",
    }),
    byPriority: countBy({
      items: scenarios,
      field: "priority",
    }),
    byCoverageStatus: countBy({
      items: scenarios,
      field: "coverageStatus",
    }),
    byExecutionStatus: countBy({
      items: scenarios.map((scenario) => ({
        status: scenarioResults.get(scenario.id)?.status ?? "NOT_SELECTED",
      })),
      field: "status",
    }),
    missingCriticalScenarios: scenarios.filter((scenario) => (
      ["P0", "P1"].includes(scenario.priority) &&
      !["VERIFIED", "UNSUPPORTED"].includes(scenario.coverageStatus)
    )),
    scenariosWithoutTests: scenarios.filter((scenario) => (
      scenario.relatedExistingTests.length === 0 &&
      scenario.coverageStatus !== "UNSUPPORTED"
    )),
    requirementsWithoutScenarioCoverage: requirements.filter((requirement) => (
      !requirementIds.has(requirement.id)
    )),
    criticalBehaviorsWithoutScenarioCoverage: criticalBehaviorContract.behaviors.filter((behavior) => (
      !behaviorIds.has(behavior.id)
    )),
    testsNotMappedToAnyScenario: criticalTests.filter((testCase) => (
      !mappedTests.has(`${testCase.path}::${testCase.name}`)
    )),
    testDiscoveryScope: "Unmapped-test analysis covers named tests registered in apps/harvester/docs/critical-behaviors.json. Supplemental scenario-specific tests are linked in additional-test-mappings.js; this is not a scan of every Harvester test file.",
  }
}

export function buildScenarioReports({
  scenarios,
  results,
  requirements,
  criticalBehaviorContract,
  buildMetadata = null,
  filters = {},
} = {}) {
  const generatedAt = new Date().toISOString()
  return {
    inventory: buildInventory({
      scenarios,
      generatedAt,
    }),
    results: buildResults({
      scenarios,
      results,
      buildMetadata,
      filters,
      generatedAt,
    }),
    coverage: buildCoverage({
      scenarios,
      requirements,
      criticalBehaviorContract,
      results,
      generatedAt,
    }),
  }
}

export async function writeScenarioReports({
  reports,
  outputDirectory,
} = {}) {
  await mkdir(outputDirectory, { recursive: true })
  const paths = {
    inventory: resolve(join(outputDirectory, "scenario-inventory.json")),
    results: resolve(join(outputDirectory, "scenario-results.json")),
    coverage: resolve(join(outputDirectory, "scenario-coverage.json")),
  }
  await Promise.all([
    writeFile(paths.inventory, `${JSON.stringify(reports.inventory, null, 2)}\n`),
    writeFile(paths.results, `${JSON.stringify(reports.results, null, 2)}\n`),
    writeFile(paths.coverage, `${JSON.stringify(reports.coverage, null, 2)}\n`),
  ])
  return paths
}
