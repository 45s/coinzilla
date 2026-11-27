import assert from "node:assert/strict"
import test from "node:test"
import { EventEmitter } from "node:events"

import { createLinuxBubblewrapSandboxLauncher } from "./create-linux-bubblewrap-sandbox-launcher.js"

const SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
  maxOutputBytes: 1_048_576,
})

function createLauncherHarness({ cleanupError = null, spawnChild = null } = {}) {
  let cleanupCount = 0
  let spawnCount = 0
  const cgroupController = {
    verify() {},
    create() {
      return {
        cgroupProcsPath: "/sys/fs/cgroup/scenario-runner-test/cgroup.procs",
        cleanup() {
          cleanupCount += 1
          if (cleanupError) {
            throw cleanupError
          }
        },
      }
    },
  }
  const launcher = createLinuxBubblewrapSandboxLauncher({
    platform: "linux",
    arch: "x64",
    repositoryRoot: "/trusted/repository",
    nodeExecutable: "/trusted/node/bin/node",
    bwrapPath: "/usr/bin/bwrap",
    prlimitPath: "/usr/bin/prlimit",
    shellPath: "/bin/sh",
    existsSync: () => true,
    realpathSync: (path) => path,
    verifyExecutable: ({ path }) => ({
      path,
      sha256: "a".repeat(64),
    }),
    execFileSync: (...execArguments) => {
      const [executable, args] = execArguments
      if (args[0] === "--version" && executable === "/usr/bin/bwrap") {
        return "bubblewrap 0.8.0"
      }
      if (args[0] === "--version" && executable === "/usr/bin/prlimit") {
        return "prlimit 2.39"
      }
      if (args[0] === "--help" && executable === "/usr/bin/bwrap") {
        return "usage: bwrap --seccomp --preserve-fds"
      }
      return ""
    },
    cgroupController,
    spawn() {
      spawnCount += 1
      if (spawnChild) {
        return spawnChild
      }
      throw new Error("Sandbox process must not spawn for an invalid worker path")
    },
  })
  return {
    launcher,
    getCleanupCount: () => cleanupCount,
    getSpawnCount: () => spawnCount,
  }
}

test("sandbox cgroup is cleaned up when worker argument construction fails", () => {
  const harness = createLauncherHarness()

  assert.throws(() => harness.launcher({
    workerPath: "/outside/trusted/repository/worker.js",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: SANDBOX_PROFILE,
  }), {
    name: "TypeError",
  }, "Worker paths outside the trusted repository must fail closed")

  assert.equal(harness.getSpawnCount(), 0,
    "The sandbox process must not spawn after worker-path validation fails")
  assert.equal(harness.getCleanupCount(), 1,
    "The per-run cgroup must be cleaned up when argument construction fails")
})


test("sandbox setup failure reports when cgroup cleanup cannot be confirmed", () => {
  const cleanupError = new Error("cgroup directory removal failed")
  const harness = createLauncherHarness({ cleanupError })

  assert.throws(() => harness.launcher({
    workerPath: "/outside/trusted/repository/worker.js",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: SANDBOX_PROFILE,
  }), (error) => {
    assert.match(error.message, /cgroup cleanup could not be confirmed/i,
      "The setup error must report that sandbox resource cleanup failed")
    assert.ok(error instanceof AggregateError,
      "The setup and cleanup failures must both remain available as causes")
    assert.equal(error.cause.name, "TypeError",
      "The original worker-path setup error must remain the aggregate cause")
    assert.equal(error.errors[1], cleanupError,
      "The original cgroup cleanup failure must be retained")
    return true
  }, "Sandbox setup must not hide a failed cgroup cleanup")

  assert.equal(harness.getSpawnCount(), 0,
    "A worker with an invalid path must never spawn when cleanup also fails")
  assert.equal(harness.getCleanupCount(), 1,
    "The failed cleanup attempt must be observable and must not be silently retried as success")
})


test("launcher retains child cleanup handle when seccomp setup and cgroup cleanup fail", () => {
  const cleanupError = new Error("cgroup directory removal failed")
  const seccompError = new Error("seccomp filter IPC setup failed")
  const child = new EventEmitter()
  child.stdio = []
  child.stdio[4] = {
    once() {},
    end() {
      throw seccompError
    },
  }
  child.kill = () => true
  const harness = createLauncherHarness({
    cleanupError,
    spawnChild: child,
  })

  assert.throws(() => harness.launcher({
    workerPath: "/trusted/repository/apps/harvester/src/infrastructure/scenario-runner/scenario-worker.js",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: SANDBOX_PROFILE,
  }), (error) => {
    assert.match(error.message, /cgroup cleanup could not be confirmed/i)
    assert.equal(error.cause, cleanupError)
    assert.equal(error.errors[0], seccompError,
      "The original seccomp setup failure must remain in the aggregate errors")
    assert.equal(error.errors[1], cleanupError,
      "The cgroup cleanup failure must remain in the aggregate errors")
    assert.equal(error.sandboxCleanupHandle, child,
      "A spawned worker must be retained when setup cleanup cannot be confirmed")
    assert.equal(error.sandboxCleanupError, cleanupError,
      "The cgroup cleanup failure must remain available for cancellation diagnostics")
    return true
  })

  assert.equal(harness.getSpawnCount(), 1)
  assert.equal(harness.getCleanupCount(), 1)
})


test("launcher retains cleanup-only handle when spawn and cgroup cleanup fail", () => {
  const cleanupError = new Error("cgroup directory removal failed")
  const harness = createLauncherHarness({ cleanupError })

  assert.throws(() => harness.launcher({
    workerPath: "/trusted/repository/apps/harvester/src/infrastructure/scenario-runner/scenario-worker.js",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: SANDBOX_PROFILE,
  }), (error) => {
    assert.match(error.message, /cgroup cleanup could not be confirmed/i)
    assert.equal(error.sandboxCleanupError, cleanupError)
    assert.equal(error.sandboxCleanupHandle.exitCode, 0,
      "A cleanup-only handle must not be mistaken for a live child process")
    assert.equal(typeof error.sandboxCleanupHandle.sandboxCleanup, "function",
      "The cgroup cleanup function must remain reachable for retry")
    return true
  })

  assert.equal(harness.getSpawnCount(), 1)
  assert.equal(harness.getCleanupCount(), 1)
})
