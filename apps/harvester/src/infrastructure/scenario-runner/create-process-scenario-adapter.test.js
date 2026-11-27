import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createProcessScenarioAdapter } from "./create-process-scenario-adapter.js"
import { PassThrough } from "node:stream"
import {
  buildScenarioSeccompFilter,
  createLinuxBubblewrapSandboxLauncher,
} from "./create-linux-bubblewrap-sandbox-launcher.js"

const defaultWorker = fileURLToPath(new URL("./scenario-worker.js", import.meta.url))

function spawnTestWorker({ workerPath, env, execArgv }) {
  const child = fork(workerPath, [], {
    env,
    execArgv,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  })
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[scenario-worker stderr] ${chunk}`)
  })
  return child
}

function assertWorkerExecutionStarted({
  started,
  messages,
  expectedExecuteMessage,
  result,
}) {
  assert.equal(started, true,
    "The process adapter must signal Running only after the worker confirms execution has started.")
  assert.deepEqual(messages, [expectedExecuteMessage],
    "The parent must dispatch exactly once and only after readiness is confirmed.")
  assert.deepEqual(result, { ready: true },
    "The adapter must return the result produced after the readiness handshake.")
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
    bwrapSha256: "a".repeat(64),
    prlimitSha256: "b".repeat(64),
    shellSha256: "c".repeat(64),
    nodeRuntimeSha256: "d".repeat(64),
    cgroupV2Verified: true,
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
  fakeChild.send = (message) => {
    if (message.type === "execute") {
      queueMicrotask(() => {
        fakeChild.emit("message", {
          type: "started",
          runId: "run-worker-large-output",
        })
        fakeChild.emit("message", {
          runId: "run-worker-large-output",
          ok: true,
          output: {
            payload: "x".repeat(2048),
          },
        })
      })
    }
    return true
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
      spawn: () => {
        queueMicrotask(() => fakeChild.emit("message", { type: "ready" }))
        return fakeChild
      },
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
  fakeChild.send = (message) => {
    if (message.type === "execute") {
      queueMicrotask(() => {
        fakeChild.emit("message", {
          type: "started",
          runId: "run-worker-cleanup-failure",
        })
        fakeChild.emit("message", {
          runId: "run-worker-cleanup-failure",
          ok: true,
          output: { received: true },
        })
      })
    }
    return true
  }
  fakeChild.kill = () => {
    killCalls += 1
    throw new Error("permission denied")
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    terminationGraceMs: 5,
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      spawn: () => {
        queueMicrotask(() => fakeChild.emit("message", { type: "ready" }))
        return fakeChild
      },
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
    if (message.type === "execute") {
      queueMicrotask(() => child.emit("message", {
        type: "started",
        runId: "run-cooperative-cancel",
      }))
    }
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
      spawn: () => {
        queueMicrotask(() => child.emit("message", { type: "ready" }))
        return child
      },
    }),
  })
  const controller = new AbortController()
  const execution = adapter.execute({
    runId: "run-cooperative-cancel",
    scenarioId: "RS-004-011",
    input: null,
    signal: controller.signal,
  })

  await new Promise((resolve) => setImmediate(resolve))
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
    assert.equal(result.esmPromiseWriteBlocked, true, "the worker must reject ESM promise-based filesystem writes")
    assert.equal(result.writeOpenBlocked, true, "the worker must reject writable file handles")
    assert.equal(result.secretInherited, false, "Harvester secrets must not be inherited by the worker")
    assert.equal(existsSync(writePath), false, "the worker must not create a file through guarded filesystem APIs")
  } finally {
    if (previousSecret === undefined) {
      delete process.env[secretName]
    } else {
      process.env[secretName] = previousSecret
    }
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})


test("process adapter waits for an explicit worker-ready handshake before dispatch", async () => {
  const messages = []
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.send = (message) => {
    messages.push(message)
    return true
  }
  child.kill = () => {
    child.exitCode = 0
    queueMicrotask(() => child.emit("close"))
    return true
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "example",
    spawnSandboxedWorker: createSimulatedSandboxLauncher({
      spawn: () => child,
    }),
  })
  let started = false
  const expectedExecuteMessage = {
    type: "execute",
    runId: "run-worker-ready",
    strategyId: "example",
    scenarioId: "scenario",
    input: null,
  }
  const execution = adapter.execute({
    runId: "run-worker-ready",
    scenarioId: "scenario",
    input: null,
    onStarted: () => {
      started = true
    },
  })

  assert.equal(started, false, "The runner stays Starting until worker readiness.")
  assert.deepEqual(messages, [], "The parent sends no execute request before readiness.")

  child.emit("message", { type: "ready" })
  assert.equal(started, false, "Bootstrap readiness must not mark execution as Running.")
  assert.deepEqual(messages, [expectedExecuteMessage], "The parent dispatches exactly once after readiness.")

  child.emit("message", {
    type: "started",
    runId: "run-worker-ready",
  })
  child.emit("message", {
    runId: "run-worker-ready",
    ok: true,
    output: { ready: true },
  })
  const result = await execution

  assertWorkerExecutionStarted({
    started,
    messages,
    expectedExecuteMessage,
    result,
  })
})


const LINUX_SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
  maxOutputBytes: 1_048_576,
})

test("Linux sandbox launcher refuses non-Linux hosts before attestation", () => {
  assert.throws(() => createLinuxBubblewrapSandboxLauncher({
    platform: "win32",
  }), /Linux/)
})

function createSandboxChildFixture() {
  let closeHandler
  const child = {
    pid: 4321,
    stdio: [null, null, null, null, new PassThrough()],
    kill: () => true,
    once(...eventArguments) {
      const [event, handler] = eventArguments
      if (event === "close") {
        closeHandler = handler
      }
      return this
    },
  }
  return {
    child,
    close: () => closeHandler(),
  }
}

function createLinuxSandboxLauncherFixture() {
  let spawned
  let cgroupCleanupCount = 0
  const childFixture = createSandboxChildFixture()
  const { child } = childFixture
  const launcher = createLinuxBubblewrapSandboxLauncher({
    platform: "linux",
    repositoryRoot: "/repo",
    nodeExecutable: "/opt/toolcache/node/24.22.3/x64/bin/node",
    bwrapPath: "/usr/bin/bwrap",
    prlimitPath: "/usr/bin/prlimit",
    verifyExecutable: ({ path }) => ({
      path,
      sha256: "a".repeat(64),
    }),
    cgroupController: {
      verify() {},
      create() {
        return {
          cgroupProcsPath: "/sys/fs/cgroup/scenario-test/cgroup.procs",
          cleanup() {
            cgroupCleanupCount += 1
          },
        }
      },
    },
    execFileSync: (...execArguments) => {
      const [path, args] = execArguments
      if (args[0] === "--help") {
        return "bubblewrap --seccomp --preserve-fds"
      }
      return path.includes("bwrap") ? "bubblewrap 0.9.0" : "prlimit from util-linux"
    },
    existsSync: () => true,
    realpathSync: (path) => path,
    spawn: (...spawnArguments) => {
      const [command, args, options] = spawnArguments
      spawned = {
        command,
        args,
        options,
      }
      return child
    },
  })
  return {
    launcher,
    child,
    getSpawned: () => spawned,
    close: childFixture.close,
    cleanupCount: () => cgroupCleanupCount,
  }
}

function assertTrustedNodeRuntimeBind({ spawned }) {
  const nodeRuntimeDirectory = "/opt/toolcache/node/24.22.3/x64"
  let nodeRuntimeBindIndex = -1
  for (let index = 0; index < spawned.args.length - 2; index += 1) {
    if (spawned.args[index] === "--ro-bind" &&
        spawned.args[index + 1] === nodeRuntimeDirectory &&
        spawned.args[index + 2] === nodeRuntimeDirectory) {
      nodeRuntimeBindIndex = index
      break
    }
  }
  assert.ok(nodeRuntimeBindIndex >= 0, "Trusted Node installation must be mounted read-only at its host path")
  assert.ok(spawned.args.includes("/opt/toolcache/node/24.22.3/x64/bin/node"),
    "Worker must execute the verified host Node binary from the read-only bind")
}

function filterContainsSyscallCheck({ filter, syscallNumber }) {
  for (let offset = 0; offset < filter.length; offset += 8) {
    if (filter.readUInt16LE(offset) === 0x15 &&
        filter.readUInt32LE(offset + 4) === syscallNumber) {
      return true
    }
  }
  return false
}

test("Linux sandbox launcher attests the OS profile and applies cgroup, seccomp and IPC", async () => {
  const fixture = createLinuxSandboxLauncherFixture()
  const returned = fixture.launcher({
    workerPath: "/repo/apps/harvester/src/infrastructure/scenario-runner/scenario-worker.js",
    env: { SCENARIO_RUN_WORKER: "1" },
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: LINUX_SANDBOX_PROFILE,
  })
  const spawned = fixture.getSpawned()
  assert.equal(returned, fixture.child)
  assert.equal(fixture.launcher.isolationAttestation.level, "os")
  assert.equal(fixture.launcher.isolationAttestation.networkAccess, "deny")
  assert.equal(fixture.launcher.isolationAttestation.maxOutputBytes, 1_048_576)
  assert.equal(fixture.launcher.isolationAttestation.cgroupV2Verified, true)
  assert.equal(typeof fixture.launcher.isolationAttestation.shellSha256, "string")
  assert.equal(spawned.command, "/bin/sh")
  assert.ok(spawned.args.includes("--as=8589934592:8589934592"))
  assert.ok(spawned.args.includes("/sys/fs/cgroup/scenario-test/cgroup.procs"))
  assertTrustedNodeRuntimeBind({ spawned })
  assert.ok(spawned.args.includes("--cpu=30:30"))
  assert.ok(spawned.args.includes("--unshare-net"))
  assert.ok(spawned.args.includes("--unshare-pid"))
  assert.ok(spawned.args.includes("--seccomp"))
  assert.ok(spawned.args.includes("--preserve-fds"))
  assert.equal(spawned.options.stdio[3], "ipc")
  assert.equal(spawned.options.env.NODE_CHANNEL_FD, "3")
  assert.equal(spawned.options.env.NODE_CHANNEL_SERIALIZATION_MODE, "json")
  assert.ok(buildScenarioSeccompFilter({ arch: "x64" }).length > 0)
  await new Promise((resolve) => setImmediate(resolve))
  fixture.close()
  assert.equal(fixture.cleanupCount(), 1)
})

test("sandbox seccomp permits Bubblewrap's initial execve and denies child-process creation", () => {
  const x64Filter = buildScenarioSeccompFilter({ arch: "x64" })
  const arm64Filter = buildScenarioSeccompFilter({ arch: "arm64" })
  assert.equal(filterContainsSyscallCheck({
    filter: x64Filter,
    syscallNumber: 59,
  }), false, "x64 seccomp must allow Bubblewrap's initial execve of the worker")
  assert.equal(filterContainsSyscallCheck({
    filter: arm64Filter,
    syscallNumber: 221,
  }), false, "arm64 seccomp must allow Bubblewrap's initial execve of the worker")
  assert.equal(filterContainsSyscallCheck({
    filter: x64Filter,
    syscallNumber: 57,
  }), true, "x64 seccomp must deny fork")
  assert.equal(filterContainsSyscallCheck({
    filter: x64Filter,
    syscallNumber: 58,
  }), true, "x64 seccomp must deny vfork")
  assert.equal(filterContainsSyscallCheck({
    filter: x64Filter,
    syscallNumber: 322,
  }), true, "x64 seccomp must deny execveat")
  assert.equal(filterContainsSyscallCheck({
    filter: arm64Filter,
    syscallNumber: 281,
  }), true, "arm64 seccomp must deny execveat")
})

test("Linux sandbox launcher rejects a mismatched isolation profile before spawning", () => {
  let spawnCalls = 0
  const launcher = createLinuxBubblewrapSandboxLauncher({
    platform: "linux",
    repositoryRoot: "/repo",
    nodeExecutable: "/usr/bin/node",
    bwrapPath: "/usr/bin/bwrap",
    prlimitPath: "/usr/bin/prlimit",
    verifyExecutable: ({ path }) => ({
      path,
      sha256: "b".repeat(64),
    }),
    execFileSync: (...execArguments) => {
      const [path, args] = execArguments
      if (args[0] === "--help") {
        return "bubblewrap --seccomp --preserve-fds"
      }
      return path.includes("bwrap") ? "bubblewrap 0.9.0" : "prlimit from util-linux"
    },
    existsSync: () => true,
    realpathSync: (path) => path,
    spawn: () => {
      spawnCalls += 1
      return { stdio: [] }
    },
    cgroupController: {
      verify() {},
      create() {
        return {
          cgroupProcsPath: "/sys/fs/cgroup/scenario-test/cgroup.procs",
          cleanup() {},
        }
      },
    },
  })
  assert.throws(() => launcher({
    workerPath: "/repo/apps/harvester/src/infrastructure/scenario-runner/scenario-worker.js",
    env: {},
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: {
      ...LINUX_SANDBOX_PROFILE,
      networkAccess: "allow",
    },
  }), /profile does not match/)
  assert.equal(spawnCalls, 0)
})

test("Linux sandbox launcher fails closed when delegated cgroup controllers are unavailable", () => {
  assert.throws(() => createLinuxBubblewrapSandboxLauncher({
    platform: "linux",
    repositoryRoot: "/repo",
    nodeExecutable: "/usr/bin/node",
    bwrapPath: "/usr/bin/bwrap",
    prlimitPath: "/usr/bin/prlimit",
    verifyExecutable: ({ path }) => ({
      path,
      sha256: "e".repeat(64),
    }),
    cgroupController: {
      verify() {
        throw new Error("cgroup v2 memory/cpu/pids delegation is required")
      },
      create() {
        throw new Error("unreachable")
      },
    },
    existsSync: () => true,
    realpathSync: (path) => path,
    execFileSync: () => "not reached",
    spawn: () => {
      throw new Error("unreachable")
    },
  }), /cgroup v2 memory\/cpu\/pids delegation is required/)
})


function createSandboxCleanupRetryChild({ cleanupError }) {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  let cleanupAttempts = 0
  child.sandboxCleanup = () => {
    cleanupAttempts += 1
    if (cleanupAttempts < 3) {
      throw cleanupError
    }
  }
  child.send = (message) => {
    if (message.type === "execute") {
      child.emit("message", {
        type: "started",
        runId: message.runId,
      })
      child.emit("message", {
        runId: message.runId,
        ok: true,
        output: {
          simulated: true,
        },
      })
    }
  }
  child.kill = (signal) => {
    child.exitCode = 0
    child.signalCode = signal
    child.emit("exit", 0, signal)
    child.emit("close", 0, signal)
    return true
  }
  return {
    child,
    cleanupAttempts: () => cleanupAttempts,
  }
}

test("process adapter fails the run when sandbox cgroup cleanup cannot be confirmed", async () => {
  const cleanupError = new Error("cgroup removal failed")
  const fixture = createSandboxCleanupRetryChild({ cleanupError })
  const launcher = createSimulatedSandboxLauncher({
    spawn: () => {
      process.nextTick(() => fixture.child.emit("message", {
        type: "ready",
      }))
      return fixture.child
    },
  })
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: launcher,
  })

  await assert.rejects(adapter.execute({
    runId: "run-worker-cgroup-cleanup-failure",
    scenarioId: "RS-004-011",
    input: null,
  }), (error) => {
    assert.match(error.message, /sandbox cgroup cleanup could not be confirmed/i,
      "The adapter must not report a successful scenario when cgroup cleanup fails")
    assert.equal(error.cause, cleanupError,
      "The cgroup cleanup failure must remain available as the rejection cause")
    return true
  })
  await assert.rejects(adapter.cancel({
    runId: "run-worker-cgroup-cleanup-failure",
  }), /sandbox cgroup cleanup could not be confirmed/,
  "The child must remain registered when a cleanup retry still fails")
  assert.equal(await adapter.cancel({
    runId: "run-worker-cgroup-cleanup-failure",
  }), true, "A later confirmed cleanup retry must release the retained child")
  assert.equal(fixture.cleanupAttempts(), 3,
    "Execution and cancellation must retry cleanup until the cgroup removal is confirmed")
})
