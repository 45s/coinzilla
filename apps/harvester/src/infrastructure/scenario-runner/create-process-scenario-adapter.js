import { realpathSync, statSync } from "node:fs"
import { extname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isNodeGuardedSimulationLauncher } from "./create-node-guarded-simulation-launcher.js"

const DEFAULT_TERMINATION_GRACE_MS = 250
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const TERMINATION_PROMISES = new WeakMap()
const DEFAULT_WORKER_PATH = fileURLToPath(new URL("./scenario-worker.js", import.meta.url))
const WORKER_DIRECTORY = realpathSync(fileURLToPath(new URL(".", import.meta.url)))
const REQUIRED_SANDBOX_PROFILE = Object.freeze({
  networkAccess: "deny",
  filesystemAccess: "read-only-allowlisted-runtime",
  processExecution: "deny-child-processes",
  memoryLimitBytes: 268_435_456,
  cpuTimeLimitMs: 30_000,
  wallTimeLimitMs: 30_000,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
})


/**
 * A launcher may attach this attestation only after applying and verifying
 * the required OS-level profile. Node module guards do not satisfy this contract.
 */
function hasTrustedSandboxIdentity({ attestation }) {
  const digestFields = [
    "bwrapSha256",
    "prlimitSha256",
    "shellSha256",
    "nodeRuntimeSha256",
  ]
  return attestation.cgroupV2Verified === true && digestFields.every((field) =>
    typeof attestation[field] === "string" && /^[a-f0-9]{64}$/i.test(attestation[field]))
}

function hasVerifiedSandboxAttestation({ spawnSandboxedWorker, maxOutputBytes }) {
  const attestation = spawnSandboxedWorker.isolationAttestation
  if (!attestation || attestation.level !== "os") {
    return false
  }
  const expectedProfile = {
    ...REQUIRED_SANDBOX_PROFILE,
    maxOutputBytes,
  }
  return Object.entries(expectedProfile).every(([key, value]) => attestation[key] === value) &&
    hasTrustedSandboxIdentity({ attestation })
}

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

function isChildAlive({ child }) {
  return child.exitCode === null && child.signalCode === null
}

function createForcedTermination({ child, finish, fail, schedule }) {
  return function forceKill({ signal }) {
    if (!isChildAlive({ child })) {
      finish()
      return
    }
    try {
      child.kill(signal)
    } catch (cause) {
      if (signal === "SIGTERM") {
        forceKill({ signal: "SIGKILL" })
        return
      }
      fail({ cause })
      return
    }
    if (signal === "SIGTERM") {
      schedule({
        callback: () => forceKill({ signal: "SIGKILL" }),
      })
      return
    }
    schedule({
      callback: () => {
        if (isChildAlive({ child })) {
          fail({ cause: new Error("Worker did not exit after SIGKILL") })
        } else {
          finish()
        }
      },
    })
  }
}

function createTerminationController({ child, graceMs, resolve, reject }) {
  const timers = new Set()
  let settled = false
  function clearTimers() {
    for (const timer of timers) {
      clearTimeout(timer)
    }
    timers.clear()
  }
  function finish() {
    if (settled) {
      return
    }
    settled = true
    clearTimers()
    resolve()
  }
  function fail({ cause }) {
    if (settled) {
      return
    }
    if (!isChildAlive({ child })) {
      finish()
      return
    }
    settled = true
    clearTimers()
    reject(Object.assign(
      new Error("Scenario worker cleanup could not be confirmed", { cause }),
      { cleanupConfirmed: false },
    ))
  }
  function schedule({ callback }) {
    const timer = setTimeout(callback, graceMs)
    timers.add(timer)
  }
  const forceKill = createForcedTermination({
    child,
    finish,
    fail,
    schedule,
  })
  return {
    finish,
    fail,
    forceKill,
    schedule,
  }
}

function terminateChild({ child, graceMs, cooperative = false, runId }) {
  if (!isChildAlive({ child })) {
    return Promise.resolve()
  }
  const existingTermination = TERMINATION_PROMISES.get(child)
  if (existingTermination) {
    return existingTermination
  }
  const termination = new Promise((...settlers) => {
    const [resolve, reject] = settlers
    const controller = createTerminationController({
      child,
      graceMs,
      resolve,
      reject,
    })
    child.once("close", controller.finish)
    if (cooperative) {
      try {
        child.send({
          type: "cancel",
          runId,
        })
      } catch {
        controller.forceKill({ signal: "SIGTERM" })
        return
      }
      controller.schedule({
        callback: () => controller.forceKill({ signal: "SIGTERM" }),
      })
      return
    }
    controller.forceKill({ signal: "SIGTERM" })
  })
  TERMINATION_PROMISES.set(child, termination)
  void termination.catch(() => TERMINATION_PROMISES.delete(child))
  return termination
}

async function handleWorkerMessage({
  message,
  runId,
  child,
  terminationGraceMs,
  maxOutputBytes,
  finish,
  signal,
}) {
  if (signal?.aborted) {
    return
  }
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
  try {
    await terminateChild({
      child,
      graceMs: terminationGraceMs,
    })
  } catch (error) {
    finish({
      error,
      preserveChild: true,
    })
    return
  }
  finish(result)
}

function confirmSandboxCleanup({ child }) {
  if (typeof child.sandboxCleanup !== "function") {
    if (child.sandboxCleanupError) {
      throw new Error("Scenario sandbox cgroup cleanup could not be confirmed", {
        cause: child.sandboxCleanupError,
      })
    }
    return
  }
  try {
    child.sandboxCleanup()
    delete child.sandboxCleanupError
  } catch (cause) {
    child.sandboxCleanupError = cause
    throw new Error("Scenario sandbox cgroup cleanup could not be confirmed", {
      cause,
    })
  }
}

function createExecutionState({ resolve, reject, children, runId, child }) {
  let settled = false
  function finish({ error, output, preserveChild = false }) {
    if (settled) {
      return
    }
    let finalError = error
    let retainChild = preserveChild
    try {
      confirmSandboxCleanup({ child })
    } catch (cleanupError) {
      finalError = error
        ? new AggregateError([error, cleanupError], "Scenario worker failed and sandbox cgroup cleanup could not be confirmed", {
          cause: error,
        })
        : cleanupError
      retainChild = true
    }
    settled = true
    if (!retainChild) {
      children.delete(runId)
    }
    if (finalError) {
      reject(finalError)
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
    }).then(() => finish({ error })).catch((cleanupError) => finish({
      error: cleanupError,
      preserveChild: true,
    }))
  })
}

function registerWorkerMessageHandler({
  child,
  runId,
  terminationGraceMs,
  maxOutputBytes,
  finish,
  setMessageReceived,
  signal,
  onReady,
  onStarted,
}) {
  let readyReceived = false
  let startedReceived = false
  const handleMessage = (message) => {
    if (message?.type === "ready") {
      if (!readyReceived) {
        readyReceived = true
        onReady()
      }
      return
    }
    if (message?.type === "started" && readyReceived && !startedReceived && message.runId === runId) {
      startedReceived = true
      // Bootstrap readiness is not execution; only this acknowledgement advances lifecycle.
      onStarted()
      return
    }
    child.off("message", handleMessage)
    setMessageReceived()
    void handleWorkerMessage({
      message: startedReceived
        ? message
        : {
          runId,
          ok: false,
          error: readyReceived
            ? "Scenario worker returned a result before confirming execution start"
            : "Scenario worker returned a result before confirming readiness",
        },
      runId,
      child,
      terminationGraceMs,
      maxOutputBytes,
      finish,
      signal,
    })
  }
  child.on("message", handleMessage)
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

function createAbortAwareFinish({ signal, child, runId, terminationGraceMs, finish }) {
  function onAbort() {
    void terminateChild({
      child,
      runId,
      graceMs: terminationGraceMs,
      cooperative: true,
    }).then(() => finishWithCleanup({
      error: new Error("Scenario worker was cancelled"),
    })).catch((error) => finishWithCleanup({
      error,
      preserveChild: true,
    }))
  }
  function finishWithCleanup(result) {
    signal?.removeEventListener("abort", onAbort)
    finish(result)
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) {
    onAbort()
  }
  return finishWithCleanup
}

function registerExecutionLifecycleHandlers({
  child,
  runId,
  signal,
  terminationGraceMs,
  maxOutputBytes,
  finish,
  state,
  onReady,
  onStarted,
}) {
  let messageReceived = false
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
    signal,
    onReady,
    onStarted,
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
}

function createExecutionPromise({
  child,
  runId,
  signal,
  children,
  terminationGraceMs,
  maxOutputBytes,
  onReady,
  onStarted,
}) {
  let finishExecution
  const promise = new Promise((...settlers) => {
    const [resolve, reject] = settlers
    const state = createExecutionState({
      resolve,
      reject,
      children,
      runId,
      child,
    })
    const finish = createAbortAwareFinish({
      signal,
      child,
      runId,
      terminationGraceMs,
      finish: state.finish,
    })
    finishExecution = finish
    registerExecutionLifecycleHandlers({
      child,
      runId,
      signal,
      terminationGraceMs,
      maxOutputBytes,
      finish,
      state,
      onReady,
      onStarted,
    })
  })
  return {
    promise,
    fail: ({ error, preserveChild = false } = {}) => finishExecution?.({
      error,
      preserveChild,
    }),
  }
}

/**
 * Orchestrate a worker launched by an OS sandbox or trusted simulation launcher.
 * This module enforces lifecycle and output limits but does not create OS isolation.
 */


function resolveWorkerScriptPath({ workerPath }) {
  let resolvedWorkerPath
  try {
    resolvedWorkerPath = realpathSync(resolvePath(workerPath))
  } catch {
    throw new TypeError("Process scenario worker path must resolve inside the scenario worker directory")
  }
  const relativeWorkerPath = relative(WORKER_DIRECTORY, resolvedWorkerPath)
  const outsideWorkerDirectory = relativeWorkerPath === ".." ||
    relativeWorkerPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeWorkerPath)
  const regularJavaScriptFile = extname(resolvedWorkerPath) === ".js" &&
    statSync(resolvedWorkerPath).isFile()
  if (outsideWorkerDirectory || !regularJavaScriptFile) {
    throw new TypeError("Process scenario worker path must be inside the scenario worker directory and use .js")
  }
  return resolvedWorkerPath
}

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
    throw new TypeError("Process scenario adapter requires a worker launcher")
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
  return {
    strategyId,
    spawnSandboxedWorker,
    workerPath: resolveWorkerScriptPath({ workerPath }),
    terminationGraceMs,
    maxOutputBytes,
  }
}

function spawnScenarioWorker({ spawnSandboxedWorker, workerPath, maxOutputBytes }) {
  const sandboxProfile = Object.freeze({
    ...REQUIRED_SANDBOX_PROFILE,
    maxOutputBytes,
  })
  return spawnSandboxedWorker({
    workerPath,
    env: createWorkerEnvironment(),
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    sandboxProfile,
  })
}

function assertWorkerCanStart({ osSandboxVerified, simulationBoundaryVerified, signal }) {
  if (!osSandboxVerified && !simulationBoundaryVerified) {
    throw new Error("OS-level sandbox isolation has not been verified and no trusted guarded-simulation worker is registered")
  }
  if (signal?.aborted) {
    throw new Error("Scenario worker execution was cancelled before startup")
  }
}

function confirmWorkerExecutionStarted({ signal, onStarted }) {
  if (signal?.aborted) {
    return false
  }
  if (typeof onStarted === "function") {
    onStarted()
  }
  return true
}

function dispatchScenarioExecution({
  child,
  execution,
  runId,
  strategyId,
  scenarioId,
  input,
  terminationGraceMs,
}) {
  try {
    child.send({
      type: "execute",
      runId,
      strategyId,
      scenarioId,
      input,
    })
  } catch (error) {
    void terminateChild({
      child,
      graceMs: terminationGraceMs,
    }).then(() => execution.fail({
      error,
    })).catch((cleanupError) => execution.fail({
      error: cleanupError,
      preserveChild: true,
    }))
  }
}
function retainSandboxCleanupHandle({ error, children, runId }) {
  const cleanupHandle = error?.sandboxCleanupHandle
  if (cleanupHandle && typeof cleanupHandle === "object") {
    children.set(runId, cleanupHandle)
  }
}

function spawnScenarioWorkerAndRetainFailure({
  spawnSandboxedWorker,
  workerPath,
  maxOutputBytes,
  children,
  runId,
}) {
  try {
    return spawnScenarioWorker({
      spawnSandboxedWorker,
      workerPath,
      maxOutputBytes,
    })
  } catch (error) {
    retainSandboxCleanupHandle({
      error,
      children,
      runId,
    })
    throw error
  }
}

function assertWorkerChildCompatible({ child }) {
  if (!child || typeof child.send !== "function" ||
    typeof child.once !== "function" || typeof child.kill !== "function") {
    throw new TypeError("OS sandbox launcher must return a ChildProcess-compatible worker")
  }
}

function createWorkerExecutionPromise({
  child,
  runId,
  signal,
  children,
  terminationGraceMs,
  maxOutputBytes,
  strategyId,
  scenarioId,
  input,
  onStarted,
}) {
  const execution = createExecutionPromise({
    child,
    runId,
    signal,
    children,
    terminationGraceMs,
    maxOutputBytes,
    onReady: () => {
      if (signal?.aborted) {
        return
      }
      dispatchScenarioExecution({
        child,
        execution,
        runId,
        strategyId,
        scenarioId,
        input,
        terminationGraceMs,
      })
    },
    onStarted: () => {
      confirmWorkerExecutionStarted({
        signal,
        onStarted,
      })
    },
  })
  return execution.promise
}

function createWorkerExecutor({
  strategyId,
  spawnSandboxedWorker,
  workerPath,
  terminationGraceMs,
  maxOutputBytes,
  children,
  osSandboxVerified,
  simulationBoundaryVerified,
}) {
  return async function execute({ runId, scenarioId, input, signal, onStarted } = {}) {
    assertWorkerCanStart({
      osSandboxVerified,
      simulationBoundaryVerified,
      signal,
    })
    const child = spawnScenarioWorkerAndRetainFailure({
      spawnSandboxedWorker,
      workerPath,
      maxOutputBytes,
      children,
      runId,
    })
    assertWorkerChildCompatible({ child })
    children.set(runId, child)
    return createWorkerExecutionPromise({
      child,
      runId,
      signal,
      children,
      terminationGraceMs,
      maxOutputBytes,
      strategyId,
      scenarioId,
      input,
      onStarted,
    })
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
      runId,
      graceMs: terminationGraceMs,
      cooperative: true,
    })
    confirmSandboxCleanup({ child })
    children.delete(runId)
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
  const validatedOptions = validateProcessScenarioAdapterOptions(resolvedOptions)
  const children = new Map()
  const osSandboxVerified = hasVerifiedSandboxAttestation({
    spawnSandboxedWorker: validatedOptions.spawnSandboxedWorker,
    maxOutputBytes: validatedOptions.maxOutputBytes,
  })
  const simulationBoundaryVerified = isNodeGuardedSimulationLauncher({
    launcher: validatedOptions.spawnSandboxedWorker,
  })
  return Object.freeze({
    strategyId: validatedOptions.strategyId,
    executionMode: "simulation-only",
    osSandboxVerified,
    simulationBoundaryVerified,
    execute: createWorkerExecutor({
      ...validatedOptions,
      children,
      osSandboxVerified,
      simulationBoundaryVerified,
    }),
    cancel: createWorkerCanceller({
      children,
      terminationGraceMs: validatedOptions.terminationGraceMs,
    }),
  })
}
