import {
  CONSERVATIVE_SCENARIO_CATEGORIES,
  CONSERVATIVE_SCENARIO_PRIORITIES,
  CONSERVATIVE_SCENARIO_STATUSES,
} from "./catalogs.js"

const CATEGORY_SET = new Set(CONSERVATIVE_SCENARIO_CATEGORIES)
const PRIORITY_SET = new Set(CONSERVATIVE_SCENARIO_PRIORITIES)
const STATUS_SET = new Set(CONSERVATIVE_SCENARIO_STATUSES)

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`)
}

function isRepositoryRelativePath(value) {
  if (!isNonEmptyString(value) || value.includes("\\0") || value.startsWith("/") ||
      /^[A-Za-z]:/.test(value)) {
    return false
  }

  const segments = value.split(/[\\/]/)
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function validatePath({ value, path, existingPaths, errors }) {
  if (!isRepositoryRelativePath(value)) {
    addError(errors, path, "must be a safe repository-relative path and must not escape the package")
    return
  }

  if (existingPaths && !existingPaths.has(value)) {
    addError(errors, path, `path does not exist: "${value}"`)
  }
}

function validateStringArray({ value, path, errors }) {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    addError(errors, path, "must be an array of non-empty strings")
    return false
  }

  return true
}

function validateTestMappings({ scenario, index, existingPaths, errors }) {
  const path = `scenarios[${index}].relatedExistingTests`
  if (!Array.isArray(scenario.relatedExistingTests)) {
    addError(errors, path, "must be an array")
    return
  }

  const seen = new Set()
  for (const [testIndex, testCase] of scenario.relatedExistingTests.entries()) {
    const testPath = `${path}[${testIndex}]`
    if (!isRecord(testCase) || !isNonEmptyString(testCase.path) || !isNonEmptyString(testCase.name)) {
      addError(errors, testPath, "must contain non-empty path and name fields")
      continue
    }

    validatePath({
      value: testCase.path,
      path: `${testPath}.path`,
      existingPaths,
      errors,
    })
    const key = `${testCase.path}::${testCase.name}`
    if (seen.has(key)) {
      addError(errors, testPath, "duplicates a named test mapping in this scenario")
    }
    seen.add(key)
  }
}

function validateScenario({ scenario, index, ids, requirementIds, behaviorIds, existingPaths, errors }) {
  const path = `scenarios[${index}]`
  if (!isRecord(scenario)) {
    addError(errors, path, "must be an object")
    return
  }

  if (!/^CON-[A-Z]+-\d{3}$/.test(scenario.id ?? "")) {
    addError(errors, `${path}.id`, "must use a stable CON-* identifier")
  } else if (ids.has(scenario.id)) {
    addError(errors, `${path}.id`, `duplicates scenario ID "${scenario.id}"`)
  } else {
    ids.add(scenario.id)
  }

  for (const field of ["title", "description"]) {
    if (!isNonEmptyString(scenario[field])) {
      addError(errors, `${path}.${field}`, "must be a non-empty string")
    }
  }
  if (!CATEGORY_SET.has(scenario.category)) {
    addError(errors, `${path}.category`, "is not a supported Conservative category")
  }
  if (!PRIORITY_SET.has(scenario.priority)) {
    addError(errors, `${path}.priority`, "must be P0, P1, P2, or P3")
  }
  if (!STATUS_SET.has(scenario.coverageStatus)) {
    addError(errors, `${path}.coverageStatus`, "is not a supported evidence status")
  }

  for (const field of ["tags", "preconditions", "invariants", "relatedRequirements",
    "relatedCriticalBehaviors", "relatedSourceFiles"]) {
    validateStringArray({
      value: scenario[field],
      path: `${path}.${field}`,
      errors,
    })
  }
  if (!Array.isArray(scenario.inputEvents)) {
    addError(errors, `${path}.inputEvents`, "must be an array")
  }
  if (!isRecord(scenario.initialState)) {
    addError(errors, `${path}.initialState`, "must be an object")
  }

  if (Array.isArray(scenario.relatedRequirements)) {
    for (const requirementId of scenario.relatedRequirements) {
      if (!requirementIds.has(requirementId)) {
        addError(errors, `${path}.relatedRequirements`, `references unknown requirement "${requirementId}"`)
      }
    }
  }
  if (Array.isArray(scenario.relatedCriticalBehaviors)) {
    for (const behaviorId of scenario.relatedCriticalBehaviors) {
      if (!behaviorIds.has(behaviorId)) {
        addError(errors, `${path}.relatedCriticalBehaviors`, `references unknown critical behavior "${behaviorId}"`)
      }
    }
  }

  if (Array.isArray(scenario.relatedSourceFiles)) {
    for (const [sourceIndex, sourcePath] of scenario.relatedSourceFiles.entries()) {
      validatePath({
        value: sourcePath,
        path: `${path}.relatedSourceFiles[${sourceIndex}]`,
        existingPaths,
        errors,
      })
    }
  }

  validateTestMappings({ scenario, index, existingPaths, errors })

  if (scenario.coverageStatus !== "VERIFIED" && !isNonEmptyString(scenario.coverageReason)) {
    addError(errors, `${path}.coverageReason`, "is required until the scenario is VERIFIED")
  }
  if (scenario.coverageStatus === "TEST-MAPPED" &&
      (!Array.isArray(scenario.relatedExistingTests) || scenario.relatedExistingTests.length === 0)) {
    addError(errors, path, "TEST-MAPPED requires at least one named test mapping")
  }
  if (scenario.coverageStatus === "VERIFIED") {
    const verification = scenario.verification
    if (!isRecord(verification) || !/^[a-f0-9]{40}$/i.test(verification.commit ?? "") ||
        !isNonEmptyString(verification.command)) {
      addError(errors, `${path}.verification`, "VERIFIED requires an exact commit and test command")
    }
    if (!Array.isArray(scenario.relatedExistingTests) || scenario.relatedExistingTests.length === 0) {
      addError(errors, path, "VERIFIED requires named test evidence")
    }
  }
}

export function validateConservativeScenarioRegistry({
  scenarios,
  requirements = [],
  criticalBehaviorContract = { behaviors: [] },
  existingPaths,
} = {}) {
  const errors = []
  if (!Array.isArray(scenarios)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["scenarios: must be an array"]) })
  }
  if (!Array.isArray(requirements)) {
    addError(errors, "requirements", "must be an array")
  }
  const behaviors = criticalBehaviorContract?.behaviors
  if (!Array.isArray(behaviors)) {
    addError(errors, "criticalBehaviorContract.behaviors", "must be an array")
  }
  if (existingPaths !== undefined && !(existingPaths instanceof Set)) {
    addError(errors, "existingPaths", "must be a Set of repository-relative paths")
  }

  const requirementIds = new Set(Array.isArray(requirements)
    ? requirements.filter((item) => isRecord(item) && isNonEmptyString(item.id)).map((item) => item.id)
    : [])
  const behaviorIds = new Set(Array.isArray(behaviors)
    ? behaviors.filter((item) => isRecord(item) && isNonEmptyString(item.id)).map((item) => item.id)
    : [])
  const ids = new Set()

  for (const [index, scenario] of scenarios.entries()) {
    validateScenario({
      scenario,
      index,
      ids,
      requirementIds,
      behaviorIds,
      existingPaths: existingPaths instanceof Set ? existingPaths : undefined,
      errors,
    })
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  })
}
