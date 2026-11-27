import assert from "node:assert/strict"
import { existsSync, readFileSync, readlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import test from "node:test"

import { createLinuxBubblewrapSandboxLauncher } from "./create-linux-bubblewrap-sandbox-launcher.js"
import { createProcessScenarioAdapter } from "./create-process-scenario-adapter.js"

const SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
  maxOutputBytes: 1_048_576,
})

function hostNamespaceIds() {
  return {
    network: readlinkSync(join("/proc/self/ns", "net")),
    pid: readlinkSync(join("/proc/self/ns", "pid")),
    user: readlinkSync(join("/proc/self/ns", "user")),
    ipc: readlinkSync(join("/proc/self/ns", "ipc")),
    uts: readlinkSync(join("/proc/self/ns", "uts")),
  }
}

function waitForWorkerMessage({ child, expectedType, timeoutMs }) {
  return new Promise((...promiseCallbacks) => {
    const [resolveMessage, rejectMessage] = promiseCallbacks
    let timer = null
    function onMessage(message) {
      if (message?.type === expectedType || message?.type === "probe-error") {
        finish({ message })
      }
    }
    function onError(error) {
      finish({ error })
    }
    function onExit(...exitArguments) {
      const [code, signal] = exitArguments
      finish({ error: new Error(`Sandbox worker exited before its probe response: ${code}/${signal}`) })
    }
    function finish({ error = null, message = null } = {}) {
      clearTimeout(timer)
      child.removeListener("message", onMessage)
      child.removeListener("error", onError)
      child.removeListener("exit", onExit)
      if (error) {
        rejectMessage(error)
      } else {
        resolveMessage(message)
      }
    }
    timer = setTimeout(() => finish({ error: new Error("Sandbox worker probe timed out") }), timeoutMs)
    child.on("message", onMessage)
    child.once("error", onError)
    child.once("exit", onExit)
  })
}
function sendWorkerMessage({ child, message }) {
  return new Promise((...promiseCallbacks) => {
    const [resolveMessage, rejectMessage] = promiseCallbacks
    child.send(message, (error) => {
      if (error) {
        rejectMessage(error)
      } else {
        resolveMessage()
      }
    })
  })
}

function cgroupPathForProcess({ pid }) {
  const entries = readFileSync(join("/proc", String(pid), "cgroup"), "utf8").split("\n")
  const unifiedEntry = entries.find((entry) => entry.startsWith("0::"))
  assert.ok(unifiedEntry, "Sandbox process must belong to the unified cgroup v2 hierarchy")
  const relativePath = unifiedEntry.slice(3).replace(/^\/+/, "")
  return resolve("/sys/fs/cgroup", relativePath)
}

function assertCgroupSetting({ cgroupPath, name, expectedValue }) {
  const actualValue = readFileSync(join(cgroupPath, name), "utf8").trim()
  assert.equal(actualValue, expectedValue, `Sandbox cgroup must enforce ${name}`)
}

function assertSandboxCgroupProfile({ child }) {
  const cgroupPath = cgroupPathForProcess({ pid: child.pid })
  const cgroupProcesses = readFileSync(join(cgroupPath, "cgroup.procs"), "utf8")
    .trim()
    .split("\n")
  assert.ok(cgroupProcesses.includes(String(child.pid)), "Launcher process must be inside its run cgroup")
  assertCgroupSetting({
    cgroupPath,
    name: "memory.max",
    expectedValue: String(SANDBOX_PROFILE.memoryLimitBytes),
  })
  assertCgroupSetting({
    cgroupPath,
    name: "memory.swap.max",
    expectedValue: "0",
  })
  assertCgroupSetting({
    cgroupPath,
    name: "cpu.max",
    expectedValue: "100000 100000",
  })
  assertCgroupSetting({
    cgroupPath,
    name: "pids.max",
    expectedValue: "64",
  })
  assertCgroupSetting({
    cgroupPath,
    name: "memory.oom.group",
    expectedValue: "1",
  })
}

function waitForChildClose({ child, timeoutMs }) {
  return new Promise((...promiseCallbacks) => {
    const [resolveClose] = promiseCallbacks
    let timer = null
    function onClose() {
      finish(true)
    }
    function finish(closed) {
      clearTimeout(timer)
      child.removeListener("close", onClose)
      resolveClose(closed)
    }
    timer = setTimeout(() => finish(false), timeoutMs)
    child.once("close", onClose)
  })
}
async function terminateSandboxChild({ child }) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill("SIGTERM")
  if (!await waitForChildClose({
    child,
    timeoutMs: 2_000,
  })) {
    child.kill("SIGKILL")
    await waitForChildClose({
      child,
      timeoutMs: 2_000,
    })
  }
}

test("real Linux sandbox isolates namespaces, filesystem, network, child processes and cgroup resources", {
  skip: process.env.SCENARIO_RUNNER_LINUX_SANDBOX_E2E !== "1",
  timeout: 45_000,
}, async (testContext) => {
  const launcher = createLinuxBubblewrapSandboxLauncher()
  const child = launcher({
    workerPath: fileURLToPath(new URL("./sandbox-isolation-probe-worker.js", import.meta.url)),
    env: {
      SCENARIO_RUNNER_E2E_SECRET: "test-only-secret-must-not-enter-worker",
    },
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile: SANDBOX_PROFILE,
  })
  testContext.after(async () => terminateSandboxChild({ child }))
  assert.ok(child.pid, "Sandbox launcher must return a child process with a host PID")

  const responsePromise = waitForWorkerMessage({
    child,
    expectedType: "probe-result",
    timeoutMs: 10_000,
  })
  await sendWorkerMessage({
    child,
    message: {
      type: "probe",
      hostNamespaceIds: hostNamespaceIds(),
    },
  })
  const response = await responsePromise
  assert.equal(response.type, "probe-result", "Sandbox probe worker must return a structured result")

  const { results } = response
  assert.equal(results.secretEnvironmentAbsent, true, "Launcher must not forward caller secrets into the worker")
  assert.equal(results.readOnlyFilesystem.blocked, true, "Worker must not write into the allowlisted source filesystem")
  assert.equal(results.network.connected, false, "Worker must not establish an outbound network connection")
  assert.equal(results.childProcess.blocked, true, "Seccomp must deny child process creation")
  assert.equal(results.namespaces.network, true, "Worker must use a distinct network namespace")
  assert.equal(results.namespaces.pid, true, "Worker must use a distinct PID namespace")
  assert.equal(results.namespaces.user, true, "Worker must use a distinct user namespace")
  assert.equal(results.namespaces.ipc, true, "Worker must use a distinct IPC namespace")
  assert.equal(results.namespaces.uts, true, "Worker must use a distinct UTS namespace")
  assert.equal(results.namespaces.rootUidIsMapped, true, "Worker UID 0 must be mapped inside the user namespace")

  assertSandboxCgroupProfile({ child })
  const cgroupPath = cgroupPathForProcess({ pid: child.pid })
  assert.ok(existsSync(cgroupPath), "The per-run cgroup must exist while the sandbox child is alive")
  await sendWorkerMessage({
    child,
    message: {
      type: "done",
    },
  })
  assert.equal(await waitForChildClose({
    child,
    timeoutMs: 5_000,
  }), true, "Sandbox worker must exit cleanly so the run cgroup can be removed")
  assert.equal(existsSync(cgroupPath), false,
    "The real per-run cgroup must be removed after the sandbox child exits")
})


test("real Linux sandbox runs Recovery Seller runtime simulation through the production process adapter", {
  skip: process.env.SCENARIO_RUNNER_LINUX_SANDBOX_E2E !== "1",
  timeout: 45_000,
}, async () => {
  const launcher = createLinuxBubblewrapSandboxLauncher()
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: launcher,
    maxOutputBytes: SANDBOX_PROFILE.maxOutputBytes,
  })
  assert.equal(adapter.osSandboxVerified, true, "Process adapter must accept only the real OS sandbox attestation")
  assert.equal(adapter.executionMode, "simulation-only", "Recovery Seller runtime execution must remain simulation-only")
  const runId = "linux-sandbox-e2e-recovery-seller"
  try {
    const result = await adapter.execute({
      runId,
      scenarioId: "RS-RUNTIME-SELL-SUBMISSION-001",
      input: {
        marketPrice: "12.3",
      },
    })
    assert.equal(result.passed, true, "Production RS runtime evaluator must pass in the isolated worker")
    assert.equal(result.source, "production-runtime-evaluator", "Worker must invoke the production runtime evaluator")
    assert.equal(result.output.submitted, true, "Simulated broker must accept the scenario SELL")
    assert.equal(result.output.brokerSubmissionCallCount, 1, "Only one simulated broker submission may occur")
    assert.ok(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
      "Run-local simulation must persist the SELL intent before broker placement")
    assert.ok(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_OUTCOME"),
      "Run-local simulation must persist the acknowledged simulated SELL outcome")
  } finally {
    await adapter.cancel({ runId })
  }
})
