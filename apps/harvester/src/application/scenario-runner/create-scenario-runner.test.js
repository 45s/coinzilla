import test from "node:test"
import assert from "node:assert/strict"
import { createScenarioRunner } from "./create-scenario-runner.js"
import { SCENARIO_RUN_STATUS } from "../../domain/scenario-runner/run-status.js"

function createAdapter(execute = async () => ({ output: "result" })) {
  return Object.freeze({
    strategyId: "example",
    execute: (execution) => {
      execution.onStarted()
      return execute(execution)
    },
    cancel: async () => true,
  })
}

test("runner creates isolated run records and completes through a strategy adapter", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: () => "run-1",
  })
  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "scenario-1",
    input: { value: 1 },
  })
  assert.equal(accepted.status, SCENARIO_RUN_STATUS.STARTING)
  assert.ok(accepted.transitions.some((transition) => transition.status === SCENARIO_RUN_STATUS.ACCEPTED))
  const result = await runner.waitForRun("run-1")
  assert.equal(result.status, SCENARIO_RUN_STATUS.COMPLETED)
  assert.deepEqual(result.output, { output: "result" })
  assert.equal(result.strategyId, "example")
})

test("runner blocks unknown strategies before executing", async () => {
  const runner = createScenarioRunner({ adapters: [] })
  const result = runner.submit({
    strategyId: "missing",
    scenarioId: "s",
  })
  assert.equal(result.status, SCENARIO_RUN_STATUS.BLOCKED)
  assert.match(result.diagnostics[0], /adapter/)
})

test("runner blocks scenarios rejected by the host policy even when a strategy adapter exists", async () => {
  let executions = 0
  const runner = createScenarioRunner({
    adapters: [createAdapter(async () => {
      executions += 1
      return { output: "executed" }
    })],
    canExecuteScenario: ({ scenarioId }) => scenarioId === "allowed",
    createRunId: (() => {
      let count = 0
      return () => `run-policy-${++count}`
    })(),
  })
  const blocked = runner.submit({
    strategyId: "example",
    scenarioId: "preliminary",
  })

  assert.equal(blocked.status, SCENARIO_RUN_STATUS.BLOCKED,
    "A registered strategy adapter must not bypass scenario-level executability policy.")
  assert.equal(runner.getRun(blocked.runId)?.status, SCENARIO_RUN_STATUS.BLOCKED,
    "Policy-blocked submissions must remain queryable.")
  assert.equal(executions, 0, "The adapter must not run for a policy-blocked scenario.")

  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "allowed",
  })
  assert.equal((await runner.waitForRun(accepted.runId)).status, SCENARIO_RUN_STATUS.COMPLETED)
  assert.equal(executions, 1, "An explicitly executable scenario may use its registered adapter.")
})

test("runner rejects invalid scenario input before invoking an executable adapter", () => {
  let executions = 0
  const runner = createScenarioRunner({
    adapters: [createAdapter(async () => {
      executions += 1
      return { output: "must not execute" }
    })],
    canExecuteScenario: () => true,
    validateScenarioInput: () => ({
      valid: false,
      errors: ["Input field minProfit does not match its schema pattern"],
    }),
  })

  assert.throws(() => runner.submit({
    strategyId: "example",
    scenarioId: "invalid-input",
    input: {
      minProfit: "-1",
    },
  }), (error) => error.status === 400 && error.code === "SCENARIO_RUNNER_INPUT_INVALID",
  "Invalid inputs must be rejected as a client error before execution.")
  assert.equal(executions, 0, "The adapter must not receive invalid scenario input.")
})

test("runner rejects duplicate run IDs", () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: () => "same",
  })
  runner.submit({
    strategyId: "example",
    scenarioId: "s1",
  })
  assert.throws(() => runner.submit({
    strategyId: "example",
    scenarioId: "s2",
  }), /duplicate/)
})

test("runner validates adapter results and fails closed", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter(async () => undefined)],
    createRunId: () => "run-2",
  })
  const result = await runner.waitForRun(runner.submit({
    strategyId: "example",
    scenarioId: "s",
  }).runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.FAILED)
  assert.match(result.diagnostics[0], /result/)
})

test("runner supports bounded cancellation", async () => {
  let release
  const adapter = createAdapter(() => new Promise((resolve) => {
    release = resolve
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: () => "run-cancel",
  })
  runner.submit({
    strategyId: "example",
    scenarioId: "s",
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runner.cancel("run-cancel"), true, "repeated cancellation must be accepted idempotently")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runner.getRun("run-cancel").status, SCENARIO_RUN_STATUS.CANCELLING, "run must remain non-terminal until its execution has settled")
  assert.equal(runner.cancel("run-cancel"), true)
  assert.equal(runner.getRun("run-cancel").status, SCENARIO_RUN_STATUS.CANCELLING)
  release({ output: "late" })
  const result = await runner.waitForRun("run-cancel")
  assert.equal(result.status, SCENARIO_RUN_STATUS.CANCELLED, "forced cleanup must preserve the user-requested cancellation outcome")
})

test("runner aborts an active adapter immediately when cancellation is requested", async () => {
  let observedAbort = false
  const adapter = createAdapter(({ signal }) => new Promise((resolve) => {
    const settleCancellation = () => {
      observedAbort = true
      resolve({ output: "cancelled" })
    }
    if (signal.aborted) {
      settleCancellation()
      return
    }
    signal.addEventListener("abort", settleCancellation, { once: true })
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: () => "run-immediate-cancel",
    timeoutMs: 100,
  })
  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "s",
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runner.cancel(accepted.runId), true,
    "An active run must accept a cancellation request.")
  const result = await runner.waitForRun(accepted.runId)

  assert.equal(observedAbort, true,
    "The adapter AbortSignal must be triggered immediately, not at the execution timeout.")
  assert.equal(result.status, SCENARIO_RUN_STATUS.CANCELLED)
})

test("runner waits for forced adapter cleanup when cancellation does not settle execution", async () => {
  let cancellationReason
  const adapter = createAdapter(
    () => new Promise(() => {}),
  )
  const runner = createScenarioRunner({
    adapters: [{
      ...adapter,
      cancel: async ({ reason }) => {
        cancellationReason = reason
        return true
      },
    }],
    createRunId: () => "run-cancel-timeout",
    timeoutMs: 5,
  })
  runner.submit({
    strategyId: "example",
    scenarioId: "s",
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runner.cancel("run-cancel-timeout"), true)
  const result = await runner.waitForRun("run-cancel-timeout")
  assert.equal(cancellationReason, "cancelled", "forced cleanup must receive the cancellation reason")
  assert.equal(result.status, SCENARIO_RUN_STATUS.CANCELLED)
})

test("runner times out a run and reports a distinct terminal status", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter(() => new Promise(() => {}))],
    createRunId: () => "run-timeout",
    timeoutMs: 5,
  })
  const result = await runner.waitForRun(runner.submit({
    strategyId: "example",
    scenarioId: "s",
  }).runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.TIMED_OUT)
})

test("runner retains bounded history and emits lifecycle notifications", async () => {
  const updates = []
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: (() => {
      let count = 0
      return () => `run-${++count}`
    })(),
    maxStoredRuns: 1,
    onUpdate: (run) => updates.push(run.status),
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "first",
  })
  await runner.waitForRun(first.runId)
  const second = runner.submit({
    strategyId: "example",
    scenarioId: "second",
  })
  assert.equal(runner.getRun(first.runId), null)
  assert.ok(updates.includes(SCENARIO_RUN_STATUS.RUNNING))
  assert.equal((await runner.waitForRun(second.runId)).status, SCENARIO_RUN_STATUS.COMPLETED)
})

test("runner retains a blocked run when the bounded queue is full", async () => {
  const adapter = createAdapter(({ signal }) => new Promise((resolve) => {
    const settleCancellation = () => resolve({ output: "cancelled" })
    if (signal.aborted) {
      settleCancellation()
      return
    }
    signal.addEventListener("abort", settleCancellation, { once: true })
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: (() => {
      let count = 0
      return () => `run-queue-${++count}`
    })(),
    maxConcurrentRuns: 1,
    maxQueuedRuns: 0,
    timeoutMs: 100,
  })
  const active = runner.submit({
    strategyId: "example",
    scenarioId: "active",
  })
  const blocked = runner.submit({
    strategyId: "example",
    scenarioId: "overflow",
  })

  assert.equal(active.status, SCENARIO_RUN_STATUS.STARTING,
    "The first run must occupy the only worker slot.")
  assert.equal(blocked.status, SCENARIO_RUN_STATUS.BLOCKED,
    "A submission beyond queue capacity must be explicitly blocked.")
  assert.equal(runner.getRun(blocked.runId)?.status, SCENARIO_RUN_STATUS.BLOCKED,
    "A blocked submission must remain retrievable by its returned run ID.")
  assert.ok(runner.listRuns().some((run) => run.runId === blocked.runId),
    "A blocked submission must remain visible in bounded run history.")

  await runner.close()
})

test("runner rejects new submissions when bounded history is occupied by active runs", async () => {
  const adapter = createAdapter(({ signal }) => new Promise((resolve) => {
    const settleCancellation = () => resolve({ output: "cancelled" })
    if (signal.aborted) {
      settleCancellation()
      return
    }
    signal.addEventListener("abort", settleCancellation, { once: true })
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: (() => {
      let count = 0
      return () => `run-history-${++count}`
    })(),
    maxStoredRuns: 1,
    maxConcurrentRuns: 1,
    maxQueuedRuns: 1,
    timeoutMs: 100,
  })
  const active = runner.submit({
    strategyId: "example",
    scenarioId: "active",
  })

  assert.throws(() => runner.submit({
    strategyId: "example",
    scenarioId: "overflow",
  }), (error) => error.status === 429 && error.code === "SCENARIO_RUNNER_CAPACITY_REACHED",
  "A full history containing only active runs must reject without returning an unpersisted run ID.")
  assert.equal(runner.listRuns().length, 1,
    "Rejecting at the history limit must not exceed the configured record bound.")
  assert.equal(runner.getRun(active.runId)?.status, SCENARIO_RUN_STATUS.STARTING,
    "Capacity rejection must leave the existing active run unchanged.")

  await runner.close()
})

test("runner queues excess runs and starts them FIFO when worker slots free", async () => {
  let releaseFirst
  let releaseSecond
  let releaseThird
  const adapter = createAdapter(({ runId }) => new Promise((resolve) => {
    if (runId === "run-cap-1") {
      releaseFirst = resolve
    } else if (runId === "run-cap-2") {
      releaseSecond = resolve
    } else {
      releaseThird = resolve
    }
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: (() => {
      let count = 0
      return () => `run-cap-${++count}`
    })(),
    maxConcurrentRuns: 2,
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "first",
  })
  const second = runner.submit({
    strategyId: "example",
    scenarioId: "second",
  })
  const third = runner.submit({
    strategyId: "example",
    scenarioId: "third",
  })
  assert.equal(first.status, SCENARIO_RUN_STATUS.STARTING)
  assert.equal(second.status, SCENARIO_RUN_STATUS.STARTING)
  assert.equal(third.status, SCENARIO_RUN_STATUS.QUEUED)
  const thirdCompletion = runner.waitForRun(third.runId)
  await new Promise((resolve) => setImmediate(resolve))
  releaseFirst({ ok: true })
  releaseSecond({ ok: true })
  await runner.waitForRun(first.runId)
  await runner.waitForRun(second.runId)
  await new Promise((resolve) => setImmediate(resolve))
  releaseThird({ ok: true })
  assert.equal((await thirdCompletion).status, SCENARIO_RUN_STATUS.COMPLETED)
})


test("runner retains capacity when execution cleanup is unconfirmed", async () => {
  const adapter = {
    ...createAdapter(async () => {
      const error = new Error("worker cleanup could not be confirmed")
      error.cleanupConfirmed = false
      throw error
    }),
    cancel: async () => false,
  }
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: (() => {
      let sequence = 0
      return () => `run-unconfirmed-cleanup-${++sequence}`
    })(),
    maxStoredRuns: 1,
    maxConcurrentRuns: 1,
    maxQueuedRuns: 0,
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "execution-cleanup",
  })
  const result = await runner.waitForRun(first.runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.FAILED)
  assert.match(result.diagnostics[0], /worker cleanup could not be confirmed/)
  assert.throws(() => runner.submit({
    strategyId: "example",
    scenarioId: "must-not-prune-active-cleanup",
  }), /capacity/)
  await assert.rejects(runner.close(), /cleanup could not be confirmed/)
})

test("runner fails closed and retains worker capacity when timeout cleanup cannot be confirmed", async () => {
  const adapter = createAdapter(() => new Promise(() => {}))
  const runner = createScenarioRunner({
    adapters: [{
      ...adapter,
      cancel: async () => {
        throw new Error("sandbox cleanup failed")
      },
    }],
    createRunId: (() => {
      let count = 0
      return () => `run-cleanup-${++count}`
    })(),
    timeoutMs: 5,
    maxConcurrentRuns: 1,
    maxQueuedRuns: 1,
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "timeout-cleanup",
  })
  const result = await runner.waitForRun(first.runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.TIMED_OUT)
  assert.match(result.diagnostics[0], /sandbox cleanup failed/)
  const second = runner.submit({
    strategyId: "example",
    scenarioId: "must-remain-queued",
  })
  assert.equal(second.status, SCENARIO_RUN_STATUS.QUEUED,
    "the runner must not reuse a worker slot when process cleanup was not confirmed")
  await assert.rejects(runner.close(), /cleanup could not be confirmed/)
})

test("run snapshots redact nested secrets while adapters receive the original input", async () => {
  const input = {
    apiKey: "input-api-key-secret",
    nested: ["Authorization: Bearer input-bearer-secret"],
  }
  let receivedInput
  const runner = createScenarioRunner({
    adapters: [createAdapter(async ({ input: executionInput }) => {
      receivedInput = executionInput
      return {
        apiKey: "output-api-key-secret",
        authorization: "Authorization: Bearer output-bearer-secret",
        nested: ["Cookie: session=output-cookie-secret"],
        note: "-----BEGIN ENCRYPTED PRIVATE KEY-----\\noutput-private-key-secret\\n-----END ENCRYPTED PRIVATE KEY-----",
      }
    })],
  })
  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "redaction",
    input,
  })
  assert.equal(accepted.input.apiKey, "[REDACTED]")
  const result = await runner.waitForRun(accepted.runId)
  assert.deepEqual(receivedInput, input)
  const serialized = JSON.stringify(result)
  for (const secret of [
    "input-api-key-secret",
    "input-bearer-secret",
    "output-api-key-secret",
    "output-bearer-secret",
    "output-cookie-secret",
    "output-private-key-secret",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test("run diagnostics redact credential values returned by an adapter", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter(async () => {
      throw new Error("Authorization: Bearer diagnostic-bearer-secret")
    })],
  })
  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "diagnostic-redaction",
  })
  const result = await runner.waitForRun(accepted.runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.FAILED)
  assert.equal(JSON.stringify(result).includes("diagnostic-bearer-secret"), false)
  assert.equal(result.diagnostics[0].includes("[REDACTED]"), true)
})


test("runner releases retained capacity only after cleanup retry is confirmed", async () => {
  let executions = 0
  let cleanupAttempts = 0
  const adapter = {
    ...createAdapter(async () => {
      executions += 1
      if (executions === 1) {
        const error = new Error("worker cleanup could not be confirmed")
        error.cleanupConfirmed = false
        throw error
      }
      return { output: "second run completed" }
    }),
    cancel: async () => {
      cleanupAttempts += 1
      return true
    },
  }
  let runSequence = 0
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: () => `run-cleanup-retry-${++runSequence}`,
    maxStoredRuns: 1,
    maxConcurrentRuns: 1,
    maxQueuedRuns: 0,
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "cleanup-retry",
  })
  assert.equal((await runner.waitForRun(first.runId)).status, SCENARIO_RUN_STATUS.FAILED)
  assert.equal(await runner.cancel(first.runId), true)
  assert.equal(cleanupAttempts, 1)
  const second = runner.submit({
    strategyId: "example",
    scenarioId: "after-cleanup-confirmed",
  })
  assert.equal((await runner.waitForRun(second.runId)).status, SCENARIO_RUN_STATUS.COMPLETED)
  await runner.close()
})

test("runner remains Starting until the adapter confirms its isolated worker is ready", async () => {
  let signalWorkerReady
  const adapter = {
    strategyId: "example",
    execute: ({ onStarted }) => new Promise((resolve) => {
      signalWorkerReady = () => {
        onStarted()
        resolve({ output: "worker result" })
      }
    }),
    cancel: async () => true,
  }
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: () => "run-startup-handshake",
  })

  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "worker-startup",
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runner.getRun(accepted.runId)?.status, SCENARIO_RUN_STATUS.STARTING,
    "A run must remain Starting while its adapter is still preparing the isolated worker.")
  assert.equal(runner.getRun(accepted.runId)?.transitions.some((item) =>
    item.status === SCENARIO_RUN_STATUS.RUNNING), false,
  "The runner must not publish Running before the adapter confirms worker readiness.")

  signalWorkerReady()

  const result = await runner.waitForRun(accepted.runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.COMPLETED)
  assert.ok(result.transitions.some((item) => item.status === SCENARIO_RUN_STATUS.RUNNING),
    "The runner must publish Running after the adapter confirms worker readiness.")
})

test("runner fails closed when an adapter completes without confirming worker readiness", async () => {
  const runner = createScenarioRunner({
    adapters: [{
      strategyId: "example",
      execute: async () => ({ output: "must not be accepted" }),
      cancel: async () => true,
    }],
    createRunId: () => "run-missing-startup-signal",
  })

  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "missing-startup-signal",
  })
  const result = await runner.waitForRun(accepted.runId)

  assert.equal(result.status, SCENARIO_RUN_STATUS.FAILED,
    "An adapter result without an explicit worker-readiness signal must not be reported as a successful run.")
  assert.match(result.diagnostics[0], /without confirming isolated worker readiness/,
    "The failed run must explain that worker readiness was not confirmed.")
})


function createCompleteReplayProvenance() {
  return {
    verified: true,
    missing: [],
    identity: {
      sourceCommitSha: "a".repeat(40),
      checkedOutCommitSha: "a".repeat(40),
      sourceTreeSha: "b".repeat(40),
      dependencyLockSha256: "c".repeat(64),
      buildArtifactSha256: "d".repeat(64),
      runtimeIdentity: "node-v24.22.3-linux-x64",
      scenarioRegistrySha256: "e".repeat(64),
    },
  }
}

test("runner records complete immutable provenance and replays the original scenario input only when it matches", async () => {
  const receivedInputs = []
  let runSequence = 0
  const replayProvenance = createCompleteReplayProvenance()
  const sourceRevision = replayProvenance.identity.sourceCommitSha
  const adapter = {
    strategyId: "example",
    execute: ({ input, onStarted }) => {
      onStarted()
      receivedInputs.push(structuredClone(input))
      return { output: { received: input } }
    },
    cancel: async () => true,
  }
  const runner = createScenarioRunner({
    adapters: [adapter],
    sourceRevision,
    replayProvenance,
    createRunId: () => `run-replay-${++runSequence}`,
  })
  const original = runner.submit({
    strategyId: "example",
    scenarioId: "scenario-original",
    input: {
      market: "ZROUSDT",
      investment: "100",
    },
  })
  const completedOriginal = await runner.waitForRun(original.runId)

  assert.equal(completedOriginal.sourceRevision, sourceRevision,
    "Every run must record the exact source revision supplied by its owning runtime.")
  assert.equal(completedOriginal.replayProvenance.verified, false,
    "Matching identity hashes and a caller-supplied verified flag must not count as trusted build-artifact provenance.")
  assert.ok(completedOriginal.replayProvenance.missing.includes(
    "caller-supplied verified replay provenance claim is not trusted"),
  "The run must explain that its caller-supplied verification claim was rejected.")
  assert.deepEqual(completedOriginal.replayProvenance.identity, replayProvenance.identity,
    "The run must retain supplied provenance identity fields for diagnostics without trusting them.")
  assert.equal(typeof completedOriginal.inputSha256, "string",
    "Every run must retain a digest of its exact unredacted input snapshot.")
  const replay = runner.replay(original.runId)
  const completedReplay = await runner.waitForRun(replay.runId)

  assert.equal(completedReplay.status, SCENARIO_RUN_STATUS.BLOCKED,
    "Exact replay must remain blocked until a trusted build-artifact verifier is integrated.")
  assert.equal(completedReplay.replayOfRunId, original.runId,
    "A replay must retain an explicit link to its original run.")
  assert.equal(completedReplay.sourceRevision, sourceRevision,
    "A replay must preserve the original exact source revision.")
  assert.deepEqual(completedReplay.input, completedOriginal.input,
    "A replay must reuse the original validated input snapshot rather than current scenario defaults.")
  assert.deepEqual(receivedInputs, [
    {
      market: "ZROUSDT",
      investment: "100",
    },
  ], "The adapter must not receive replay inputs until trusted build-artifact provenance is verified.")
})

test("runner blocks exact replay when immutable build and dependency provenance is unavailable", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: (() => {
      let sequence = 0
      return () => `run-unknown-revision-${++sequence}`
    })(),
  })
  const original = runner.submit({
    strategyId: "example",
    scenarioId: "scenario-original",
    input: { value: "original" },
  })
  await runner.waitForRun(original.runId)

  const replay = runner.replay(original.runId)

  assert.equal(replay.status, SCENARIO_RUN_STATUS.BLOCKED,
    "The runner must not silently replay with current code when the original source revision is unknown.")
  assert.match(replay.diagnostics[0], /provenance.*(incomplete|unavailable)|source revision.*unknown/i,
    "A blocked replay must explain which exact source provenance is unavailable.")
})

test("runner rejects caller-supplied verified replay provenance without a trusted artifact verifier", async () => {
  const replayProvenance = createCompleteReplayProvenance()
  let executionCount = 0
  const adapter = {
    strategyId: "example",
    execute: ({ onStarted }) => {
      onStarted()
      executionCount += 1
      return { output: { executionCount } }
    },
    cancel: async () => true,
  }
  const runner = createScenarioRunner({
    adapters: [adapter],
    sourceRevision: replayProvenance.identity.sourceCommitSha,
    replayProvenance,
    createRunId: (() => {
      let sequence = 0
      return () => `run-untrusted-provenance-${++sequence}`
    })(),
  })
  const original = runner.submit({
    strategyId: "example",
    scenarioId: "scenario-original",
    input: { value: "original" },
  })
  await runner.waitForRun(original.runId)

  const replay = runner.replay(original.runId)
  const replayResult = await runner.waitForRun(replay.runId)

  assert.equal(replayResult.status, SCENARIO_RUN_STATUS.BLOCKED,
    "A caller-provided verified flag and matching hashes must not authorize exact replay without trusted artifact verification.")
  assert.equal(executionCount, 1,
    "The adapter must not execute a replay whose provenance was supplied as an untrusted claim.")
})
