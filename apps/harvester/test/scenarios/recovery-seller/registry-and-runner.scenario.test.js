import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { calculateRecoverySellerProfitability } from "../../../src/domain/strategies/recovery-seller/calculate-profitability.js"
import {
  recoverySellerScenarioRegistry,
  validateRecoverySellerScenarioRegistry,
} from "./registry/index.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url))
const registeredPaths = recoverySellerScenarioRegistry.flatMap((scenario) => [
  ...scenario.implementation,
  scenario.test?.file,
  ...scenario.subcases.map((subcase) => subcase.test?.file),
]).filter(Boolean)
const existingPaths = new Set(
  registeredPaths.filter((path) =>
    existsSync(resolve(packageRoot, path.replace("apps/harvester/", "")))),
)

function cloneScenario(overrides = {}) {
  return {
    ...recoverySellerScenarioRegistry[0],
    ...overrides,
  }
}

test("the RS scenario registry contains unique, traceable records with existing source and test paths", () => {
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: recoverySellerScenarioRegistry,
    existingPaths,
  })

  assert.equal(result.valid, true,
    `The initial RS registry must be structurally valid; errors: ${result.errors.join("; ")}`)
  assert.deepEqual(result.errors, [],
    "A valid initial registry must not report schema, identity, reference or path errors.")
})

test("the RS registry rejects duplicate stable scenario IDs", () => {
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [recoverySellerScenarioRegistry[0], recoverySellerScenarioRegistry[0]],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "Two records must never claim the same permanent RS scenario ID.")
  assert.ok(result.errors.some((error) => error.includes("duplicates scenario ID")),
    "Registry validation must identify the duplicated stable scenario ID.")
})

test("the RS registry rejects unknown family, config, rule, decision, state, transition and invariant references", () => {
  const scenario = cloneScenario({
    family: "RS-011",
    configFields: ["RS_PAIR.unknownField"],
    covers: {
      rules: ["RS_UNKNOWN_RULE"],
      decisions: ["RS_UNKNOWN_DECISION"],
      states: ["UNKNOWN_STATE"],
      transitions: ["UNKNOWN_TRANSITION"],
      invariants: ["UNKNOWN_INVARIANT"],
    },
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "A scenario must not reference an unregistered family, config field, rule, decision, state, transition or invariant.")
  assert.ok(result.errors.some((error) => error.includes("RS-001 through RS-010")),
    "The validator must report an unknown scenario family.")
  assert.ok(result.errors.some((error) => error.includes("unknown reference")),
    "The validator must report unknown catalog references.")
})

test("the RS registry rejects invalid execution layer ownership", () => {
  const scenario = cloneScenario({
    layer: "BROKER",
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "A domain scenario must declare a supported execution layer and must not claim broker/application ownership.")
  assert.ok(result.errors.some((error) => error.includes("must be DOMAIN or APPLICATION")),
    "The validator must identify invalid scenario layer ownership.")
})

test("the RS registry rejects malformed scenario steps", () => {
  const scenario = cloneScenario({
    when: [{ inputKey: "profitabilityInput" }],
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "Every ordered step must declare an executable operation type.")
  assert.ok(result.errors.some((error) => error.includes("ordered step with a non-empty type")),
    "The validator must identify a malformed ordered step.")
})

test("the RS registry rejects missing required fields and invalid status values", () => {
  const scenario = cloneScenario({
    status: "DONE",
  })
  delete scenario.given
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "A scenario missing required business inputs or using a noncanonical status must be rejected.")
  assert.ok(result.errors.some((error) => error.includes('missing required field "given"')),
    "The validator must identify the missing Given state.")
  assert.ok(result.errors.some((error) => error.includes("canonical scenario status")),
    "The validator must reject status vocabulary outside the shared methodology.")
})

test("the RS registry rejects implementation and test paths that do not exist", () => {
  const scenario = cloneScenario({
    implementation: ["apps/harvester/src/missing.js"],
    test: {
      file: "apps/harvester/test/missing.scenario.test.js",
      title: "missing",
    },
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "A registry record must not claim source or test paths absent from the repository.")
  assert.ok(result.errors.some((error) => error.includes("path does not exist")),
    "The validator must identify every unresolvable implementation/test path.")
})

test("the RS registry requires exact merged-head evidence before a case can be VERIFIED", () => {
  const scenario = cloneScenario({
    status: "VERIFIED",
    evidence: null,
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "A passing local test or registry entry alone must never promote a scenario to VERIFIED.")
  assert.ok(result.errors.some((error) => error.includes("VERIFIED requires evidence")),
    "The validator must require exact verification evidence for VERIFIED status.")
})

test("the RS registry requires a reason and unblock condition for BLOCKED cases", () => {
  const scenario = cloneScenario({
    status: "BLOCKED",
    evidence: null,
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "A blocked scenario must explain the exact blocker and what resolves it.")
  assert.ok(result.errors.some((error) => error.includes("BLOCKED requires reason and unblockCondition")),
    "The validator must reject an undocumented blocked disposition.")
})

test("the RS registry requires an explicit contract reason for UNSUPPORTED cases", () => {
  const scenario = cloneScenario({
    status: "UNSUPPORTED",
    evidence: null,
  })
  const result = validateRecoverySellerScenarioRegistry({
    scenarios: [scenario],
    existingPaths,
  })

  assert.equal(result.valid, false,
    "An unsupported capability must remain visible with its contract reason.")
  assert.ok(result.errors.some((error) => error.includes("UNSUPPORTED requires a contract reason")),
    "The validator must reject an unsupported disposition without its reason.")
})

test("the DOMAIN runner executes ordered handlers and retains named outputs", async () => {
  const observedOrder = []
  const result = await runRecoverySellerDomainScenario({
    scenario: {
      id: "RS-TEST-001",
      layer: "DOMAIN",
      given: {
        startingValue: 2,
      },
      when: [
        {
          type: "add",
          input: 3,
          saveAs: "afterFirstStep",
        },
        {
          type: "multiply",
          input: 4,
          saveAs: "afterSecondStep",
        },
      ],
    },
    handlers: {
      add: ({ input, context }) => {
        observedOrder.push("add")
        return context.startingValue + input
      },
      multiply: ({ input, context }) => {
        observedOrder.push("multiply")
        return context.afterFirstStep * input
      },
    },
  })

  assert.deepEqual(observedOrder, ["add", "multiply"],
    "Scenario steps must execute sequentially in their declared order.")
  assert.deepEqual(result.results, [5, 20],
    "The runner must retain each operation's exact result in sequence.")
  assert.equal(result.context.afterSecondStep, 20,
    "A later step must be able to consume a named result from an earlier step.")
})

test("the DOMAIN runner rejects application scenarios and missing operation handlers", async () => {
  await assert.rejects(
    () => runRecoverySellerDomainScenario({
      scenario: {
        id: "RS-TEST-002",
        layer: "APPLICATION",
        given: {},
        when: [],
      },
      handlers: {},
    }),
    /cannot execute a non-DOMAIN scenario/,
    "A domain-only runner must not claim application orchestration coverage.",
  )
  await assert.rejects(
    () => runRecoverySellerDomainScenario({
      scenario: {
        id: "RS-TEST-003",
        layer: "DOMAIN",
        given: {},
        when: [{ type: "missing-operation" }],
      },
      handlers: {},
    }),
    /no handler for step type/,
    "An unregistered step type must fail instead of being silently skipped.",
  )
  await assert.rejects(
    () => runRecoverySellerDomainScenario({
      scenario: {
        id: "RS-TEST-004",
        layer: "DOMAIN",
        given: {},
        when: [
          {
            type: "read-input",
            inputKey: "missingInput",
          },
        ],
      },
      handlers: {
        "read-input": ({ input }) => input,
      },
    }),
    /references missing input/,
    "A scenario step must not silently run with an absent Given value.",
  )
})

test("RS-004-011: recovery, legacy and combined profitability gates all pass independently", async () => {
  const result = await runRecoverySellerDomainScenario({
    scenario: recoverySellerScenarioRegistry[0],
    handlers: {
      "evaluate-recovery-seller-profitability": ({ input }) =>
        calculateRecoverySellerProfitability(input),
    },
  })
  const [profitability] = result.results

  assert.equal(result.scenarioId, "RS-004-011",
    "The runner must report the stable scenario ID for the executed business case.")
  assert.deepEqual(result.report, {
    scenarioId: "RS-004-011",
    test: recoverySellerScenarioRegistry[0].test,
    status: "TEST-MAPPED",
    evidence: null,
    result: [recoverySellerScenarioRegistry[0].then],
  }, "The execution report must name the case, exact test mapping, unchanged status, evidence and actual result.")
  assert.equal(result.report.status, "TEST-MAPPED",
    "Executing a scenario must never auto-promote its coverage status.")
  assert.equal(result.report.evidence, null,
    "A local execution must not invent merged-head or CI evidence.")
  assert.deepEqual(profitability, recoverySellerScenarioRegistry[0].then,
    "The real RS profitability policy must match the independently authored exact-decimal oracle for recovery, legacy and combined gates.")
})
