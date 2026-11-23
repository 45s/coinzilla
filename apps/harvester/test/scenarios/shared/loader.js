import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { scenarios as decisionScenarios } from "../conservative/decisions/index.js"
import { scenarios as buyScenarios } from "../conservative/buy/index.js"
import { scenarios as sellScenarios } from "../conservative/sell/index.js"
import { scenarios as recoveryScenarios } from "../conservative/recovery/index.js"
import { scenarios as partialFillScenarios } from "../conservative/partial-fills/index.js"
import { scenarios as accountingScenarios } from "../conservative/accounting/index.js"
import { scenarios as feeScenarios } from "../conservative/fees/index.js"
import { scenarios as balanceScenarios } from "../conservative/balances/index.js"
import { scenarios as filterScenarios } from "../conservative/filters/index.js"
import { scenarios as marketScenarios } from "../conservative/market/index.js"
import { scenarios as errorScenarios } from "../conservative/errors/index.js"
import { scenarios as eventScenarios } from "../conservative/events/index.js"
import { scenarios as persistenceScenarios } from "../conservative/persistence/index.js"
import { scenarios as configurationScenarios } from "../conservative/configuration/index.js"
import { scenarios as safetyScenarios } from "../conservative/safety/index.js"
import { scenarios as runtimeScenarios } from "../conservative/runtime/index.js"
import { ADDITIONAL_TEST_MAPPINGS } from "./additional-test-mappings.js"
import { CONSERVATIVE_REQUIREMENTS } from "./requirements.js"
import { assertValidScenarioDefinitions } from "./schema.js"

export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const CRITICAL_BEHAVIOR_PATH = resolve(PACKAGE_ROOT, "docs/critical-behaviors.json")

const SCENARIO_GROUPS = [
  decisionScenarios,
  buyScenarios,
  sellScenarios,
  recoveryScenarios,
  partialFillScenarios,
  accountingScenarios,
  feeScenarios,
  balanceScenarios,
  filterScenarios,
  marketScenarios,
  errorScenarios,
  eventScenarios,
  persistenceScenarios,
  configurationScenarios,
  safetyScenarios,
  runtimeScenarios,
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
  const relatedBehaviors = scenario.relatedCriticalBehaviors.map((id) => {
    const behavior = behaviorMap.get(id)
    if (!behavior) {
      throw new Error(`Scenario ${scenario.id} references unknown critical behavior ${id}.`)
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
      if (!existsSync(resolve(PACKAGE_ROOT, sourcePath))) {
        missingPaths.push(sourcePath)
      }
    }
    for (const testCase of scenario.relatedExistingTests) {
      if (!existsSync(resolve(PACKAGE_ROOT, testCase.path))) {
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
  criticalBehaviorContract = { behaviors: [] },
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
