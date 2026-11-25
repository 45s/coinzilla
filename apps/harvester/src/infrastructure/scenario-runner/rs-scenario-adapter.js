import { isDeepStrictEqual } from "node:util"
import { compareDecimal } from "@coinzilla/utils"
import { calculateRecoverySellerProfitability } from "../../domain/strategies/recovery-seller/calculate-profitability.js"

const DECIMAL_STRING_SCHEMA = Object.freeze({
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
  description: "Non-negative decimal represented as a string; minProfit is absolute quote-asset profit.",
})

const SCENARIO = Object.freeze({
  id: "RS-004-011",
  name: "Independent recovery, legacy and combined profitability gates all pass",
  layer: "DOMAIN",
  status: "PRELIMINARY",
  executionStatus: "PRELIMINARY",
  executable: false,
  readinessReasons: Object.freeze([
    "The source scenario registry and mapped test remain in unmerged PR #1823; this entry is a provisional projection, not an authoritative registry record.",
    "This mapping invokes only the pure calculateRecoverySellerProfitability helper; it does not execute the full Recovery Seller strategy lifecycle.",
    "No production OS-level sandbox launcher attestation is available, so the host must keep RS execution blocked.",
  ]),
  inputSchema: Object.freeze({
    type: "object",
    required: [
      "recoveryCostBasis",
      "recoveryNetQuoteProceeds",
      "minProfit",
      "legacyAverageCost",
      "legacyBaseDebit",
      "legacyNetQuoteProceeds",
    ],
    additionalProperties: false,
    properties: Object.freeze({
      recoveryCostBasis: DECIMAL_STRING_SCHEMA,
      recoveryNetQuoteProceeds: DECIMAL_STRING_SCHEMA,
      minProfit: DECIMAL_STRING_SCHEMA,
      legacyAverageCost: DECIMAL_STRING_SCHEMA,
      legacyBaseDebit: DECIMAL_STRING_SCHEMA,
      legacyNetQuoteProceeds: DECIMAL_STRING_SCHEMA,
    }),
  }),
  input: Object.freeze({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds: "10.01",
    minProfit: "0.01",
    legacyAverageCost: "2",
    legacyBaseDebit: "0.1",
    legacyNetQuoteProceeds: "0.2",
  }),
  expected: Object.freeze({
    recovery: Object.freeze({
      costBasis: "10",
      netQuoteProceeds: "10.01",
      netProfit: "0.01",
      minProfit: "0.01",
      eligible: true,
    }),
    legacy: Object.freeze({
      applicable: true,
      averageCost: "2",
      baseDebit: "0.1",
      costBasis: "0.2",
      netQuoteProceeds: "0.2",
      netProfit: "0",
      eligible: true,
    }),
    cycle: Object.freeze({
      costBasis: "10.2",
      netQuoteProceeds: "10.21",
      netProfit: "0.01",
      minProfit: "0.01",
      eligible: true,
    }),
    eligible: true,
  }),
})


function validateScenarioObject({ overrides }) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("Scenario input overrides must be a JSON object")
  }
}

function validateScenarioAdditionalProperties({ schema, overrides }) {
  if (schema.additionalProperties !== false) {
    return
  }
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(schema.properties, key)) {
      throw new TypeError(`Unknown scenario input field: ${key}`)
    }
  }
}

function validateScenarioRequiredFields({ schema, effectiveInput }) {
  for (const key of schema.required) {
    if (!Object.hasOwn(effectiveInput, key)) {
      throw new TypeError(`Required scenario input field is missing: ${key}`)
    }
  }
}

function validateScenarioField({ key, fieldSchema, value }) {
  if (typeof value !== fieldSchema.type) {
    throw new TypeError(`Scenario input field ${key} must be a ${fieldSchema.type}`)
  }
  if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
    throw new TypeError(`Scenario input field ${key} must match its decimal-string schema`)
  }
  if (fieldSchema.exclusiveMinimum !== undefined && compareDecimal({
    left: value,
    right: fieldSchema.exclusiveMinimum,
  }) <= 0) {
    throw new RangeError(`Scenario input field ${key} must be greater than ${fieldSchema.exclusiveMinimum}`)
  }
}

export function validateScenarioInput({ schema, defaults, input }) {
  const overrides = input ?? {}
  validateScenarioObject({ overrides })
  validateScenarioAdditionalProperties({
    schema,
    overrides,
  })
  const effectiveInput = {
    ...defaults,
    ...overrides,
  }
  validateScenarioRequiredFields({
    schema,
    effectiveInput,
  })
  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    validateScenarioField({
      key,
      fieldSchema,
      value: effectiveInput[key],
    })
  }
  return Object.freeze(effectiveInput)
}

function createAssertion({ name, actual, expected }) {
  return Object.freeze({
    name,
    passed: isDeepStrictEqual(actual, expected),
    actual,
    expected,
  })
}



export function getRecoverySellerRunnerCatalog() {
  return Object.freeze([SCENARIO])
}

function assertScenarioNotAborted({ signal }) {
  if (signal?.aborted) {
    throw new Error("Scenario worker was cancelled")
  }
}

async function executeRecoverySellerProfitabilityScenario({ runId, input, signal }) {
  assertScenarioNotAborted({ signal })
  const effectiveInput = validateScenarioInput({
    schema: SCENARIO.inputSchema,
    defaults: SCENARIO.input,
    input,
  })
  const actual = calculateRecoverySellerProfitability(effectiveInput)
  assertScenarioNotAborted({ signal })
  const assertions = Object.freeze([
    createAssertion({
      name: "independent profitability gates match expected outcome",
      actual,
      expected: SCENARIO.expected,
    }),
  ])
  const trace = Object.freeze([
    Object.freeze({
      id: "input-1",
      kind: "input",
      label: "Scenario profitability inputs",
      inputs: effectiveInput,
    }),
    Object.freeze({
      id: "decision-1",
      kind: "production-domain-function",
      label: "Recovery Seller profitability calculation",
      source: "calculateRecoverySellerProfitability",
      inputs: effectiveInput,
      outputs: actual,
    }),
    Object.freeze({
      id: "assertion-1",
      kind: "assertion",
      label: assertions[0].name,
      outputs: assertions[0],
    }),
  ])
  return Object.freeze({
    runId,
    strategyId: "RS",
    scenarioId: SCENARIO.id,
    scenarioName: SCENARIO.name,
    input: effectiveInput,
    output: actual,
    expected: SCENARIO.expected,
    assertions,
    passed: assertions.every((assertion) => assertion.passed),
    trace,
    diagnostics: Object.freeze([]),
    source: "production-domain-function",
  })
}

export async function executeRecoverySellerRunnerScenario({
  runId,
  scenarioId,
  input,
  signal,
} = {}) {
  assertScenarioNotAborted({ signal })
  if (scenarioId === SCENARIO.id) {
    return executeRecoverySellerProfitabilityScenario({
      runId,
      input,
      signal,
    })
  }
  throw new Error(`RS scenario "${scenarioId}" is not supported by the current isolated adapter.`)
}
