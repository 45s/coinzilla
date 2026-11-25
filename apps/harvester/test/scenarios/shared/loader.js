import {
  existsSync,
  readFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ADDITIONAL_TEST_MAPPINGS } from "./additional-test-mappings.js"
import { CONSERVATIVE_REQUIREMENTS } from "./requirements.js"
import {
  conservativeScenarioRegistry,
  defineConservativeScenario,
  validateConservativeScenarioRegistry,
} from "../conservative/registry/index.js"

export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const CRITICAL_BEHAVIOR_PATH = resolve(PACKAGE_ROOT, "docs/critical-behaviors.json")

function uniqueBy(items, keyOf) {
  const seen = new Set()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function isRepositoryRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("/") ||
      /^[A-Za-z]:/.test(value)) {
    return false
  }
  return value.split(/[\\/]/).every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

function resolveScenarioEvidence({
  scenario,
  behaviorMap,
}) {
  const relatedBehaviors = scenario.relatedCriticalBehaviors.map((id) => {
    const behavior = behaviorMap.get(id)
    if (!behavior) {
      throw new TypeError(`Scenario ${scenario.id} references unknown critical behavior ${id}.`)
    }
    return behavior
  })
  const relatedSourceFiles = uniqueBy(
    [
      ...scenario.relatedSourceFiles,
      ...relatedBehaviors.flatMap((behavior) => behavior.sourceModules ?? []),
    ],
    (path) => path,
  )
  const relatedExistingTests = uniqueBy(
    [
      ...scenario.relatedExistingTests,
      ...(ADDITIONAL_TEST_MAPPINGS[scenario.id] ?? []),
      ...relatedBehaviors.flatMap((behavior) => behavior.tests ?? []),
    ],
    (testCase) => `${testCase.path}::${testCase.name}`,
  )

  return defineConservativeScenario({
    ...scenario,
    relatedSourceFiles,
    relatedExistingTests,
  })
}

function assertEvidencePathsExist({ scenarios }) {
  const missingPaths = []
  for (const scenario of scenarios) {
    for (const sourcePath of scenario.relatedSourceFiles) {
      if (!isRepositoryRelativePath(sourcePath) || !existsSync(resolve(PACKAGE_ROOT, sourcePath))) {
        missingPaths.push(sourcePath)
      }
    }
    for (const testCase of scenario.relatedExistingTests) {
      if (!isRepositoryRelativePath(testCase.path) || !existsSync(resolve(PACKAGE_ROOT, testCase.path))) {
        missingPaths.push(testCase.path)
      }
    }
  }
  if (missingPaths.length > 0) {
    throw new TypeError(`Scenario evidence paths are missing or unsafe: ${[...new Set(missingPaths)].join(", ")}`)
  }
}

export function resolveScenarioDefinitions({
  definitions = conservativeScenarioRegistry,
  requirements = CONSERVATIVE_REQUIREMENTS,
  criticalBehaviorContract = { behaviors: [] },
} = {}) {
  const behaviorMap = new Map((criticalBehaviorContract.behaviors ?? []).map((behavior) => [behavior.id, behavior]))
  const scenarios = definitions.map((scenario) => resolveScenarioEvidence({
    scenario,
    behaviorMap,
  }))
  const validation = validateConservativeScenarioRegistry({
    scenarios,
    requirements,
    criticalBehaviorContract,
  })
  if (!validation.valid) {
    throw new TypeError(validation.errors.join("\n"))
  }
  return {
    scenarios: Object.freeze(scenarios),
    requirements,
    criticalBehaviorContract,
  }
}

export function loadConservativeScenarios() {
  const criticalBehaviorContract = JSON.parse(readFileSync(CRITICAL_BEHAVIOR_PATH, "utf8"))
  const loaded = resolveScenarioDefinitions({ criticalBehaviorContract })
  assertEvidencePathsExist({ scenarios: loaded.scenarios })
  return loaded
}
