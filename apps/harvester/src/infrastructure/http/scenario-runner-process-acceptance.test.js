import test from "node:test"
import assert from "node:assert/strict"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createScenarioRunnerHost } from "./create-scenario-runner-host.js"
import { createProcessScenarioAdapter } from "../scenario-runner/create-process-scenario-adapter.js"
const TEST_WORKER_PATH = fileURLToPath(new URL(
  "../scenario-runner/scenario-worker-runtime-acceptance-fixture.js",
  import.meta.url,
))

function createTestSandboxLauncher() {
  // Test-only attestation exercises the host gate; it does not apply an OS sandbox.
  const launcher = ({ env, execArgv, stdio }) => fork(TEST_WORKER_PATH, [], {
    env,
    execArgv,
    stdio,
  })
  launcher.isolationAttestation = {
    level: "os",
    networkAccess: "deny",
    filesystemAccess: "read-only-allowlisted-runtime",
    processExecution: "deny-child-processes",
    memoryLimitBytes: 268_435_456,
    cpuTimeLimitMs: 30_000,
    wallTimeLimitMs: 30_000,
    maxOutputBytes: 1_048_576,
  }
  return launcher
}

test("host executes the test-only RS runtime fixture in a child process with a simulated broker", async () => {
  const scenario = {
    id: "RS-TEST-ONLY-RUNTIME-DISPATCH",
    name: "Test-only production runtime dispatch through simulated infrastructure",
    layer: "APPLICATION",
    status: "TEST_ONLY",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: [],
    inputSchema: {
      type: "object",
      required: ["marketPrice"],
      additionalProperties: false,
      properties: {
        marketPrice: {
          type: "string",
          pattern: "^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",
        },
      },
    },
    input: {
      marketPrice: "12.3",
    },
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: createTestSandboxLauncher(),
  })
  const updates = []
  const host = createScenarioRunnerHost({
    adapters: [adapter],
    scenarioCatalog: [scenario],
    eventBus: {
      publish: (event) => updates.push(event),
    },
  })

  try {
    const accepted = host.runner.submit({
      strategyId: "RS",
      scenarioId: scenario.id,
      input: scenario.input,
    })
    const result = await host.runner.waitForRun(accepted.runId)

    assert.equal(result.status, "Completed")
    assert.equal(result.output.source, "production-runtime-evaluator")
    assert.equal(result.output.fixtureId, "rs-runtime-sell-submission")
    assert.equal(result.output.passed, true)
    assert.equal(result.output.output.decision.outcome, "SUBMIT")
    assert.equal(result.output.output.submitted, true)
    assert.ok(result.output.trace.some((step) => step.source === "createRecoverySellerRuntimeDispatch"))
    assert.ok(result.output.trace.some((step) => step.kind === "simulated-broker"))

    const statuses = updates.map((event) => event.data.status)
    assert.ok(statuses.indexOf("Running") > statuses.indexOf("Starting"))
    assert.equal(statuses.at(-1), "Completed")
  } finally {
    await host.runner.close()
  }
})
