import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApi } from "./start-trading-history-api.js"
import { createScenarioRunnerHost } from "./create-scenario-runner-host.js"

const API_TOKEN = "test-token-with-more-than-thirty-two-characters"

function createDatabase() {
  let closeCalls = 0
  return {
    get closeCalls() {
      return closeCalls
    },
    prepare() {
      return {
        get: () => ({ total: 0 }),
      }
    },
    async close() {
      closeCalls += 1
    },
  }
}

test("starts the local API without requiring bearer-token configuration", async () => {
  const database = createDatabase()
  const eventBus = new EventBus()
  let serverInput
  let serverCloseCalls = 0
  const service = await startTradingHistoryApi({
    database,
    eventBus,
    platform: "linux",
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_HOST: "0.0.0.0",
    },
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {
          serverCloseCalls += 1
        },
      }
    },
  })

  assert.equal(serverInput.environment, "testnet", "The local API must use Harvester's selected environment.")
  assert.equal(serverInput.host, "127.0.0.1", "The unauthenticated local API must bind only to loopback.")
  assert.equal(serverInput.port, 4201, "The API must use its documented default local port.")
  assert.equal(serverInput.eventBus, eventBus, "The WebSocket endpoint must share Harvester's EventBus.")
  const rsRegistration = serverInput.scenarioRunnerCatalog.find((strategy) => strategy.strategyId === "RS")
  assert.ok(rsRegistration, "The real API composition must register the production Recovery Seller scenario catalogue.")
  const runtimeScenario = rsRegistration.scenarios.find((scenario) =>
    scenario.id === "RS-RUNTIME-SELL-SUBMISSION-001")
  assert.equal(runtimeScenario.executable, false,
    "The incomplete runtime scenario must remain non-executable in production.")
  assert.equal(runtimeScenario.executionStatus, "BLOCKED")
  assert.ok(runtimeScenario.readinessReasons.some((reason) => /sandbox/i.test(reason)),
    "The production catalogue must expose the missing OS-sandbox boundary.")
  const blockedRun = serverInput.scenarioRunner.submit({
    strategyId: "RS",
    scenarioId: runtimeScenario.id,
    input: runtimeScenario.defaultInput,
  })
  assert.equal(blockedRun.status, "Blocked",
    "The production API must fail closed instead of falling back to an unsandboxed worker.")
  await service.close()
  assert.equal(serverCloseCalls, 1, "The optional API lifecycle must close its listener.")
  assert.equal(database.closeCalls, 0, "The API must not close Harvester's shared database.")
  await eventBus.close()
})

test("starts the API over Harvester's already-open relational database without owning that database", async () => {
  const database = createDatabase()
  let serverInput
  let serverCloseCalls = 0
  const eventBus = new EventBus()
  const service = await startTradingHistoryApi({
    database,
    eventBus,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_TOKEN: API_TOKEN,
      HARVESTER_API_PORT: "0",
    },
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {
          serverCloseCalls += 1
        },
      }
    },
  })

  assert.equal(serverInput.environment, "testnet", "The API must report the environment selected by Harvester.")
  assert.equal(serverInput.eventBus, eventBus, "The WebSocket endpoint must share Harvester's EventBus.")
  assert.equal(serverInput.queries.getSummary().ok, true, "The query facade must be composed over the supplied relational connection.")
  assert.deepEqual(service.address, {
    address: "127.0.0.1",
    port: 4201,
  }, "The service must expose the HTTP listener address for process diagnostics.")
  await service.close()
  assert.equal(serverCloseCalls, 1, "The service must close its HTTP listener.")
  assert.equal(database.closeCalls, 0, "The API lifecycle must not close the database connection owned by Harvester.")
  await eventBus.close()
})

test("rejects invalid API configuration before opening the HTTP listener", async () => {
  const invalidConfigurations = [
    {
      name: "environment",
      env: {
        TRADING_MODE: "sandbox",
      },
    },
    {
      name: "port",
      env: {
        TRADING_MODE: "testnet",
        HARVESTER_API_PORT: "65536",
      },
    },
  ]
  const eventBus = new EventBus()

  try {
    for (const configuration of invalidConfigurations) {
      await assert.rejects(
        () => startTradingHistoryApi({
          database: createDatabase(),
          eventBus,
          env: configuration.env,
          startServer: async () => {
            throw new Error("Invalid configuration must be rejected before binding.")
          },
        }),
        (error) => error.code === "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
        `The API must reject invalid ${configuration.name} configuration.`,
      )
    }
  } finally {
    await eventBus.close()
  }
})

test("preserves the HTTP startup error without closing Harvester's shared database", async () => {
  const database = createDatabase()
  const eventBus = new EventBus()
  const startupFailure = new Error("simulated HTTP bind failure")

  await assert.rejects(
    () => startTradingHistoryApi({
      database,
      eventBus,
      env: {
        TRADING_MODE: "testnet",
        HARVESTER_API_TOKEN: API_TOKEN,
      },
      startServer: async () => {
        throw startupFailure
      },
    }),
    (error) => error === startupFailure,
    "The original HTTP startup failure must remain available to Harvester diagnostics.",
  )
  assert.equal(database.closeCalls, 0, "A failed optional API startup must not close Harvester's database.")
  await eventBus.close()
})


test("records the exact build revision on Scenario Runner records", async () => {
  const database = createDatabase()
  const eventBus = new EventBus()
  let serverInput
  const sourceRevision = "b".repeat(40)
  const service = await startTradingHistoryApi({
    database,
    eventBus,
    env: {
      TRADING_MODE: "testnet",
      COINZILLA_SOURCE_REVISION: sourceRevision,
    },
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {},
      }
    },
  })

  const blocked = serverInput.scenarioRunner.submit({
    strategyId: "RS",
    scenarioId: "not-registered",
    input: {},
  })

  assert.equal(blocked.sourceRevision, sourceRevision,
    "The API composition root must stamp every run with the exact source revision supplied by the deployment.")
  await service.close()
  await eventBus.close()
})


test("derives the source revision from a clean Git checkout when build metadata is absent", async (t) => {
  const repositoryRoot = resolve(process.cwd(), "../..")
  const expectedRevision = execFileSync("git", [
    "-C", repositoryRoot, "rev-parse", "--verify", "HEAD",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
  const worktreeStatus = execFileSync("git", [
    "-C", repositoryRoot, "status", "--porcelain", "--untracked-files=all",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
  if (worktreeStatus) {
    t.skip("A dirty checkout must not claim that HEAD identifies the running source tree.")
    return
  }

  const database = createDatabase()
  const eventBus = new EventBus()
  let serverInput
  const service = await startTradingHistoryApi({
    database,
    eventBus,
    env: {
      TRADING_MODE: "testnet",
    },
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {},
      }
    },
  })
  const blocked = serverInput.scenarioRunner.submit({
    strategyId: "RS",
    scenarioId: "not-registered",
    input: {},
  })

  assert.equal(blocked.sourceRevision, expectedRevision,
    "A clean source checkout must stamp runs with the exact checked-out commit.")
  await service.close()
  await eventBus.close()
})

test("Scenario Runner host marks runtime simulation executable only with a verified adapter", async () => {
  const eventBus = new EventBus()
  const host = createScenarioRunnerHost({
    eventBus,
    sourceRevision: "c".repeat(40),
    adapters: [{
      strategyId: "RS",
      executionMode: "simulation-only",
      osSandboxVerified: true,
      execute: async () => ({
        ok: true,
        data: {},
      }),
      cancel: async () => ({
        ok: true,
        data: {},
      }),
    }],
  })
  const registration = host.catalog.find((item) => item.strategyId === "RS")
  const runtimeScenario = registration.scenarios.find((item) =>
    item.id === "RS-RUNTIME-SELL-SUBMISSION-001")
  assert.equal(runtimeScenario.executable, true)
  assert.equal(runtimeScenario.executionStatus, "EXECUTABLE")
  assert.equal(runtimeScenario.status, "PARTIAL",
    "Simulation execution does not promote production acceptance.")
  await host.runner.close()
  await eventBus.close()
})


async function waitForScenarioRun({ apiBase, runId }) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${apiBase}/runs/${encodeURIComponent(runId)}`)
    assert.equal(response.status, 200,
      "The local HTTP API must expose the accepted run for authoritative status recovery.")
    const envelope = await response.json()
    if (["Completed", "Failed", "Cancelled", "Timed out", "Blocked"].includes(envelope.data.status)) {
      return envelope.data
    }
    await new Promise((complete) => setTimeout(complete, 20))
  }
  return null
}

async function executeScenarioThroughApi({ apiBase, scenario }) {
  const response = await fetch(`${apiBase}/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      strategyId: "RS",
      scenarioId: scenario.id,
      input: scenario.defaultInput,
    }),
  })
  assert.equal(response.status, 202,
    `The local HTTP API must accept scenario ${scenario.id}.`)
  const envelope = await response.json()
  return waitForScenarioRun({
    apiBase,
    runId: envelope.data.runId,
  })
}

function assertScenarioRunSucceeded({ scenario, result }) {
  assert.ok(result, `Scenario ${scenario.id} must reach a terminal state.`)
  assert.equal(result.status, "Completed",
    `Scenario ${scenario.id} must complete its production-flow simulation.`)
  assert.equal(result.output.passed, true,
    `Scenario ${scenario.id} must satisfy its expected assertions.`)
  assert.ok(result.output.assertions.length > 0,
    `Scenario ${scenario.id} must return its assertion evidence.`)
  assert.ok(result.output.trace.length > 0,
    `Scenario ${scenario.id} must return its execution trace.`)
  assert.equal(result.replayProvenance.verified, false,
    "Local simulation must not imply trusted exact-replay provenance.")
}

test("executes every executable RS production-flow scenario through the local Harvester HTTP API on Windows", { skip: process.platform !== "win32" }, async () => {
  const eventBus = new EventBus()
  const service = await startTradingHistoryApi({
    database: createDatabase(),
    eventBus,
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_PORT: "0",
      COINZILLA_SOURCE_REVISION: "d".repeat(40),
    },
    logger: { info() {} },
  })
  const apiBase = `http://127.0.0.1:${service.address.port}/api/v1/scenario-runner`

  try {
    const catalogResponse = await fetch(`${apiBase}/catalog`)
    assert.equal(catalogResponse.status, 200,
      "The local Harvester API must expose the scenario catalogue on Windows.")
    const catalogEnvelope = await catalogResponse.json()
    const scenarios = catalogEnvelope.data
      .find((strategy) => strategy.strategyId === "RS")
      .scenarios.filter((scenario) => scenario.executable === true)
    assert.equal(scenarios.length, 12,
      "All twelve current RS production-flow scenarios must be executable in local Windows simulation.")
    for (const scenario of scenarios) {
      const result = await executeScenarioThroughApi({
        apiBase,
        scenario,
      })
      assertScenarioRunSucceeded({
        scenario,
        result,
      })
    }
  } finally {
    await service.close()
    await eventBus.close()
  }
})
