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

function createLauncherHarness() {
  let cleanupCount = 0
  let spawnCount = 0
  const cgroupController = {
    verify() {},
    create() {
      return {
        cgroupProcsPath: "/sys/fs/cgroup/scenario-runner-test/cgroup.procs",
        cleanup() {
          cleanupCount += 1
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
    execFileSync: (executable, args) => {
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
