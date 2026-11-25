import test from "node:test"
import assert from "node:assert/strict"
import {
  CONSERVATIVE_SCENARIO_CATEGORIES,
  conservativeScenarioRegistry,
  defineConservativeScenario,
  validateConservativeScenarioRegistry,
} from "./registry/index.js"

const mappedTest = {
  path: "src/domain/strategies/conservative/strategy.test.js",
  name: "creates the initial BUY below last traded price and rounds down to tick",
}

function createScenario(overrides = {}) {
  return {
    id: "CON-TEST-001",
    title: "A mapped Conservative scenario",
    category: "buy-lifecycle",
    priority: "P0",
    description: "A deterministic registry fixture.",
    tags: ["buy"],
    preconditions: ["A valid market and configuration exist."],
    initialState: { position: { quantity: "0" } },
    inputEvents: [{ type: "BUY_FILL", sequence: 1 }],
    expectedState: { position: { quantity: "1" } },
    expectedOrders: [],
    expectedAccounting: { spent: "10" },
    expectedSideEffects: {},
    invariants: ["A canonical fill is accounted for once."],
    relatedRequirements: ["CON-SPEC-3.1"],
    relatedCriticalBehaviors: ["STRATEGY_BUY_SELL_SAFETY_GATES"],
    relatedSourceFiles: ["src/domain/strategies/conservative/strategy.js"],
    relatedExistingTests: [mappedTest],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "A named test is mapped; assertion review remains pending.",
    ...overrides,
  }
}

test("defines deeply immutable Conservative scenario records", () => {
  const scenario = defineConservativeScenario(createScenario())

  assert.ok(Object.isFrozen(scenario), "The scenario record itself must be immutable.")
  assert.ok(Object.isFrozen(scenario.initialState), "Nested state fixtures must also be immutable.")
  assert.ok(Object.isFrozen(scenario.initialState.position), "Deeply nested state values must be immutable.")
  assert.ok(Object.isFrozen(scenario.inputEvents), "Input event collections must be immutable.")
  assert.throws(
    () => { scenario.initialState.position.quantity = "2" },
    TypeError,
    "A caller must not mutate a nested scenario input after registration.",
  )
})

test("registers all Conservative categories with stable unique immutable records", () => {
  const categories = new Set(conservativeScenarioRegistry.map(({ category }) => category))
  const ids = conservativeScenarioRegistry.map(({ id }) => id)

  assert.equal(categories.size, CONSERVATIVE_SCENARIO_CATEGORIES.length,
    "The registry must represent every declared Conservative behavior category.")
  assert.equal(new Set(ids).size, ids.length,
    "Every registered Conservative scenario must have a unique stable ID.")
  assert.ok(conservativeScenarioRegistry.every(Object.isFrozen),
    "Every registry record must be immutable before consumers receive it.")
})

test("validates duplicate IDs, catalog references, and repository-relative evidence paths", () => {
  const validScenario = createScenario()
  const validInputs = {
    scenarios: [validScenario],
    requirements: [{ id: "CON-SPEC-3.1", title: "Initial BUY" }],
    criticalBehaviorContract: {
      behaviors: [{ id: "STRATEGY_BUY_SELL_SAFETY_GATES" }],
    },
    existingPaths: new Set([
      "src/domain/strategies/conservative/strategy.js",
      mappedTest.path,
    ]),
  }

  const valid = validateConservativeScenarioRegistry(validInputs)
  assert.equal(valid.valid, true,
    "A complete scenario with known requirements, critical behaviors, and existing paths must validate.")
  assert.deepEqual(valid.errors, [],
    "A valid registry must not report schema or traceability errors.")

  const invalid = validateConservativeScenarioRegistry({
    ...validInputs,
    scenarios: [
      validScenario,
      createScenario({
        relatedRequirements: ["CON-SPEC-UNKNOWN"],
        relatedSourceFiles: ["../outside-repository.js"],
      }),
    ],
  })

  assert.equal(invalid.valid, false,
    "Duplicate IDs, unknown requirement references, and paths escaping the package must fail validation.")
  assert.ok(invalid.errors.some((error) => /duplicate/i.test(error)),
    "Duplicate scenario IDs must be reported explicitly.")
  assert.ok(invalid.errors.some((error) => /unknown requirement/i.test(error)),
    "Unknown specification references must be reported explicitly.")
  assert.ok(invalid.errors.some((error) => /repository-relative|escapes/i.test(error)),
    "Evidence paths must not escape the owning package.")
})

test("rejects malformed registry containers without throwing incidental TypeErrors", () => {
  const result = validateConservativeScenarioRegistry({
    scenarios: [null, { id: "CON-BROKEN-001", relatedRequirements: {} }],
    requirements: null,
    criticalBehaviorContract: { behaviors: null },
  })

  assert.equal(result.valid, false,
    "Malformed registry inputs must return validation errors rather than crash the loader.")
  assert.ok(result.errors.length > 0,
    "Malformed registry inputs must provide actionable validation diagnostics.")
})
