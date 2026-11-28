import assert from "node:assert/strict"
import test from "node:test"
import { getCgConservativeScenarioRegistration } from "./cg-conservative-scenario-catalog.js"
import { conservativeScenarioRegistry } from "../../../test/scenarios/conservative/registry/index.js"

const INSPECTED_SCENARIO_FIELDS = [
  "id",
  "title",
  "category",
  "priority",
  "description",
  "tags",
  "preconditions",
  "initialState",
  "inputEvents",
  "expectedState",
  "expectedOrders",
  "expectedAccounting",
  "expectedSideEffects",
  "invariants",
  "relatedRequirements",
  "relatedCriticalBehaviors",
  "relatedSourceFiles",
  "relatedExistingTests",
  "coverageStatus",
  "coverageReason",
]

test("publishes every existing Conservative domain scenario under the CG-conservative strategy ID", () => {
  const registration = getCgConservativeScenarioRegistration()

  assert.equal(registration.strategyId, "CG-conservative",
    "The public Conservative scenario strategy ID must be CG-conservative, reserving GC for the future aggressive strategy.")
  assert.equal(registration.strategyName, "Conservative",
    "The Dashboard catalogue must display the Conservative strategy name.")
  assert.equal(registration.scenarios.length, 18,
    "All eighteen currently registered Conservative domain scenarios must be exposed for inspection.")
  assert.deepEqual(
    registration.scenarios.map((scenario) => scenario.id).sort(),
    conservativeScenarioRegistry.map((scenario) => scenario.id).sort(),
    "The public Dashboard catalogue must not omit, duplicate, rename or invent a Conservative scenario ID.",
  )

  for (const sourceScenario of conservativeScenarioRegistry) {
    const publicScenario = registration.scenarios.find((scenario) => scenario.id === sourceScenario.id)
    assert.ok(publicScenario,
      `Conservative scenario ${sourceScenario.id} must be present in the public runner catalogue.`)
    assert.equal(publicScenario.name, sourceScenario.title,
      `Conservative scenario ${sourceScenario.id} must keep its source registry title.`)
    assert.equal(publicScenario.status, sourceScenario.coverageStatus,
      `Conservative scenario ${sourceScenario.id} must retain its real domain coverage status.`)
    assert.equal(publicScenario.executable, false,
      `Conservative scenario ${sourceScenario.id} must remain non-executable until a production-flow simulation adapter exists.`)
    assert.equal(publicScenario.executionStatus, "BLOCKED",
      `Conservative scenario ${sourceScenario.id} must not confuse a mapped test with an isolated Dashboard run.`)
    assert.ok(publicScenario.readinessReasons.length > 0,
      `Conservative scenario ${sourceScenario.id} must explain why Dashboard execution is unavailable.`)

    const expectedDetails = Object.fromEntries(INSPECTED_SCENARIO_FIELDS
      .filter((field) => Object.hasOwn(sourceScenario, field))
      .map((field) => [field, sourceScenario[field]]))
    assert.deepEqual(publicScenario.details, expectedDetails,
      `Conservative scenario ${sourceScenario.id} must preserve its declared domain inputs, expected outcomes, invariants and coverage notes.`)
  }
})
