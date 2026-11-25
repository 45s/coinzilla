import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { calculateRecoverySellerProfitability } from "../../../src/domain/strategies/recovery-seller/calculate-profitability.js"
import {
  defineRecoverySellerScenario,
  recoverySellerScenarioRegistry,
  validateRecoverySellerScenarioRegistry,
} from "./registry/index.js"
import { runRecoverySellerApplicationScenario } from "./runners/run-application-scenario.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url))
const scenarioFile = "apps/harvester/test/scenarios/recovery-seller/registry-and-runner.scenario.test.js"
const implementationFile = "apps/harvester/src/domain/strategies/recovery-seller/calculate-profitability.js"
const candidatePaths = recoverySellerScenarioRegistry.flatMap((scenario) => [
  ...scenario.implementation,
  scenario.test?.file,
  ...(scenario.subcases ?? []).map((subcase) => subcase.test?.file),
]).filter(Boolean)
const existingPaths = new Set(
  [scenarioFile, implementationFile, ...candidatePaths].filter((path) =>
    existsSync(resolve(packageRoot, path.replace("apps/harvester/", "")))),
)

function expectedScenarioIds({ family, count }) {
  const ids = []
  for (let index = 1; index <= count; index += 1) {
    ids.push(`${family}-${String(index).padStart(3, "0")}`)
  }
  return ids
}

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

test("every mapped scenario test title exists in its referenced test file", () => {
  const mappings = recoverySellerScenarioRegistry.flatMap((scenario) => [
    {
      scenarioId: scenario.id,
      mapping: scenario.test,
    },
    ...(scenario.subcases ?? []).map((subcase) => ({
      scenarioId: subcase.id,
      mapping: subcase.test,
    })),
  ]).filter(({ mapping }) => mapping)

  for (const { scenarioId, mapping } of mappings) {
    assert.equal(typeof mapping.file, "string",
      `${scenarioId} must reference a concrete test file.`)
    assert.equal(typeof mapping.title, "string",
      `${scenarioId} must reference an exact named test title.`)
    const filePath = resolve(packageRoot, mapping.file.replace("apps/harvester/", ""))
    assert.equal(existsSync(filePath), true,
      `${scenarioId} mapped test file must exist: ${mapping.file}`)
    const source = readFileSync(filePath, "utf8")
    const hasLiteralTestTitle = source.includes(mapping.title)
    const registersScenarioOwnedTitle = source.includes("test(scenario.test.title") &&
      source.includes("from \"./scenarios/")
    assert.ok(hasLiteralTestTitle || registersScenarioOwnedTitle,
      `${scenarioId} mapped test title is neither declared literally nor registered from its scenario record in ${mapping.file}: ${mapping.title}`)
  }
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

test("the RS registry reports malformed non-string subcase IDs without throwing", () => {
  const scenario = {
    ...recoverySellerScenarioRegistry.find((item) => item.id === "RS-004-011"),
    subcases: [{
      id: {
        toString: () => "RS-004-011-A",
      },
      description: "malformed identifier must be rejected",
      status: "TEST-MAPPED",
      test: {
        file: scenarioFile,
        title: "malformed subcase identifier",
      },
      evidence: null,
    }],
  }
  let result
  assert.doesNotThrow(() => {
    result = validateRecoverySellerScenarioRegistry({
      scenarios: [scenario],
      existingPaths,
    })
  }, "Untrusted malformed registry data must produce validation errors, not crash the validator.")
  assert.equal(result.valid, false,
    "A non-string subcase identifier must be rejected.")
  assert.ok(result.errors.some((error) => error.includes("parent scenario ID plus a letter suffix")),
    "The validator must report the malformed subcase identifier.")
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


test("the DOMAIN runner rejects inherited handler properties", async () => {
  await assert.rejects(
    () => runRecoverySellerDomainScenario({
      scenario: {
        id: "RS-TEST-INHERITED-HANDLER",
        layer: "DOMAIN",
        given: {},
        when: [{ type: "toString" }],
      },
      handlers: {},
    }),
    /no handler for step type/,
    "The dispatcher must execute only explicitly registered own handler properties.",
  )
})

test("the shared registry includes every mapped RS-001 and RS-002 family record", () => {
  const authorizationCases = recoverySellerScenarioRegistry.filter((scenario) =>
    scenario.family === "RS-001")
  const buyCases = recoverySellerScenarioRegistry.filter((scenario) =>
    scenario.family === "RS-002")

  assert.deepEqual(
    authorizationCases.map((scenario) => scenario.id).sort(),
    expectedScenarioIds({
      family: "RS-001",
      count: 14,
    }),
    "The RS-001 registry must contain every consecutive authorization/custody ID without gaps or substitutions.",
  )
  assert.deepEqual(
    buyCases.map((scenario) => scenario.id).sort(),
    expectedScenarioIds({
      family: "RS-002",
      count: 21,
    }),
    "The RS-002 registry must contain all twenty reserved business IDs and the cross-cutting J.01 ID without gaps or substitutions.",
  )
})

test("scenario records are deeply immutable and reject non-record inputs", () => {
  const preFrozenChild = {
    nested: {
      mutable: true,
    },
  }
  Object.freeze(preFrozenChild)
  const cyclicFacts = {}
  cyclicFacts.self = cyclicFacts
  let scenario
  assert.doesNotThrow(() => {
    scenario = defineRecoverySellerScenario({
      id: "RS-TEST-IMMUTABLE",
      given: {
        custody: {
          available: "1",
        },
      },
      preFrozenChild,
      cyclicFacts,
    })
  }, "Deep freezing must handle already-frozen ancestors and cyclic input without throwing.")

  assert.equal(Object.isFrozen(scenario), true,
    "A registered scenario record must not be mutable after declaration.")
  assert.equal(Object.isFrozen(scenario.given), true,
    "Nested Given facts must also be immutable so fixtures cannot drift during execution.")
  assert.equal(Object.isFrozen(scenario.given.custody), true,
    "Deeply nested business facts must remain immutable.")
  assert.equal(Object.isFrozen(preFrozenChild.nested), true,
    "An already-frozen ancestor must not prevent its nested objects from being frozen.")
  assert.equal(Object.isFrozen(cyclicFacts), true,
    "Cyclic scenario facts must still be frozen.")
  assert.throws(
    () => defineRecoverySellerScenario(null),
    TypeError,
    "The scenario definition helper must reject null instead of accepting a malformed registry record.",
  )
})

test("the APPLICATION runner executes ordered handlers and reports mapped evidence without promoting status", async () => {
  const observedOrder = []
  const result = await runRecoverySellerApplicationScenario({
    scenario: {
      id: "RS-TEST-APPLICATION-001",
      layer: "APPLICATION",
      given: {
        intentId: "rs-intent-001",
      },
      when: [
        {
          type: "persist-intent",
          inputKey: "intentId",
          saveAs: "durableIntent",
        },
        {
          type: "read-durable-intent",
          inputKey: "durableIntent",
        },
      ],
      test: {
        file: scenarioFile,
        title: "the APPLICATION runner executes ordered handlers and reports mapped evidence without promoting status",
      },
      status: "TEST-MAPPED",
      evidence: null,
    },
    handlers: {
      "persist-intent": async ({ input }) => {
        observedOrder.push("persist")
        return {
          id: input,
          durable: true,
        }
      },
      "read-durable-intent": ({ input }) => {
        observedOrder.push("read")
        return input
      },
    },
  })

  assert.deepEqual(observedOrder, ["persist", "read"],
    "APPLICATION scenario handlers must execute sequentially across the real application boundary.")
  assert.deepEqual(result.results[1], {
    id: "rs-intent-001",
    durable: true,
  }, "A later application step must receive the exact result of the preceding durable operation.")
  assert.equal(result.layer, "APPLICATION",
    "The execution report must identify application-level rather than domain-only evidence.")
  assert.equal(result.report.status, "TEST-MAPPED",
    "Running an application scenario must never promote its coverage status.")
  assert.equal(result.report.evidence, null,
    "A local application run must not invent merge or exact-head verification evidence.")
})

test("the APPLICATION runner rejects DOMAIN records and missing operation handlers", async () => {
  await assert.rejects(
    () => runRecoverySellerApplicationScenario({
      scenario: null,
      handlers: {},
    }),
    TypeError,
    "The application runner must reject a missing scenario record before attempting step execution.",
  )
  await assert.rejects(
    () => runRecoverySellerApplicationScenario({
      scenario: {
        id: "RS-TEST-APPLICATION-002",
        layer: "DOMAIN",
        given: {},
        when: [],
      },
      handlers: {},
    }),
    /cannot execute a non-APPLICATION scenario/,
    "The application runner must reject DOMAIN records instead of overstating application coverage.",
  )
  await assert.rejects(
    () => runRecoverySellerApplicationScenario({
      scenario: {
        id: "RS-TEST-APPLICATION-003",
        layer: "APPLICATION",
        given: {},
        when: [{ type: "missing-operation" }],
      },
      handlers: {},
    }),
    /no handler for step type/,
    "An application scenario with an unregistered operation must fail rather than silently pass.",
  )
  await assert.rejects(
    () => runRecoverySellerApplicationScenario({
      scenario: {
        id: "RS-TEST-APPLICATION-004",
        layer: "APPLICATION",
        given: {},
        when: [{
          type: "read-input",
          inputKey: "missingInput",
        }],
      },
      handlers: {
        "read-input": ({ input }) => input,
      },
    }),
    /references missing input/,
    "An application step must not run with an absent Given fact.",
  )
})

test("RS-004-011: recovery, legacy and combined profitability gates all pass independently", async () => {
  const scenario = recoverySellerScenarioRegistry.find((item) => item.id === "RS-004-011")
  assert.ok(scenario,
    "The stable RS-004-011 profitability case must be present in the shared registry.")
  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "evaluate-recovery-seller-profitability": ({ input }) =>
        calculateRecoverySellerProfitability(input),
    },
  })
  const [profitability] = result.results

  assert.equal(result.scenarioId, scenario.id,
    "The runner must report the stable scenario ID for the executed business case.")
  assert.deepEqual(result.report, {
    scenarioId: scenario.id,
    test: scenario.test,
    status: "TEST-MAPPED",
    evidence: null,
    result: [scenario.then],
  }, "The execution report must name the case, exact test mapping, unchanged status, evidence and actual result.")
  assert.equal(result.report.status, "TEST-MAPPED",
    "Executing a scenario must never auto-promote its coverage status.")
  assert.equal(result.report.evidence, null,
    "A local execution must not invent merged-head or CI evidence.")
  assert.deepEqual(profitability, scenario.then,
    "The real RS profitability policy must match the independently authored exact-decimal oracle for recovery, legacy and combined gates.")
})


test("scenario output names cannot mutate the execution context prototype", async () => {
  const savedRecord = {
    ownership: "RS",
  }
  const result = await runRecoverySellerDomainScenario({
    scenario: {
      id: "RS-TEST-PROTOTYPE-SAFE",
      layer: "DOMAIN",
      given: {},
      when: [
        {
          type: "create-record",
          input: savedRecord,
          saveAs: "__proto__",
        },
        {
          type: "read-record",
          inputKey: "__proto__",
        },
      ],
    },
    handlers: {
      "create-record": ({ input }) => input,
      "read-record": ({ input }) => input,
    },
  })

  assert.equal(Object.getPrototypeOf(result.context), Object.prototype,
    "Saving a named scenario output must not replace the context object's prototype.")
  assert.equal(Object.hasOwn(result.context, "__proto__"), true,
    "Every explicitly saved output name must remain an own context property, including __proto__.")
  assert.deepEqual(Object.getOwnPropertyDescriptor(result.context, "__proto__").value, savedRecord,
    "A saved output with a special object-property name must preserve its exact value.")
  assert.deepEqual(result.results, [savedRecord, savedRecord],
    "Subsequent scenario steps must be able to read the saved special-name output without losing it.")
})
