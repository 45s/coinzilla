import test from "node:test"
import assert from "node:assert/strict"
import { fork } from "node:child_process"
import { createScenarioRunnerHost } from "./create-scenario-runner-host.js"
import { createProcessScenarioAdapter } from "../scenario-runner/create-process-scenario-adapter.js"
import { getRecoverySellerRunnerCatalog } from "../scenario-runner/rs-scenario-adapter.js"

function createTestSandboxLauncher() {
  // Test-only attestation exercises the host gate; it does not apply an OS sandbox.
  // The test worker remains inside the adapter's allowlisted worker directory.
  const launcher = ({ workerPath, env, execArgv, stdio }) => fork(workerPath, [], {
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
    bwrapSha256: "a".repeat(64),
    prlimitSha256: "b".repeat(64),
    shellSha256: "c".repeat(64),
    nodeRuntimeSha256: "d".repeat(64),
    cgroupV2Verified: true,
  }
  return launcher
}

test("host executes the registered production RS runtime scenario in a child process with simulation-only ports", async () => {
  const registeredScenario = getRecoverySellerRunnerCatalog().find((item) =>
    item.id === "RS-RUNTIME-SELL-SUBMISSION-001")
  const scenario = {
    ...registeredScenario,
    status: "IMPLEMENTED",
    executionStatus: "EXECUTABLE",
    executable: true,
    readinessReasons: [],
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: createTestSandboxLauncher(),
  })
  const updates = []
  assert.equal(adapter.osSandboxVerified, true,
    "The test launcher attestation must satisfy the process adapter profile for this host-to-worker plumbing test.")
  const host = createScenarioRunnerHost({
    adapters: [adapter],
    scenarioCatalog: [scenario],
    eventBus: {
      publish: (event) => updates.push(event),
    },
  })

  try {
    assert.equal(host.catalog[0].scenarios[0].executable, true,
      JSON.stringify(host.catalog[0].scenarios[0]))
    const accepted = host.runner.submit({
      strategyId: "RS",
      scenarioId: scenario.id,
      input: scenario.input,
    })
    const result = await host.runner.waitForRun(accepted.runId)

    assert.equal(result.status, "Completed", JSON.stringify(result))
    assert.equal(result.output.source, "production-runtime-evaluator")
    assert.equal(result.output.scenarioId, "RS-RUNTIME-SELL-SUBMISSION-001")
    assert.equal(result.output.passed, true)
    assert.equal(result.replayProvenance.verified, false,
      "The test-only launcher must not fabricate trusted build provenance.")
    assert.ok(result.replayProvenance.missing.includes("verified build artifact provenance is unavailable"),
      "The run must report that immutable build-artifact provenance is not available.")
    const blockedReplay = host.runner.replay(accepted.runId)
    assert.equal(blockedReplay.status, "Blocked",
      "Matching source revision alone must not enable exact replay.")
    assert.match(blockedReplay.diagnostics[0], /verified build artifact provenance/)
    assert.equal(result.output.output.decision.outcome, "SUBMIT")
    assert.equal(result.output.output.submitted, true)
    assert.ok(result.output.trace.some((step) => step.source === "createRecoverySellerRuntimeDispatch"))
    assert.ok(result.output.trace.some((step) => step.kind === "simulated-broker"))

    const statuses = updates
      .filter((event) => event.data.runId === accepted.runId)
      .map((event) => event.data.status)
    assert.ok(statuses.indexOf("Running") > statuses.indexOf("Starting"))
    assert.equal(statuses.at(-1), "Completed")
  } finally {
    await host.runner.close()
  }
})
