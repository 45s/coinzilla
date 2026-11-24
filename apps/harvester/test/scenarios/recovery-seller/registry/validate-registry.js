import { RS_CONFIG_FIELD_IDS } from "./config-fields.js"
import { RS_DECISION_IDS } from "./decisions.js"
import { RS_DOMAIN_RULE_IDS } from "./domain-rules.js"
import { RS_INVARIANT_IDS } from "./invariants.js"
import { RS_CYCLE_STATE_IDS } from "./states.js"
import { RS_TRANSITION_IDS } from "./transitions.js"

const FAMILY_IDS = new Set([...Array(10).keys()].map((index) =>
  `RS-${String(index + 1).padStart(3, "0")}`))
const PRIORITIES = new Set(["P0", "P1", "P2"])
const LAYERS = new Set(["DOMAIN", "APPLICATION"])
const STATUSES = new Set([
  "SPECIFIED",
  "TEST-MAPPED",
  "VERIFIED",
  "PARTIAL",
  "MISSING",
  "BLOCKED",
  "UNSUPPORTED",
])
const CATALOGS = Object.freeze({
  configFields: new Set(RS_CONFIG_FIELD_IDS),
  rules: new Set(RS_DOMAIN_RULE_IDS),
  decisions: new Set(RS_DECISION_IDS),
  states: new Set(RS_CYCLE_STATE_IDS),
  transitions: new Set(RS_TRANSITION_IDS),
  invariants: new Set(RS_INVARIANT_IDS),
})

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function addError({ errors, path, message }) {
  errors.push(`${path}: ${message}`)
}

function validateStringArray({ value, path, errors, allowedValues }) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    addError({
      errors,
      path,
      message: "must be an array of non-empty strings",
    })
    return
  }

  if (!allowedValues) {
    return
  }
  for (const item of value) {
    if (!allowedValues.has(item)) {
      addError({
        errors,
        path,
        message: `contains unknown reference "${item}"`,
      })
    }
  }
}

function validateEvidence({ evidence, status, path, errors }) {
  if (status !== "VERIFIED") {
    if (evidence !== null && !isRecord(evidence)) {
      addError({
        errors,
        path,
        message: "must be null or an evidence object",
      })
    }
    return
  }

  if (!isRecord(evidence)) {
    addError({
      errors,
      path,
      message: "VERIFIED requires evidence",
    })
    return
  }

  const requiredEvidence = [
    ["exactHead", /^[a-f0-9]{40}$/i],
    ["mergeCommit", /^[a-f0-9]{40}$/i],
  ]
  for (const [field, pattern] of requiredEvidence) {
    if (!pattern.test(evidence[field] || "")) {
      addError({
        errors,
        path,
        message: `VERIFIED requires a valid ${field}`,
      })
    }
  }
  if (evidence.mergedToDevelop !== true) {
    addError({
      errors,
      path,
      message: "VERIFIED requires mergedToDevelop=true",
    })
  }
  for (const field of ["exactCommand", "ci"]) {
    if (typeof evidence[field] !== "string" || evidence[field].trim().length === 0) {
      addError({
        errors,
        path,
        message: `VERIFIED requires ${field}`,
      })
    }
  }
}

function validateRequiredFields({ scenario, path, errors }) {
  const requiredFields = [
    "id", "family", "name", "priority", "authority", "layer",
    "configFields", "covers", "given", "when", "then", "mustNot",
    "subcases", "implementation", "test", "status", "evidence",
  ]
  for (const field of requiredFields) {
    if (!Object.hasOwn(scenario, field)) {
      addError({
        errors,
        path,
        message: `is missing required field "${field}"`,
      })
    }
  }
}

function validateScenarioIdentity({ scenario, path, ids, errors }) {
  if (!/^RS-\d{3}-\d{3}$/.test(scenario.id || "")) {
    addError({
      errors,
      path: `${path}.id`,
      message: "must use stable RS-NNN-NNN format",
    })
  } else if (ids.has(scenario.id)) {
    addError({
      errors,
      path: `${path}.id`,
      message: `duplicates scenario ID "${scenario.id}"`,
    })
  } else {
    ids.add(scenario.id)
  }

  if (!FAMILY_IDS.has(scenario.family)) {
    addError({
      errors,
      path: `${path}.family`,
      message: "must be one of RS-001 through RS-010",
    })
  }
  if (typeof scenario.id === "string" && scenario.id.startsWith("RS-") &&
      scenario.id.slice(0, 6) !== scenario.family) {
    addError({
      errors,
      path: `${path}.family`,
      message: "must match the scenario ID family",
    })
  }
}

function validateScenarioMetadata({ scenario, path, errors }) {
  if (typeof scenario.name !== "string" || scenario.name.trim().length === 0) {
    addError({
      errors,
      path: `${path}.name`,
      message: "must be a non-empty business outcome",
    })
  }
  if (!PRIORITIES.has(scenario.priority)) {
    addError({
      errors,
      path: `${path}.priority`,
      message: "must be P0, P1 or P2",
    })
  }
  if (!LAYERS.has(scenario.layer)) {
    addError({
      errors,
      path: `${path}.layer`,
      message: "must be DOMAIN or APPLICATION",
    })
  }
  validateStringArray({
    value: scenario.authority,
    path: `${path}.authority`,
    errors,
  })
  if (Array.isArray(scenario.authority) && scenario.authority.length === 0) {
    addError({
      errors,
      path: `${path}.authority`,
      message: "must identify at least one authoritative contract",
    })
  }
  validateStringArray({
    value: scenario.configFields,
    path: `${path}.configFields`,
    errors,
    allowedValues: CATALOGS.configFields,
  })
}

function validateScenarioCovers({ covers, path, errors }) {
  if (!isRecord(covers)) {
    addError({
      errors,
      path,
      message: "must be an object",
    })
    return
  }

  const fields = [
    ["rules", CATALOGS.rules],
    ["decisions", CATALOGS.decisions],
    ["states", CATALOGS.states],
    ["transitions", CATALOGS.transitions],
    ["invariants", CATALOGS.invariants],
  ]
  for (const [field, catalog] of fields) {
    validateStringArray({
      value: covers[field],
      path: `${path}.${field}`,
      errors,
      allowedValues: catalog,
    })
  }
}

function validateScenarioSteps({ scenario, path, errors }) {
  if (!isRecord(scenario.given) || !Array.isArray(scenario.when) ||
      !isRecord(scenario.then)) {
    addError({
      errors,
      path,
      message: "given/then must be objects and when must be an ordered array",
    })
    return
  }

  if (scenario.when.length === 0) {
    addError({
      errors,
      path: `${path}.when`,
      message: "must contain at least one executable step",
    })
  }
  for (const [stepIndex, step] of scenario.when.entries()) {
    const stepPath = `${path}.when[${stepIndex}]`
    if (!isRecord(step) || typeof step.type !== "string" || step.type.trim().length === 0) {
      addError({
        errors,
        path: stepPath,
        message: "must be an ordered step with a non-empty type",
      })
      continue
    }
    if (step.inputKey !== undefined &&
        (typeof step.inputKey !== "string" || step.inputKey.trim().length === 0)) {
      addError({
        errors,
        path: `${stepPath}.inputKey`,
        message: "must be a non-empty Given-context key",
      })
    }
    if (step.saveAs !== undefined &&
        (typeof step.saveAs !== "string" || step.saveAs.trim().length === 0)) {
      addError({
        errors,
        path: `${stepPath}.saveAs`,
        message: "must be a non-empty output name",
      })
    }
  }
}

function validateTestMapping({ test, status, path, existingPaths, errors }) {
  if (["TEST-MAPPED", "VERIFIED"].includes(status) && test === null) {
    addError({
      errors,
      path,
      message: "TEST-MAPPED/VERIFIED requires an exact test file and title",
    })
    return
  }
  if (test === null) {
    return
  }
  if (!isRecord(test) ||
      typeof test.file !== "string" || test.file.trim().length === 0 ||
      typeof test.title !== "string" || test.title.trim().length === 0) {
    addError({
      errors,
      path,
      message: "must be null or contain non-empty file and title",
    })
    return
  }
  if (existingPaths && !existingPaths.has(test.file)) {
    addError({
      errors,
      path: `${path}.file`,
      message: `path does not exist: "${test.file}"`,
    })
  }
}

function validateSubcase({ subcase, scenarioIndex, subcaseIndex, scenario, existingPaths, errors }) {
  const path = `scenarios[${scenarioIndex}].subcases[${subcaseIndex}]`
  if (!isRecord(subcase)) {
    addError({
      errors,
      path,
      message: "each subcase must be an object",
    })
    return
  }

  const subcasePath = path
  const validId = /^RS-\d{3}-\d{3}-[A-Z]$/.test(subcase.id || "") &&
    subcase.id.startsWith(`${scenario.id}-`)
  if (!validId) {
    addError({
      errors,
      path: `${subcasePath}.id`,
      message: "must use the parent scenario ID plus a letter suffix",
    })
  }
  if (typeof subcase.description !== "string" || subcase.description.trim().length === 0) {
    addError({
      errors,
      path: `${subcasePath}.description`,
      message: "must be non-empty",
    })
  }
  if (!STATUSES.has(subcase.status)) {
    addError({
      errors,
      path: `${subcasePath}.status`,
      message: "is not a canonical scenario status",
    })
  }
  validateTestMapping({
    test: subcase.test,
    status: subcase.status,
    path: `${subcasePath}.test`,
    existingPaths,
    errors,
  })
  if (subcase.status === "BLOCKED") {
    validateBlocker({
      blocker: subcase.blocker,
      path: `${subcasePath}.blocker`,
      errors,
    })
  }
  if (subcase.status === "UNSUPPORTED") {
    validateUnsupportedReason({
      reason: subcase.unsupportedReason,
      path: `${subcasePath}.unsupportedReason`,
      errors,
    })
  }
  validateEvidence({
    evidence: subcase.evidence,
    status: subcase.status,
    path: `${subcasePath}.evidence`,
    errors,
  })
}

function validateBlocker({ blocker, path, errors }) {
  if (!isRecord(blocker) ||
      typeof blocker.reason !== "string" || blocker.reason.trim().length === 0 ||
      typeof blocker.unblockCondition !== "string" || blocker.unblockCondition.trim().length === 0) {
    addError({
      errors,
      path,
      message: "BLOCKED requires reason and unblockCondition",
    })
  }
}

function validateUnsupportedReason({ reason, path, errors }) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    addError({
      errors,
      path,
      message: "UNSUPPORTED requires a contract reason",
    })
  }
}

function validateSubcases({ scenario, index, existingPaths, errors }) {
  if (!Array.isArray(scenario.subcases)) {
    addError({
      errors,
      path: `scenarios[${index}].subcases`,
      message: "must be an array",
    })
    return
  }

  if (["TEST-MAPPED", "VERIFIED"].includes(scenario.status) && scenario.subcases.length === 0) {
    addError({
      errors,
      path: `scenarios[${index}].subcases`,
      message: "TEST-MAPPED/VERIFIED requires at least one registered subcase",
    })
  }

  const ids = new Set()
  for (const [subcaseIndex, subcase] of scenario.subcases.entries()) {
    validateSubcase({
      subcase,
      scenarioIndex: index,
      subcaseIndex,
      scenario,
      existingPaths,
      errors,
    })
    if (isRecord(subcase)) {
      if (ids.has(subcase.id)) {
        addError({
          errors,
          path: `scenarios[${index}].subcases[${subcaseIndex}].id`,
          message: `duplicates subcase ID "${subcase.id}"`,
        })
      }
      ids.add(subcase.id)
    }
  }
}

function validateScenarioPaths({ scenario, index, existingPaths, errors }) {
  const path = `scenarios[${index}]`
  validateStringArray({
    value: scenario.implementation,
    path: `${path}.implementation`,
    errors,
  })
  if (!Array.isArray(scenario.implementation) || scenario.implementation.length === 0) {
    addError({
      errors,
      path: `${path}.implementation`,
      message: "must identify at least one production implementation path",
    })
  }
  if (existingPaths && Array.isArray(scenario.implementation)) {
    for (const implementationPath of scenario.implementation) {
      if (!existingPaths.has(implementationPath)) {
        addError({
          errors,
          path: `${path}.implementation`,
          message: `path does not exist: "${implementationPath}"`,
        })
      }
    }
  }
  validateTestMapping({
    test: scenario.test,
    status: scenario.status,
    path: `${path}.test`,
    existingPaths,
    errors,
  })
}

function validateScenarioStatus({ scenario, index, errors }) {
  const path = `scenarios[${index}]`
  if (!STATUSES.has(scenario.status)) {
    addError({
      errors,
      path: `${path}.status`,
      message: "is not a canonical scenario status",
    })
  }
  if (scenario.status === "BLOCKED") {
    validateBlocker({
      blocker: scenario.blocker,
      path: `${path}.blocker`,
      errors,
    })
  }
  if (scenario.status === "UNSUPPORTED") {
    validateUnsupportedReason({
      reason: scenario.unsupportedReason,
      path: `${path}.unsupportedReason`,
      errors,
    })
  }
  if (scenario.status === "VERIFIED" && Array.isArray(scenario.subcases) &&
      scenario.subcases.some((subcase) => subcase?.status !== "VERIFIED")) {
    addError({
      errors,
      path: `${path}.subcases`,
      message: "VERIFIED requires every registered subcase to be VERIFIED",
    })
  }
  validateEvidence({
    evidence: scenario.evidence,
    status: scenario.status,
    path: `${path}.evidence`,
    errors,
  })
}

function validateScenario({ scenario, index, ids, existingPaths, errors }) {
  const path = `scenarios[${index}]`
  if (!isRecord(scenario)) {
    addError({
      errors,
      path,
      message: "must be an object",
    })
    return
  }

  validateRequiredFields({ scenario, path, errors })
  validateScenarioIdentity({ scenario, path, ids, errors })
  validateScenarioMetadata({ scenario, path, errors })
  validateScenarioCovers({
    covers: scenario.covers,
    path: `${path}.covers`,
    errors,
  })
  validateScenarioSteps({ scenario, path, errors })
  validateStringArray({
    value: scenario.mustNot,
    path: `${path}.mustNot`,
    errors,
  })
  validateSubcases({ scenario, index, existingPaths, errors })
  validateScenarioPaths({ scenario, index, existingPaths, errors })
  validateScenarioStatus({ scenario, index, errors })
}

/**
 * Validate scenario identity, schema, catalog references, path mappings and
 * evidence requirements without executing or promoting any scenario.
 *
 * @param {object} input Registry validation inputs.
 * @param {object[]} input.scenarios Scenario records.
 * @param {Set<string>} [input.existingPaths] Repository-relative paths known to exist.
 * @returns {{ valid: boolean, errors: string[] }} Deterministic validation result.
 */
export function validateRecoverySellerScenarioRegistry({ scenarios, existingPaths } = {}) {
  const errors = []
  if (!Array.isArray(scenarios)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(["scenarios: must be an array"]),
    })
  }

  const ids = new Set()
  for (const [index, scenario] of scenarios.entries()) {
    validateScenario({
      scenario,
      index,
      ids,
      existingPaths,
      errors,
    })
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  })
}
