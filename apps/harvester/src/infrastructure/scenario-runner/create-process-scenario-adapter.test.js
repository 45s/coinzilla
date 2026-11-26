import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createProcessScenarioAdapter } from "./create-process-scenario-adapter.js"

const defaultWorker = fileURLToPath(new URL("./scenario-worker.js", import.meta.url))

function spawnTestWorker({ workerPath, env, execArgv, stdio }) {
  return fork(workerPath, [], {
    env,
    execArgv,
    stdio,
  })
}

const TEST_SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
})

// This test double simulates the trusted launcher contract; it does not prove OS isolation.
function createSimulatedSandboxLauncher({
  maxOutputBytes = 1_048_576,
  spawn = spawnTestWorker,
} = {}) {
  const launcher = (options) => spawn(options)
  launcher.isolationAttestation = Object.freeze({
    level: "os",
    ...TEST_SANDBOX_PROFILE,
    maxOutputBytes,
  })
  return launcher
}


test("process adapter returns a helper result from a test-only child launcher", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: createSimulatedSandboxLauncher(),
  })
  let workerStarted = false
  const result = await adapter.execute({
    runId: "run-worker-1",
    scenarioId: "RS-004-011",
    input: null,
    onStarted: () => {
      workerStarted = true
    },
  })
  assert.equal(workerStarted, true, "The process adapter must signal readiness after creating its sandboxed worker.")
  assert.equal(result.passed, true)
  assert.equal(result.runId, "run-worker-1")
})

test("process adapter fails closed for unsupported scenario dispatch", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: createSimulatedSandboxLauncher(),
  })
  await assert.rejects(adapter.execute({
    runId: "run-worker-2",
    scenarioId: "RS-999-999",
    input: null,
  }), /not supported/)
})

test("process adapter terminates its worker when the run is cancelled", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    workerPath: defaultWorker,
    spawnSandboxedWorker: createSimulatedSandboxLauncher(),
    terminationGraceMs: 50,
  })
  const controller = new AbortController()
  const execution = adapter.execute({
    runId: "run-worker-cancel",
    scenarioId: "RS-004-011",
    input: null,
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(execution, /cancelled/)
})

test("process adapter waits for worker exit after receiving a result", async () => {
  const workerPath = fileURLToPath(new URL("./scenario-worker-lifecycle-fixture.js", import.meta.url))
  const adapter = createProcessScenarioAdapter({
    strategyId: "example",
    workerPath,
    spawnSandboxedWorker: createSimulatedSandboxLauncher(),
    terminationGraceMs: 1000,
  })
  const startedAt = Date.now()
  const result = await adapter.execute({
    runId: "run-worker-cleanup",
    scenarioId: "scenario",
    input: null,
  })
  assert.deepEqual(result, { received: true }, "worker output must be preserved after cleanup")
  assert.ok(Date.now() - startedAt >= 400, "run completion must wait for the worker's delayed exit")
})


test("process adapter does not claim verified OS isolation for an unattested launcher", () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: spawnTestWorker,
  })
  assert.equal(adapter.executionMode, "simulation-only")
  assert.equal(adapter.osSandboxVerified, false)
})


test("process adapter rejects worker paths outside the allowlisted worker directory", () => {
  assert.throws(() => createProcessScenarioAdapter({
    strategyId: "RS",
    workerPath: process.cwd(),
    spawnSandboxedWorker: spawnTestWorker,
  }), /inside the scenario worker directory/)
})

test("process adapter refuses to start without a trusted OS sandbox launcher", () => {
  assert.throws(() => createProcessScenarioAdapter({
    strategyId: "RS",
  }), /trusted OS sandbox launcher/)
})

test("process adapter passes a restrictive sandbox profile to its trusted launcher", async () => {
  let receivedProfile
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      spawn: (options) => {
        receivedProfile = options.sandboxProfile
        return spawnTestWorker(options)
      },
    }),
  })
  const result = await adapter.execute({
    runId: "run-worker-profile",
    scenarioId: "RS-004-011",
    input: null,
  })
  assert.equal(result.passed, true)
  assert.deepEqual(receivedProfile, {
    networkAccess: "deny",
    filesystemAccess: "read-only-allowlisted-runtime",
    processExecution: "deny-child-processes",
    memoryLimitBytes: 268_435_456,
    cpuTimeLimitMs: 30_000,
    wallTimeLimitMs: 30_000,
    maxOutputBytes: 1_048_576,
  })
})

test("process adapter rejects synthetic RS runtime fixture identifiers", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: createSimulatedSandboxLauncher(),
  })
  await assert.rejects(adapter.execute({
    runId: "run-worker-rs-runtime",
    scenarioId: "RS-004-012",
    input: {
      marketPrice: "12.3",
    },
  }), /not supported/)
})

test("process adapter rejects worker output above its configured size limit", async () => {
  const fakeChild = new EventEmitter()
  fakeChild.exitCode = null
  fakeChild.signalCode = null
  fakeChild.send = () => {
    queueMicrotask(() => fakeChild.emit("message", {
      runId: "run-worker-large-output",
      ok: true,
      output: {
        payload: "x".repeat(2048),
      },
    }))
  }
  fakeChild.kill = () => {
    fakeChild.exitCode = 0
    queueMicrotask(() => fakeChild.emit("close"))
    return true
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    maxOutputBytes: 1024,
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      maxOutputBytes: 1024,
      spawn: () => fakeChild,
    }),
  })
  await assert.rejects(adapter.execute({
    runId: "run-worker-large-output",
    scenarioId: "RS-004-011",
    input: null,
  }), /maximum output size/)
})



test("process adapter fails closed when worker termination cannot be confirmed", async () => {
  let killCalls = 0
  const fakeChild = new EventEmitter()
  fakeChild.exitCode = null
  fakeChild.signalCode = null
  fakeChild.send = () => {
    queueMicrotask(() => fakeChild.emit("message", {
      runId: "run-worker-cleanup-failure",
      ok: true,
      output: { received: true },
    }))
  }
  fakeChild.kill = () => {
    killCalls += 1
    throw new Error("permission denied")
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    terminationGraceMs: 5,
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      spawn: () => fakeChild,
    }),
  })

  await assert.rejects(adapter.execute({
    runId: "run-worker-cleanup-failure",
    scenarioId: "RS-004-011",
    input: null,
  }), /cleanup could not be confirmed/)
  assert.equal(killCalls, 2)
  await assert.rejects(adapter.cancel({
    runId: "run-worker-cleanup-failure",
  }), /cleanup could not be confirmed/)
  assert.equal(killCalls, 4, "unconfirmed workers must remain registered for cleanup retries")
})

test("process adapter refuses direct execution without verified OS sandbox attestation", async () => {
  let spawnCalls = 0
  const spawnUnverifiedWorker = (...argumentsList) => {
    spawnCalls += 1
    return spawnTestWorker(...argumentsList)
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: spawnUnverifiedWorker,
  })

  assert.equal(adapter.osSandboxVerified, false)
  await assert.rejects(adapter.execute({
    runId: "run-worker-unverified",
    scenarioId: "RS-004-011",
    input: null,
  }), /OS-level sandbox isolation has not been verified/)
  assert.equal(spawnCalls, 0, "an unverified launcher must not spawn a worker")
})


test("process adapter requests cooperative cancellation before forced termination", async () => {
  const messages = []
  const killSignals = []
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.connected = true
  child.send = (message) => {
    messages.push(message)
    if (message.type === "cancel") {
      child.exitCode = 0
      queueMicrotask(() => child.emit("close"))
    }
    return true
  }
  child.kill = (signal) => {
    killSignals.push(signal)
    child.exitCode = 0
    queueMicrotask(() => child.emit("close"))
    return true
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    terminationGraceMs: 20,
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      spawn: () => child,
    }),
  })
  const controller = new AbortController()
  const execution = adapter.execute({
    runId: "run-cooperative-cancel",
    scenarioId: "RS-004-011",
    input: null,
    signal: controller.signal,
  })

  controller.abort()
  await assert.rejects(execution, /cancelled/)
  assert.deepEqual(messages.map((message) => message.type), ["execute", "cancel"])
  assert.deepEqual(killSignals, [], "a cooperative worker exit must not be force-killed")
})

test("process adapter does not dispatch work when cancellation races worker creation", async () => {
  const messages = []
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.connected = true
  child.send = (message) => {
    messages.push(message)
    if (message.type === "cancel") {
      child.exitCode = 0
      queueMicrotask(() => child.emit("close"))
    }
    return true
  }
  child.kill = () => {
    child.exitCode = 0
    queueMicrotask(() => child.emit("close"))
    return true
  }
  const controller = new AbortController()
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    terminationGraceMs: 20,
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      spawn: () => {
        controller.abort()
        return child
      },
    }),
  })

  await assert.rejects(adapter.execute({
    runId: "run-cancel-during-spawn",
    scenarioId: "RS-004-011",
    input: null,
    signal: controller.signal,
  }), /cancelled/)
  assert.deepEqual(messages.map((message) => message.type), ["cancel"],
    "A cancellation observed during worker creation must not be followed by an execute message.")
})


test("process worker rejects dangerous Node APIs and does not inherit Harvester secrets", async () => {
  const workerPath = fileURLToPath(new URL("./scenario-worker-guard-fixture.js", import.meta.url))
  const { mkdtempSync, rmSync, existsSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const directory = mkdtempSync(join(tmpdir(), "coinzilla-scenario-guard-"))
  const writePath = join(directory, "worker-write-attempt.txt")
  const secretName = "COINZILLA_SCENARIO_TEST_SECRET"
  const previousSecret = process.env[secretName]
  process.env[secretName] = "must-not-cross-worker-boundary"

  try {
    const adapter = createProcessScenarioAdapter({
      strategyId: "example",
      workerPath,
      spawnSandboxedWorker: createSimulatedSandboxLauncher(),
    })
    const result = await adapter.execute({
      runId: "run-worker-guard-acceptance",
      scenarioId: "worker-guard-acceptance",
      input: { writePath },
    })

    assert.deepEqual(result.blockedModules, [
      "node:child_process",
      "node:worker_threads",
      "node:http2",
      "node:net",
    ], "the worker must reject process creation, extra threads and network modules")
    assert.equal(result.esmImportBlocked, true, "the worker must reject ESM imports of forbidden built-ins")
    assert.equal(result.fetchBlocked, true, "the worker must reject the global fetch API")
    assert.equal(result.syncWriteBlocked, true, "the worker must reject synchronous filesystem writes")
    assert.equal(result.promiseWriteBlocked, true, "the worker must reject promise-based filesystem writes")
    assert.equal(result.writeOpenBlocked, true, "the worker must reject writable file handles")
    assert.equal(result.secretInherited, false, "Harvester secrets must not be inherited by the worker")
    assert.equal(existsSync(writePath), false, "the worker must not create a file through guarded filesystem APIs")
  } finally {
    if (previousSecret === undefined) {
      delete process.env[secretName]
    } else {
      process.env[secretName] = previousSecret
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
