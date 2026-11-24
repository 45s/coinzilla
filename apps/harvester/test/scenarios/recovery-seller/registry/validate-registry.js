import { RS_CONFIG_FIELD_IDS } from "./config-fields.js"
import { RS_DECISION_IDS } from "./decisions.js"
import { RS_DOMAIN_RULE_IDS } from "./domain-rules.js"
import { RS_INVARIANT_IDS } from "./invariants.js"
import { RS_CYCLE_STATE_IDS } from "./states.js"
import { RS_TRANSITION_IDS } from "./transitions.js"

const FAMILY_IDS = new Set(Array.from({ length: 10 }, (_, index) =>
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

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`)
}

function validateStringArray({ value, path, errors, allowedValues }) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    addError(errors, path, "must be an array of non-empty strings")
    return
  }

  if (allowedValues) {
    for (const item of value) {
      if (!allowedValues.has(item)) {
        addError(errors, path, `contains unknown reference "${item}"`)
      }
    }
  }
}

function validateEvidence({ evidence, status, path, errors }) {
  if (status === "VERIFIED") {
    if (!isRecord(evidence)) {
      addError(errors, path, "VERIFIED requires evidence")
      return
    }
    if (!/^[a-f0-9]{40}$/i.test(evidence.exactHead || "")) {
      addError(errors, path, "VERIFIED requires a 40-character exactHead")
    }
    if (evidence.mergedToDevelop !== true) {
      addError(errors, path, "VERIFIED requires mergedToDevelop=true")
    }
    if (!/^[a-f0-9]{40}$/i.test(evidence.mergeCommit || "")) {
      addError(errors, path, "VERIFIED requires a 40-character mergeCommit")
    }
    if (typeof evidence.exactCommand !== "string" || evidence.exactCommand.trim().length === 0) {
      addError(errors, path, "VERIFIED requires exactCommand")
    }
    if (typeof evidence.ci !== "string" || evidence.ci.trim().length === 0) {
      addError(errors, path, "VERIFIED requires exact CI evidence")
    }
    return
  }

  if (evidence !== null && !isRecord(evidence)) {
    addError(errors, path, "must be null or an evidence object")
  }
}

function validateScenario({ scenario, index, ids, existingPaths, errors }) {
  const path = `scenarios[${index}]`
  if (!isRecord(scenario)) {
    addError(errors, path, "must be an object")
    return
  }

  const requiredFields = [
    "id", "family", "name", "priority", "authority", "layer",
    "configFields", "covers", "given", "when", "then", "mustNot",
    "subcases", "implementation", "test", "status", "evidence",
  ]
  for (const field of requiredFields) {
    if (!Object.hasOwn(scenario, field)) {
      addError(errors, path, `is missing required field "${field}"`)
    }
  }

  if (!/^RS-\d{3}-\d{3}$/.test(scenario.id || "")) {
    addError(errors, `${path}.id`, "must use stable RS-NNN-NNN format")
  } else if (ids.has(scenario.id)) {
    addError(errors, `${path}.id`, `duplicates scenario ID "${scenario.id}"`)
  } else {
    ids.add(scenario.id)
  }

  if (!FAMILY_IDS.has(scenario.family)) {
    addError(errors, `${path}.family`, "must be one of RS-001 through RS-010")
  }
  if (typeof scenario.id === "string" && scenario.id.startsWith("RS-") &&
      scenario.id.slice(0, 6) !== scenario.family) {
    addError(errors, `${path}.family`, "must match the scenario ID family")
  }
  if (typeof scenario.name !== "string" || scenario.name.trim().length === 0) {
    addError(errors, `${path}.name`, "must be a non-empty business outcome")
  }
  if (!PRIORITIES.has(scenario.priority)) {
    addError(errors, `${path}.priority`, "must be P0, P1 or P2")
  }
  if (!LAYERS.has(scenario.layer)) {
    addError(errors, `${path}.layer`, "must be DOMAIN or APPLICATION")
  }
  validateStringArray({ value: scenario.authority, path: `${path}.authority`, errors })
  validateStringArray({
    value: scenario.configFields,
    path: `${path}.configFields`,
    errors,
    allowedValues: CATALOGS.configFields,
  })

  if (!isRecord(scenario.covers)) {
    addError(errors, `${path}.covers`, "must be an object")
  } else {
    for (const [field, catalog] of [
      ["rules", CATALOGS.rules],
      ["decisions", CATALOGS.decisions],
      ["states", CATALOGS.states],
      ["transitions", CATALOGS.transitions],
      ["invariants", CATALOGS.invariants],
    ]) {
      validateStringArray({
        value: scenario.covers[field],
        path: `${path}.covers.${field}`,
        errors,
        allowedValues: catalog,
      })
    }
  }

  if (!isRecord(scenario.given) || !Array.isArray(scenario.when) ||
      !isRecord(scenario.then)) {
    addError(errors, path, "given/then must be objects and when must be an ordered array")
  }
  if (!Array.isArray(scenario.mustNot) ||
      scenario.mustNot.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    addError(errors, `${path}.mustNot`, "must be an array of non-empty forbidden-behavior statements")
  }

  if (!Array.isArray(scenario.subcases)) {
    addError(errors, `${path}.subcases`, "must be an array")
  } else {
    const subcaseIds = new Set()
    for (const [subcaseIndex, subcase] of scenario.subcases.entries()) {
      const subcasePath = `${path}.subcases[${subcaseIndex}]`
      if (!isRecord(subcase)) {
        addError(errors, subcasePath, "must be an object")
        continue
      }
      if (!/^RS-\d{3}-\d{3}-[A-Z]$/.test(subcase.id || "") ||
          !subcase.id.startsWith(`${scenario.id}-`)) {
        addError(errors, `${subcasePath}.id`, "must use the parent scenario ID plus a letter suffix")
      }
      if (subcaseIds.has(subcase.id)) {
        addError(errors, `${subcasePath}.id`, `duplicates subcase ID "${subcase.id}"`)
      }
      subcaseIds.add(subcase.id)
      if (typeof subcase.description !== "string" || subcase.description.trim().length === 0) {
        addError(errors, `${subcasePath}.description`, "must be non-empty")
      }
      if (!STATUSES.has(subcase.status)) {
        addError(errors, `${subcasePath}.status`, "is not a canonical scenario status")
      }
      if (subcase.test !== null && (!isRecord(subcase.test) ||
          typeof subcase.test.file !== "string" || typeof subcase.test.title !== "string")) {
        addError(errors, `${subcasePath}.test`, "must be null or contain file and title")
      }
      if (subcase.status === "BLOCKED" &&
          (!isRecord(subcase.blocker) ||
           typeof subcase.blocker.reason !== "string" ||
           typeof subcase.blocker.unblockCondition !== "string")) {
        addError(errors, `${subcasePath}.blocker`, "BLOCKED requires reason and unblockCondition")
      }
      if (subcase.status === "UNSUPPORTED" &&
          (typeof subcase.unsupportedReason !== "string" || subcase.unsupportedReason.trim().length === 0)) {
        addError(errors, `${subcasePath}.unsupportedReason`, "UNSUPPORTED requires a contract reason")
      }
      validateEvidence({
        evidence: subcase.evidence,
        status: subcase.status,
        path: `${subcasePath}.evidence`,
        errors,
      })
    }
  }

  validateStringArray({
    value: scenario.implementation,
    path: `${path}.implementation`,
    errors,
  })
  if (existingPaths) {
    for (const implementationPath of scenario.implementation || []) {
      if (!existingPaths.has(implementationPath)) {
        addError(errors, `${path}.implementation`, `path does not exist: "${implementationPath}"`)
      }
    }
  }

  if (scenario.test !== null) {
    if (!isRecord(scenario.test) ||
        typeof scenario.test.file !== "string" ||
        typeof scenario.test.title !== "string") {
      addError(errors, `${path}.test`, "must be null or contain file and title")
    } else if (existingPaths && !existingPaths.has(scenario.test.file)) {
      addError(errors, `${path}.test.file`, `path does not exist: "${scenario.test.file}"`)
    }
  }

  if (!STATUSES.has(scenario.status)) {
    addError(errors, `${path}.status`, "is not a canonical scenario status")
  }
  if (scenario.status === "BLOCKED" &&
      (!isRecord(scenario.blocker) ||
       typeof scenario.blocker.reason !== "string" ||
       typeof scenario.blocker.unblockCondition !== "string")) {
    addError(errors, `${path}.blocker`, "BLOCKED requires reason and unblockCondition")
  }
  if (scenario.status === "UNSUPPORTED" &&
      (typeof scenario.unsupportedReason !== "string" || scenario.unsupportedReason.trim().length === 0)) {
    addError(errors, `${path}.unsupportedReason`, "UNSUPPORTED requires a contract reason")
  }
  validateEvidence({
    evidence: scenario.evidence,
    status: scenario.status,
    path: `${path}.evidence`,
    errors,
  })
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
  scenarios.forEach((scenario, index) => {
    validateScenario({
      scenario,
      index,
      ids,
      existingPaths,
      errors,
    })
  })

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  })
}
