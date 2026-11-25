import test from "node:test"
import assert from "node:assert/strict"
import { handleScenarioRunnerRequest } from "./scenario-runner-api.js"
import { createScenarioRunnerHost } from "./create-scenario-runner-host.js"

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(...argumentsList) {
      const [status, headers] = argumentsList
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
}

function createRequest({ method, url, body = "", headers = {} }) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body) {
        yield Buffer.from(body)
      }
    },
  }
}

function createRunnerFake() {
  return {
    submit(input) {
      return {
        runId: "run-1",
        status: "Running",
        ...input,
      }
    },
    getRun(id) {
      return id === "run-1"
        ? {
          runId: id,
          status: "Running",
        }
        : null
    },
    listRuns() {
      return [{ runId: "run-1" }]
    },
    cancel(id) {
      return id === "run-1"
    },
  }
}

test("Scenario Runner API exposes catalog and history through REST", async () => {
  const runner = createRunnerFake()
  let response = responseRecorder()
  const catalogRequest = createRequest({
    method: "GET",
    url: "/api/v1/scenario-runner/catalog",
  })
  await handleScenarioRunnerRequest({
    request: catalogRequest,
    response,
    pathname: "/api/v1/scenario-runner/catalog",
    runner,
    catalog: [{ id: "case" }],
  })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body).data, [{ id: "case" }])
  response = responseRecorder()
  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "GET",
      url: "/api/v1/scenario-runner/runs",
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs",
    runner,
  })
  assert.deepEqual(JSON.parse(response.body).data, [{ runId: "run-1" }])
})

test("Scenario Runner API accepts, queries and cancels a run", async () => {
  const runner = createRunnerFake()
  let response = responseRecorder()
  const body = JSON.stringify({
    strategyId: "RS",
    scenarioId: "RS-004-011",
    input: {},
  })
  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "POST",
      url: "/api/v1/scenario-runner/runs",
      body,
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs",
    runner,
  })
  assert.equal(response.status, 202)
  response = responseRecorder()
  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "GET",
      url: "/api/v1/scenario-runner/runs/run-1",
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs/run-1",
    runner,
  })
  assert.equal(JSON.parse(response.body).data.status, "Running")
  response = responseRecorder()
  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "POST",
      url: "/api/v1/scenario-runner/runs/run-1/cancel",
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs/run-1/cancel",
    runner,
  })
  assert.equal(JSON.parse(response.body).data.accepted, true)
})

test("Scenario Runner API rejects invalid JSON and missing run IDs", async () => {
  const runner = createRunnerFake()
  let response = responseRecorder()
  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "POST",
      url: "/api/v1/scenario-runner/runs",
      body: "not json",
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs",
    runner,
  })
  assert.equal(response.status, 400)
  response = responseRecorder()
  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "GET",
      url: "/api/v1/scenario-runner/runs/unknown",
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs/unknown",
    runner,
  })
  assert.equal(response.status, 404)
})


test("Scenario Runner API preserves explicit capacity errors", async () => {
  const runner = createRunnerFake()
  runner.submit = () => {
    throw Object.assign(new Error("Scenario Runner history capacity is occupied by active executions."), {
      status: 429,
      code: "SCENARIO_RUNNER_CAPACITY_REACHED",
    })
  }
  const response = responseRecorder()

  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "POST",
      url: "/api/v1/scenario-runner/runs",
      body: JSON.stringify({
        strategyId: "RS",
        scenarioId: "scenario",
      }),
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs",
    runner,
  })

  assert.equal(response.status, 429,
    "The API must preserve the runner's retryable capacity status.")
  assert.equal(JSON.parse(response.body).error.code, "SCENARIO_RUNNER_CAPACITY_REACHED",
    "The API must preserve the stable capacity error code.")
})

test("host exposes an executable scenario only when its strategy adapter is registered", async () => {
  const scenarioCatalog = [{
    id: "RS-SIM-001",
    name: "Simulation-only production flow",
    layer: "application",
    status: "TEST-MAPPED",
    executionStatus: "EXECUTABLE",
    executable: true,
    inputSchema: {
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {},
    },
    input: {},
  }]
  const adapter = {
    strategyId: "RS",
    executionMode: "simulation-only",
    osSandboxVerified: true,
    execute: async () => ({
      trace: [{
        id: "decision",
        kind: "decision",
        label: "Production decision",
      }],
    }),
    cancel: async () => true,
  }
  const host = createScenarioRunnerHost({
    adapters: [adapter],
    scenarioCatalog,
  })
  const [scenario] = host.catalog[0].scenarios

  assert.equal(scenario.executable, true,
    "The catalog must expose a source-approved scenario when its strategy adapter is registered.")
  assert.equal(scenario.executionStatus, "EXECUTABLE")
  const accepted = host.runner.submit({
    strategyId: "RS",
    scenarioId: scenario.id,
    input: {},
  })
  assert.equal((await host.runner.waitForRun(accepted.runId)).status, "Completed")
})


test("host blocks live and unverified adapters even when a scenario is source-approved", () => {
  const scenarioCatalog = [{
    id: "RS-SIM-SECURITY",
    name: "Simulation isolation gate",
    layer: "application",
    status: "TEST-MAPPED",
    executionStatus: "EXECUTABLE",
    executable: true,
    inputSchema: {
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {},
    },
    input: {},
  }]
  const adapterBase = {
    strategyId: "RS",
    execute: async () => ({ output: {} }),
    cancel: async () => true,
  }
  const unsafeAdapters = [
    {
      ...adapterBase,
      executionMode: "live",
      osSandboxVerified: true,
    },
    {
      ...adapterBase,
      executionMode: "simulation-only",
      osSandboxVerified: false,
    },
    {
      ...adapterBase,
      osSandboxVerified: true,
    },
  ]
  for (const adapter of unsafeAdapters) {
    const host = createScenarioRunnerHost({
      adapters: [adapter],
      scenarioCatalog,
    })
    const [scenario] = host.catalog[0].scenarios
    assert.equal(scenario.executable, false,
      "A live, unverified or undeclared adapter must not make a scenario executable.")
    assert.equal(scenario.executionStatus, "BLOCKED")
    if (adapter.osSandboxVerified === false) {
      assert.ok(scenario.readinessReasons.some((reason) => reason.includes("OS-level sandbox")))
    }
    assert.equal(host.runner.submit({
      strategyId: "RS",
      scenarioId: scenario.id,
      input: {},
    }).status, "Blocked")
  }
})

test("host validates executable scenario input before the adapter receives it", async () => {
  let executions = 0
  const host = createScenarioRunnerHost({
    adapters: [{
      strategyId: "RS",
      executionMode: "simulation-only",
      osSandboxVerified: true,
      execute: async () => {
        executions += 1
        return { output: "must not execute" }
      },
      cancel: async () => true,
    }],
    scenarioCatalog: [{
      id: "RS-SIM-INPUT",
      name: "Validated simulation input",
      layer: "application",
      status: "TEST-MAPPED",
      executionStatus: "EXECUTABLE",
      executable: true,
      inputSchema: {
        type: "object",
        required: ["minProfit"],
        additionalProperties: false,
        properties: {
          minProfit: {
            type: "string",
            pattern: "^[0-9]+(?:[.][0-9]+)?$",
          },
        },
      },
      input: {
        minProfit: "0.01",
      },
    }],
  })
  const response = responseRecorder()

  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "POST",
      url: "/api/v1/scenario-runner/runs",
      body: JSON.stringify({
        strategyId: "RS",
        scenarioId: "RS-SIM-INPUT",
        input: {
          minProfit: "-1",
          extra: true,
        },
      }),
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs",
    runner: host.runner,
  })

  assert.equal(response.status, 400,
    "The API must reject invalid input using the server-owned scenario schema.")
  assert.equal(JSON.parse(response.body).error.code, "SCENARIO_RUNNER_INPUT_INVALID")
  assert.equal(executions, 0,
    "Invalid input must be rejected before the strategy adapter is invoked.")
})

test("host blocks source-approved scenarios with invalid input schemas", () => {
  const host = createScenarioRunnerHost({
    adapters: [{
      strategyId: "RS",
      execute: async () => ({ output: "must not execute" }),
      cancel: async () => true,
    }],
    scenarioCatalog: [{
      id: "RS-SIM-BAD-SCHEMA",
      name: "Invalid schema",
      layer: "application",
      status: "TEST-MAPPED",
      executionStatus: "EXECUTABLE",
      executable: true,
      inputSchema: {
        type: "object",
        required: [],
        additionalProperties: false,
        properties: {
          value: {
            type: "string",
            pattern: "[",
          },
        },
      },
    }],
  })
  const [scenario] = host.catalog[0].scenarios

  assert.equal(scenario.executable, false,
    "A source-approved mapping with an invalid schema must remain blocked.")
  assert.equal(scenario.executionStatus, "BLOCKED")
})

test("host blocks an executable source mapping when its strategy adapter is absent", () => {
  const host = createScenarioRunnerHost({
    scenarioCatalog: [{
      id: "RS-SIM-002",
      name: "Adapter missing",
      layer: "application",
      status: "TEST-MAPPED",
      executionStatus: "EXECUTABLE",
      executable: true,
      input: {},
    }],
  })
  const [scenario] = host.catalog[0].scenarios

  assert.equal(scenario.executable, false,
    "A source mapping cannot be advertised executable without a registered adapter.")
  assert.equal(scenario.executionStatus, "BLOCKED")
  const run = host.runner.submit({
    strategyId: "RS",
    scenarioId: scenario.id,
    input: {},
  })
  assert.equal(run.status, "Blocked")
})

test("host does not expose a profitability-helper scaffold as an executable RS scenario", () => {
  const host = createScenarioRunnerHost()
  const [scenario] = host.catalog[0].scenarios
  assert.equal(scenario.executable, false, "a mapped profitability helper is not a complete production scenario")
  assert.equal(scenario.executionStatus, "PRELIMINARY", "the catalog must identify the helper as preliminary")
  const run = host.runner.submit({
    strategyId: "RS",
    scenarioId: scenario.id,
    input: scenario.defaultInput,
  })
  assert.equal(run.status, "Blocked", "the runner must fail closed until a full production-flow adapter is registered")
})


test("host discovers strategy registrations without an RS-specific catalog branch", async () => {
  const scenario = {
    id: "GRID-SIM-001",
    name: "Grid simulation",
    layer: "application",
    status: "TEST-MAPPED",
    executionStatus: "EXECUTABLE",
    executable: true,
    inputSchema: {
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {},
    },
    input: {},
  }
  const adapter = {
    strategyId: "GRID",
    executionMode: "simulation-only",
    osSandboxVerified: true,
    execute: async () => ({ output: { strategy: "GRID" } }),
    cancel: async () => true,
  }
  const host = createScenarioRunnerHost({
    adapters: [adapter],
    strategyRegistrations: [{
      strategyId: "GRID",
      strategyName: "Grid Strategy",
      scenarios: [scenario],
    }],
  })

  assert.deepEqual(host.catalog.map((strategy) => strategy.strategyId), ["GRID"],
    "the host catalog must be derived from strategy registrations, not hardcoded to Recovery Seller")
  const [registeredStrategy] = host.catalog
  assert.equal(registeredStrategy.strategyName, "Grid Strategy")
  assert.equal(registeredStrategy.scenarios[0].executable, true)
  const accepted = host.runner.submit({
    strategyId: "GRID",
    scenarioId: scenario.id,
    input: {},
  })
  const completed = await host.runner.waitForRun(accepted.runId)
  assert.equal(completed.status, "Completed")
  assert.deepEqual(completed.output, { output: { strategy: "GRID" } })
})



test("host rejects duplicate scenario IDs within a strategy registration", () => {
  const scenario = {
    id: "GRID-SIM-001",
    name: "Grid simulation",
  }
  assert.throws(() => createScenarioRunnerHost({
    strategyRegistrations: [{
      strategyId: "GRID",
      strategyName: "Grid Strategy",
      scenarios: [scenario, scenario],
    }],
  }), /duplicate scenario/i)
})

test("host snapshots and freezes scenario definitions", () => {
  const scenario = {
    id: "GRID-SIM-002",
    name: "Grid immutable input",
    layer: "application",
    status: "TEST-MAPPED",
    executionStatus: "EXECUTABLE",
    executable: true,
    inputSchema: {
      type: "object",
      required: ["amount"],
      additionalProperties: false,
      properties: {
        amount: {
          type: "string",
          pattern: "^[0-9]+$",
        },
      },
    },
    input: {
      amount: "1",
    },
  }
  const host = createScenarioRunnerHost({
    strategyRegistrations: [{
      strategyId: "GRID",
      strategyName: "Grid Strategy",
      scenarios: [scenario],
    }],
  })

  scenario.inputSchema.properties.amount.type = "boolean"
  scenario.input.amount = "999"
  const [catalogScenario] = host.catalog[0].scenarios
  assert.equal(catalogScenario.inputSchema.properties.amount.type, "string")
  assert.equal(catalogScenario.defaultInput.amount, "1")
  assert.equal(Object.isFrozen(catalogScenario.inputSchema.properties.amount), true)
  assert.equal(Object.isFrozen(catalogScenario.defaultInput), true)
})

test("host snapshots adapter capabilities and execute function", async () => {
  let originalExecutions = 0
  let replacementExecutions = 0
  const adapter = {
    strategyId: "GRID",
    executionMode: "simulation-only",
    osSandboxVerified: true,
    execute: async () => {
      originalExecutions += 1
      return { output: { source: "original" } }
    },
    cancel: async () => true,
  }
  const host = createScenarioRunnerHost({
    adapters: [adapter],
    strategyRegistrations: [{
      strategyId: "GRID",
      strategyName: "Grid Strategy",
      scenarios: [{
        id: "GRID-SIM-003",
        name: "Grid adapter snapshot",
        layer: "application",
        status: "TEST-MAPPED",
        executionStatus: "EXECUTABLE",
        executable: true,
        inputSchema: {
          type: "object",
          required: [],
          additionalProperties: false,
          properties: {},
        },
        input: {},
      }],
    }],
  })

  adapter.executionMode = "live"
  adapter.osSandboxVerified = false
  adapter.execute = async () => {
    replacementExecutions += 1
    return { output: { source: "replacement" } }
  }
  const accepted = host.runner.submit({
    strategyId: "GRID",
    scenarioId: "GRID-SIM-003",
    input: {},
  })
  const completed = await host.runner.waitForRun(accepted.runId)
  assert.equal(completed.status, "Completed")
  assert.equal(originalExecutions, 1)
  assert.equal(replacementExecutions, 0)
})

test("Scenario Runner API rejects untrusted browser origins before accepting a run", async () => {
  let submissions = 0
  const runner = createRunnerFake()
  runner.submit = (input) => {
    submissions += 1
    return {
      runId: "run-forbidden-origin",
      status: "Running",
      ...input,
    }
  }
  const response = responseRecorder()

  await handleScenarioRunnerRequest({
    request: createRequest({
      method: "POST",
      url: "/api/v1/scenario-runner/runs",
      body: JSON.stringify({
        strategyId: "RS",
        scenarioId: "RS-004-011",
        input: {},
      }),
      headers: {
        origin: "https://attacker.example",
      },
    }),
    response,
    pathname: "/api/v1/scenario-runner/runs",
    runner,
  })

  assert.equal(response.status, 403,
    "an untrusted browser origin must be rejected even when the API is loopback-only")
  assert.equal(JSON.parse(response.body).error.code, "SCENARIO_RUNNER_ORIGIN_FORBIDDEN",
    "the API must return a stable origin-policy error")
  assert.equal(submissions, 0,
    "a cross-origin browser request must not enqueue scenario execution")
})
