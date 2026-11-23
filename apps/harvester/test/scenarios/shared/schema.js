export const SCENARIO_CATEGORIES = Object.freeze([
  "strategy-decisions",
  "buy-lifecycle",
  "sell-lifecycle",
  "recovery-lifecycle",
  "partial-fills",
  "accounting-pnl",
  "fees-commission-assets",
  "balance-inventory",
  "precision-exchange-filters",
  "market-conditions",
  "exchange-failures",
  "event-reliability",
  "persistence-restart-recovery",
  "configuration",
  "safety-risk-controls",
  "runtime-coordinator-integration",
])

export const SCENARIO_PRIORITIES = Object.freeze(["P0", "P1", "P2", "P3"])

export const COVERAGE_STATUSES = Object.freeze([
  "VERIFIED",
  "PARTIAL",
  "MISSING",
  "BLOCKED",
  "SPECIFIED",
  "TEST-MAPPED",
  "UNSUPPORTED",
])

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== ""
}

function validateScenario({ scenario, index, requirementIds, behaviorIds }) {
  const errors = []
  const prefix = `scenarios[${index}]`

  if (!isRecord(scenario)) {
    return [`${prefix} must be an object.`]
  }

  if (!/^CON-[A-Z]+-\d{3}$/.test(scenario.id ?? "")) {
    errors.push(`${prefix}.id must use a stable CON-* identifier.`)
  }
  if (!isNonEmptyString(scenario.title)) {
    errors.push(`${prefix}.title must be a non-empty string.`)
  }
  if (!SCENARIO_CATEGORIES.includes(scenario.category)) {
    errors.push(`${prefix}.category is not a supported Conservative category.`)
  }
  if (!SCENARIO_PRIORITIES.includes(scenario.priority)) {
    errors.push(`${prefix}.priority must be P0, P1, P2, or P3.`)
  }
  if (!isNonEmptyString(scenario.description)) {
    errors.push(`${prefix}.description must be a non-empty string.`)
  }
  if (!COVERAGE_STATUSES.includes(scenario.coverageStatus)) {
    errors.push(`${prefix}.coverageStatus is not a supported evidence status.`)
  }

  const arrayFields = [
    "tags",
    "preconditions",
    "inputEvents",
    "invariants",
    "relatedRequirements",
    "relatedCriticalBehaviors",
    "relatedSourceFiles",
    "relatedExistingTests",
  ]
  for (const field of arrayFields) {
    if (!Array.isArray(scenario[field])) {
      errors.push(`${prefix}.${field} must be an array.`)
    }
  }

  if (!isRecord(scenario.initialState)) {
    errors.push(`${prefix}.initialState must be an object.`)
  }

  for (const requirementId of scenario.relatedRequirements ?? []) {
    if (!requirementIds.has(requirementId)) {
      errors.push(`${prefix} references unknown requirement ${requirementId}.`)
    }
  }
  for (const behaviorId of scenario.relatedCriticalBehaviors ?? []) {
    if (!behaviorIds.has(behaviorId)) {
      errors.push(`${prefix} references unknown critical behavior ${behaviorId}.`)
    }
  }
  for (const sourcePath of scenario.relatedSourceFiles ?? []) {
    if (!isNonEmptyString(sourcePath)) {
      errors.push(`${prefix}.relatedSourceFiles contains an invalid path.`)
    }
  }
  for (const testCase of scenario.relatedExistingTests ?? []) {
    if (!isRecord(testCase) || !isNonEmptyString(testCase.path) || !isNonEmptyString(testCase.name)) {
      errors.push(`${prefix}.relatedExistingTests contains an invalid named test mapping.`)
    }
  }

  if (scenario.coverageStatus !== "VERIFIED" && !isNonEmptyString(scenario.coverageReason)) {
    errors.push(`${prefix}.coverageReason is required until the scenario is VERIFIED.`)
  }
  if (scenario.coverageStatus === "TEST-MAPPED" && (scenario.relatedExistingTests ?? []).length === 0) {
    errors.push(`${prefix} is TEST-MAPPED but has no named test evidence.`)
  }
  if (scenario.coverageStatus === "VERIFIED") {
    const verification = scenario.verification
    if (!isRecord(verification) || !/^[a-f0-9]{40}$/i.test(verification.commit ?? "") ||
      !isNonEmptyString(verification.command)) {
      errors.push(`${prefix} is VERIFIED without an exact commit and test command.`)
    }
    if ((scenario.relatedExistingTests ?? []).length === 0) {
      errors.push(`${prefix} is VERIFIED without named test evidence.`)
    }
  }

  return errors
}

export function validateScenarioDefinitions({
  scenarios = [],
  requirements = [],
  criticalBehaviorContract = { behaviors: [] },
} = {}) {
  const errors = []
  const requirementIds = new Set(requirements.map(({ id }) => id))
  const behaviorIds = new Set((criticalBehaviorContract.behaviors ?? []).map(({ id }) => id))
  const seenIds = new Set()

  if (!Array.isArray(scenarios)) {
    return { errors: ["scenarios must be an array."] }
  }

  scenarios.forEach((scenario, index) => {
    errors.push(...validateScenario({
      scenario,
      index,
      requirementIds,
      behaviorIds,
    }))
    if (isRecord(scenario) && isNonEmptyString(scenario.id)) {
      if (seenIds.has(scenario.id)) {
        errors.push(`duplicate scenario ID ${scenario.id}.`)
      }
      seenIds.add(scenario.id)
    }
  })

  return { errors }
}

export function assertValidScenarioDefinitions(options = {}) {
  const result = validateScenarioDefinitions(options)
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("\n"))
  }
  return result
}
