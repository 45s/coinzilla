import { isDeepStrictEqual } from "node:util"
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
  status: "TEST-MAPPED",
  executionStatus: "PRELIMINARY",
  executable: false,
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

function validateScenarioInput({ schema, defaults, input }) {
  const overrides = input ?? {}
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("Scenario input overrides must be a JSON object")
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(overrides)) {
      if (!Object.hasOwn(schema.properties, key)) {
        throw new TypeError(`Unknown scenario input field: ${key}`)
      }
    }
  }
  const effectiveInput = {
    ...defaults,
    ...overrides,
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(effectiveInput, key)) {
      throw new TypeError(`Required scenario input field is missing: ${key}`)
    }
  }
  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const value = effectiveInput[key]
    if (typeof value !== fieldSchema.type) {
      throw new TypeError(`Scenario input field ${key} must be a ${fieldSchema.type}`)
    }
    if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
      throw new TypeError(`Scenario input field ${key} must match its decimal-string schema`)
    }
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

export async function executeRecoverySellerRunnerScenario({
  runId,
  scenarioId,
  input,
} = {}) {
  if (scenarioId !== SCENARIO.id) {
    throw new Error(`RS scenario "${scenarioId}" is not supported by the current isolated adapter.`)
  }
  const effectiveInput = validateScenarioInput({
    schema: SCENARIO.inputSchema,
    defaults: SCENARIO.input,
    input,
  })

  const actual = calculateRecoverySellerProfitability(effectiveInput)
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
    scenarioId,
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
