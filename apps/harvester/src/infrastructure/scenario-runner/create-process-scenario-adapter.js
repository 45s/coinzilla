import { fileURLToPath } from "node:url"

const DEFAULT_TERMINATION_GRACE_MS = 250
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const TERMINATION_PROMISES = new WeakMap()
const DEFAULT_WORKER_PATH = fileURLToPath(new URL("./scenario-worker.js", import.meta.url))
const REQUIRED_SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
})

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

function serializedMessageBytes(message) {
  try {
    return Buffer.byteLength(JSON.stringify(message) ?? "", "utf8")
  } catch {
    return Number.POSITIVE_INFINITY
  }
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

async function handleWorkerMessage({
  message,
  runId,
  child,
  terminationGraceMs,
  maxOutputBytes,
  finish,
}) {
  let result
  if (serializedMessageBytes(message) > maxOutputBytes) {
    result = {
      error: new Error("Scenario worker result exceeded the maximum output size"),
    }
  } else if (!message || message.runId !== runId) {
    result = {
      error: new Error("Scenario worker returned a mismatched run identity"),
    }
  } else if (message.ok === true && message.output && typeof message.output === "object") {
    result = {
      output: message.output,
    }
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

function createExecutionState({ resolve, reject, children, runId }) {
  let settled = false
  function finish({ error, output }) {
    if (settled) {
      return
    }
    settled = true
    children.delete(runId)
    if (error) {
      reject(error)
    } else {
      resolve(output)
    }
  }
  return {
    finish,
    isSettled: () => settled,
  }
}

function registerWorkerErrorHandler({ child, terminationGraceMs, finish }) {
  child.once("error", (error) => {
    void terminateChild({
      child,
      graceMs: terminationGraceMs,
    }).then(() => finish({ error }))
  })
}

function registerWorkerMessageHandler({
  child,
  runId,
  terminationGraceMs,
  maxOutputBytes,
  finish,
  setMessageReceived,
}) {
  child.once("message", (message) => {
    setMessageReceived()
    void handleWorkerMessage({
      message,
      runId,
      child,
      terminationGraceMs,
      maxOutputBytes,
      finish,
    })
  })
}

function registerWorkerExitHandler({ child, signal, finish, isSettled, hasMessage }) {
  child.once("exit", (...exitArguments) => {
    if (!isSettled() && !hasMessage()) {
      const [code, exitSignal] = exitArguments
      finish({
        error: signal?.aborted
          ? new Error("Scenario worker was cancelled")
          : new Error(`Scenario worker exited without a result (code ${code}, signal ${exitSignal})`),
      })
    }
  })
}

function createExecutionPromise({
  child,
  runId,
  signal,
  children,
  terminationGraceMs,
  maxOutputBytes,
}) {
  let finishExecution
  const promise = new Promise((...settlers) => {
    const [resolve, reject] = settlers
    let messageReceived = false
    let onAbort
    const state = createExecutionState({
      resolve,
      reject,
      children,
      runId,
    })
    function finish(result) {
      signal?.removeEventListener("abort", onAbort)
      state.finish(result)
    }
    onAbort = () => {
      void terminateChild({
        child,
        graceMs: terminationGraceMs,
      }).then(() => finish({
        error: new Error("Scenario worker was cancelled"),
      }))
    }
    finishExecution = finish
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
    }
    registerWorkerErrorHandler({
      child,
      terminationGraceMs,
      finish,
    })
    registerWorkerMessageHandler({
      child,
      runId,
      terminationGraceMs,
      maxOutputBytes,
      finish,
      setMessageReceived: () => {
        messageReceived = true
      },
    })
    registerWorkerExitHandler({
      child,
      signal,
      finish,
      isSettled: state.isSettled,
      hasMessage: () => messageReceived,
    })
  })
  return {
    promise,
    fail: (error) => finishExecution?.({ error }),
  }
}

/**
 * Orchestrate a worker that must be launched by a trusted OS-level sandbox.
 * This module enforces lifecycle and output limits but does not create the
 * filesystem, network, process or memory isolation itself.
 */
function validateProcessScenarioAdapterOptions({
  strategyId,
  spawnSandboxedWorker,
  workerPath,
  terminationGraceMs,
  maxOutputBytes,
}) {
  if (typeof strategyId !== "string" || !strategyId.trim()) {
    throw new TypeError("Process scenario adapter requires strategyId")
  }
  if (typeof spawnSandboxedWorker !== "function") {
    throw new TypeError("Process scenario adapter requires a trusted OS sandbox launcher")
  }
  if (typeof workerPath !== "string" || !workerPath.trim()) {
    throw new TypeError("Process scenario adapter requires workerPath")
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new RangeError("Worker termination grace must be a non-negative integer")
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("Worker output limit must be a positive safe integer")
  }
}

function createWorkerExecutor({
  strategyId,
  spawnSandboxedWorker,
  workerPath,
  terminationGraceMs,
  maxOutputBytes,
  children,
}) {
  return async function execute({ runId, scenarioId, input, signal } = {}) {
    if (signal?.aborted) {
      throw new Error("Scenario worker execution was cancelled before startup")
    }
    const sandboxProfile = Object.freeze({
      ...REQUIRED_SANDBOX_PROFILE,
      maxOutputBytes,
    })
    const child = spawnSandboxedWorker({
      workerPath,
      env: createWorkerEnvironment(),
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      sandboxProfile,
    })
    if (!child || typeof child.send !== "function" ||
      typeof child.once !== "function" || typeof child.kill !== "function") {
      throw new TypeError("OS sandbox launcher must return a ChildProcess-compatible worker")
    }
    children.set(runId, child)
    const execution = createExecutionPromise({
      child,
      runId,
      signal,
      children,
      terminationGraceMs,
      maxOutputBytes,
    })
    try {
      child.send({
        runId,
        strategyId,
        scenarioId,
        input,
      })
    } catch (error) {
      void terminateChild({
        child,
        graceMs: terminationGraceMs,
      }).then(() => execution.fail(error))
    }
    return execution.promise
  }
}

function createWorkerCanceller({ children, terminationGraceMs }) {
  return async function cancel({ runId } = {}) {
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
}

export function createProcessScenarioAdapter(options = {}) {
  const resolvedOptions = {
    ...options,
    workerPath: options.workerPath ?? DEFAULT_WORKER_PATH,
    terminationGraceMs: options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  validateProcessScenarioAdapterOptions(resolvedOptions)
  const children = new Map()
  return Object.freeze({
    strategyId: resolvedOptions.strategyId,
    execute: createWorkerExecutor({
      ...resolvedOptions,
      children,
    }),
    cancel: createWorkerCanceller({
      children,
      terminationGraceMs: resolvedOptions.terminationGraceMs,
    }),
  })
}
