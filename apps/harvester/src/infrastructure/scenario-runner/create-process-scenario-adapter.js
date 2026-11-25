import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

const DEFAULT_TERMINATION_GRACE_MS = 250
const TERMINATION_PROMISES = new WeakMap()

function createWorkerEnvironment() {
  const environment = {}
  for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "windir"]) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key]
    }
  }
  environment.SCENARIO_RUN_WORKER = "1"
  return environment
}

function terminateChild({ child, graceMs }) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  const existingTermination = TERMINATION_PROMISES.get(child)
  if (existingTermination) {
    return existingTermination
  }
  const termination = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL")
      }
    }, graceMs)
    timer.unref?.()
    function finish() {
      clearTimeout(timer)
      resolve()
    }
    child.once("close", finish)
    try {
      child.kill("SIGTERM")
    } catch {
      finish()
    }
  })
  TERMINATION_PROMISES.set(child, termination)
  return termination
}

async function handleWorkerMessage({ message, runId, child, terminationGraceMs, finish }) {
  let result
  if (!message || message.runId !== runId) {
    result = {
      error: new Error("Scenario worker returned a mismatched run identity"),
    }
  } else if (message.ok === true && message.output && typeof message.output === "object") {
    result = { output: message.output }
  } else {
    result = {
      error: new Error(typeof message.error === "string" ? message.error : "Scenario worker failed"),
    }
  }
  await terminateChild({
    child,
    graceMs: terminationGraceMs,
  })
  finish(result)
}

function createExecutionPromise({ child, runId, signal, children, terminationGraceMs }) {
  return new Promise((...promiseArguments) => {
    const [resolve, reject] = promiseArguments
    let settled = false
    let messageReceived = false
    function finish({ error, output }) {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener("abort", onAbort)
      children.delete(runId)
      if (error) {
        reject(error)
      } else {
        resolve(output)
      }
    }
    function onAbort() {
      void terminateChild({
        child,
        graceMs: terminationGraceMs,
      }).then(() => finish({
        error: new Error("Scenario worker was cancelled"),
      }))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    child.once("error", (error) => {
      void terminateChild({
        child,
        graceMs: terminationGraceMs,
      }).then(() => finish({ error }))
    })
    child.once("message", (message) => {
      messageReceived = true
      void handleWorkerMessage({
        message,
        runId,
        child,
        terminationGraceMs,
        finish,
      })
    })
    child.once("exit", (...exitArguments) => {
      if (!settled && !messageReceived) {
        const [code, exitSignal] = exitArguments
        finish({
          error: signal?.aborted
            ? new Error("Scenario worker was cancelled")
            : new Error(`Scenario worker exited without a result (code ${code}, signal ${exitSignal})`),
        })
      }
    })
  })
}

/**
 * Compose a process-isolated adapter. Workers receive the run request over IPC
 * and a minimal environment rather than inheriting Harvester credentials.
 */
export function createProcessScenarioAdapter({
  strategyId,
  workerPath = fileURLToPath(new URL("./scenario-worker.js", import.meta.url)),
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
} = {}) {
  if (typeof strategyId !== "string" || !strategyId.trim()) {
    throw new TypeError("Process scenario adapter requires strategyId")
  }
  if (typeof workerPath !== "string" || !workerPath.trim()) {
    throw new TypeError("Process scenario adapter requires workerPath")
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new RangeError("Worker termination grace must be a non-negative integer")
  }
  const children = new Map()

  async function execute({ runId, scenarioId, input, signal } = {}) {
    if (signal?.aborted) {
      throw new Error("Scenario worker execution was cancelled before startup")
    }
    const child = fork(workerPath, [], {
      env: createWorkerEnvironment(),
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    })
    children.set(runId, child)
    const execution = createExecutionPromise({
      child,
      runId,
      signal,
      children,
      terminationGraceMs,
    })
    child.send({
      runId,
      strategyId,
      scenarioId,
      input,
    })
    return execution
  }

  async function cancel({ runId } = {}) {
    const child = children.get(runId)
    if (!child) {
      return false
    }
    await terminateChild({
      child,
      graceMs: terminationGraceMs,
    })
    return true
  }

  return Object.freeze({
    strategyId,
    execute,
    cancel,
  })
}
