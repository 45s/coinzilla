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

function createRequest({ method, url, body = "" }) {
  return {
    method,
    url,
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
    input: {},
  }]
  const adapter = {
    strategyId: "RS",
    execute: async () => ({ trace: [{ id: "decision", kind: "decision", label: "Production decision" }] }),
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
