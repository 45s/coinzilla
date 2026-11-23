import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { scenarios as decisionScenarios } from "../conservative/decisions/index.js"
import { scenarios as buyScenarios } from "../conservative/buy/index.js"
import { scenarios as sellScenarios } from "../conservative/sell/index.js"
import { scenarios as recoveryScenarios } from "../conservative/recovery/index.js"
import { scenarios as accountingScenarios } from "../conservative/accounting/index.js"
import { scenarios as safetyScenarios } from "../conservative/safety/index.js"
import { scenarios as reliabilityScenarios } from "../conservative/reliability/index.js"
import { CONSERVATIVE_REQUIREMENTS } from "./requirements.js"
import { assertValidScenarioDefinitions } from "./schema.js"

const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const CRITICAL_BEHAVIOR_PATH = fileURLToPath(new URL("../../../docs/critical-behaviors.json", import.meta.url))

const SCENARIO_GROUPS = [
  decisionScenarios,
  buyScenarios,
  sellScenarios,
  recoveryScenarios,
  accountingScenarios,
  safetyScenarios,
  reliabilityScenarios,
]

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

function resolveScenarioEvidence({ scenario, behaviorMap }) {
  const relatedBehaviors = scenario.relatedCriticalBehaviors.map((id) => behaviorMap.get(id))
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
      ...relatedBehaviors.flatMap((behavior) => behavior.tests ?? []),
    ],
    (testCase) => `${testCase.path}::${testCase.name}`,
  )

  return {
    ...scenario,
    relatedSourceFiles,
    relatedExistingTests,
  }
}

function assertEvidencePathsExist({ scenarios }) {
  const missingPaths = []
  for (const scenario of scenarios) {
    for (const sourcePath of scenario.relatedSourceFiles) {
      if (!existsSync(new URL(`../../../${sourcePath}`, import.meta.url))) {
        missingPaths.push(sourcePath)
      }
    }
    for (const testCase of scenario.relatedExistingTests) {
      if (!existsSync(new URL(`../../../${testCase.path}`, import.meta.url))) {
        missingPaths.push(testCase.path)
      }
    }
  }
  if (missingPaths.length > 0) {
    throw new Error(`Scenario evidence paths do not exist: ${[...new Set(missingPaths)].join(", ")}`)
  }
}

export function resolveScenarioDefinitions({
  definitions = SCENARIO_GROUPS.flat(),
  requirements = CONSERVATIVE_REQUIREMENTS,
  criticalBehaviorContract,
} = {}) {
  const behaviorMap = new Map((criticalBehaviorContract.behaviors ?? []).map((behavior) => [behavior.id, behavior]))
  const scenarios = definitions.map((scenario) => resolveScenarioEvidence({
    scenario,
    behaviorMap,
  }))
  assertValidScenarioDefinitions({
    scenarios,
    requirements,
    criticalBehaviorContract,
  })
  return {
    scenarios,
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

export { PACKAGE_ROOT }
