import assert from "node:assert/strict"
import test from "node:test"

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

function createLauncherHarness({ cleanupError = null } = {}) {
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
    assert.ok(error.cause instanceof AggregateError,
      "The setup and cleanup failures must both remain available as causes")
    assert.equal(error.cause.errors[1], cleanupError,
      "The original cgroup cleanup failure must be retained")
    return true
  }, "Sandbox setup must not hide a failed cgroup cleanup")

  assert.equal(harness.getSpawnCount(), 0,
    "A worker with an invalid path must never spawn when cleanup also fails")
  assert.equal(harness.getCleanupCount(), 1,
    "The failed cleanup attempt must be observable and must not be silently retried as success")
})
