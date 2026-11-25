import {
  SCENARIO_RUN_STATUS,
  TERMINAL_SCENARIO_RUN_STATUSES,
} from "../../domain/scenario-runner/run-status.js"

const TERMINAL = new Set(TERMINAL_SCENARIO_RUN_STATUSES)

function deepFreeze({ value }) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze({ value: child })
    }
    Object.freeze(value)
  }
  return value
}

function snapshot({ record }) {
  return deepFreeze({
    value: {
      ...record,
      input: record.input === undefined ? undefined : structuredClone(record.input),
      output: record.output === null ? null : structuredClone(record.output),
      diagnostics: [...record.diagnostics],
      transitions: record.transitions.map((transitionItem) => ({ ...transitionItem })),
    },
  })
}

function notify({ record, onUpdate }) {
  if (typeof onUpdate !== "function") {
    return
  }
  try {
    onUpdate(snapshot({ record }))
  } catch {
    // Notifications cannot alter run lifecycle.
  }
}

function transitionRun({ record, status, now, diagnostic, onUpdate }) {
  if (TERMINAL.has(record.status)) {
    return false
  }
  const timestamp = now()
  record.status = status
  record.updatedAt = timestamp
  record.transitions.push({
    status,
    at: timestamp,
  })
  if (diagnostic) {
    record.diagnostics.push(diagnostic)
  }
  if (status === SCENARIO_RUN_STATUS.RUNNING) {
    record.startedAt = timestamp
  }
  if (TERMINAL.has(status)) {
    record.completedAt = timestamp
  }
  notify({
    record,
    onUpdate,
  })
  return true
}

function createBlockedRecord({ runId, strategyId, scenarioId, diagnostic, now }) {
  const timestamp = now()
  return {
    runId,
    strategyId,
    scenarioId,
    status: SCENARIO_RUN_STATUS.BLOCKED,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: timestamp,
    input: null,
    output: null,
    diagnostics: [diagnostic],
    transitions: [{
      status: SCENARIO_RUN_STATUS.BLOCKED,
      at: timestamp,
    }],
  }
}

function createRecord({ runId, strategyId, scenarioId, input, now }) {
  const timestamp = now()
  return {
    runId,
    strategyId,
    scenarioId,
    status: SCENARIO_RUN_STATUS.ACCEPTED,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: null,
    input: input === null ? null : structuredClone(input),
    output: null,
    diagnostics: [],
    transitions: [{
      status: SCENARIO_RUN_STATUS.ACCEPTED,
      at: timestamp,
    }],
  }
}

function createExecutionRace({ adapter, record, controller, timeoutMs }) {
  let timer
  const execution = Promise.resolve().then(() => adapter.execute({
    runId: record.runId,
    scenarioId: record.scenarioId,
    input: structuredClone(record.input),
    signal: controller.signal,
  }))
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  return {
    promise: Promise.race([
      execution.then((output) => ({
        kind: "output",
        output,
      })),
      execution.catch((error) => ({
        kind: "error",
        error,
      })),
      timeout,
    ]).finally(() => clearTimeout(timer)),
  }
}

function pruneHistory({ context }) {
  while (context.records.size >= context.maxStoredRuns) {
    const oldestTerminal = [...context.records.entries()].find(([, record]) => TERMINAL.has(record.status))
    if (!oldestTerminal) {
      return false
    }
    context.records.delete(oldestTerminal[0])
  }
  return true
}

function createWaiter() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return {
    promise,
    resolve,
  }
}

function resolveWaiter({ context, runId, record }) {
  const waiter = context.waiters.get(runId)
  if (!waiter) {
    return
  }
  context.waiters.delete(runId)
  waiter.resolve(snapshot({ record }))
}

function scheduleQueuedRuns({ context }) {
  while (context.queue.length && context.executions.size < context.maxConcurrentRuns) {
    const runId = context.queue.shift()
    const record = context.records.get(runId)
    if (!record || record.status !== SCENARIO_RUN_STATUS.QUEUED) {
      continue
    }
    const adapter = context.adapters.get(record.strategyId)
    if (!adapter) {
      transitionRun({
        record,
        status: SCENARIO_RUN_STATUS.BLOCKED,
        now: context.now,
        onUpdate: context.onUpdate,
        diagnostic: "Queued strategy adapter is no longer available.",
      })
      resolveWaiter({
        context,
        runId,
        record,
      })
      continue
    }
    startExecution({
      context,
      record,
      adapter,
    })
  }
}

async function finishExecution({ context, record, adapter, result }) {
  if (result.kind === "timeout") {
    const cancellationRequested = record.status === SCENARIO_RUN_STATUS.CANCELLING
    context.executions.get(record.runId)?.controller.abort()
    await adapter.cancel({
      runId: record.runId,
      reason: cancellationRequested ? "cancelled" : "timeout",
    })
    transitionRun({
      record,
      status: cancellationRequested
        ? SCENARIO_RUN_STATUS.CANCELLED
        : SCENARIO_RUN_STATUS.TIMED_OUT,
      now: context.now,
      onUpdate: context.onUpdate,
      ...(cancellationRequested ? {} : {
        diagnostic: "Scenario execution exceeded its time limit.",
      }),
    })
  } else if (record.status === SCENARIO_RUN_STATUS.CANCELLING || result.kind === "cancelled") {
    transitionRun({
      record,
      status: SCENARIO_RUN_STATUS.CANCELLED,
      now: context.now,
      onUpdate: context.onUpdate,
    })
  } else if (result.kind === "error") {
    transitionRun({
      record,
      status: SCENARIO_RUN_STATUS.FAILED,
      now: context.now,
      onUpdate: context.onUpdate,
      diagnostic: result.error instanceof Error ? result.error.message : "Scenario execution failed.",
    })
  } else if (!result.output || typeof result.output !== "object") {
    transitionRun({
      record,
      status: SCENARIO_RUN_STATUS.FAILED,
      now: context.now,
      onUpdate: context.onUpdate,
      diagnostic: "Strategy adapter returned an invalid result object.",
    })
  } else {
    record.output = structuredClone(result.output)
    transitionRun({
      record,
      status: SCENARIO_RUN_STATUS.COMPLETED,
      now: context.now,
      onUpdate: context.onUpdate,
    })
  }
  context.executions.delete(record.runId)
  resolveWaiter({
    context,
    runId: record.runId,
    record,
  })
  scheduleQueuedRuns({ context })
  return snapshot({ record })
}

function startExecution({ context, record, adapter }) {
  const controller = new AbortController()
  const race = createExecutionRace({
    adapter,
    record,
    controller,
    timeoutMs: context.timeoutMs,
  })
  context.executions.set(record.runId, {
    controller,
  })
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.STARTING,
    now: context.now,
    onUpdate: context.onUpdate,
  })
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.RUNNING,
    now: context.now,
    onUpdate: context.onUpdate,
  })
  const completion = race.promise.then((result) => finishExecution({
    context,
    record,
    adapter,
    result,
  }))
  context.executions.get(record.runId).completion = completion
  return snapshot({ record })
}

function createCapacityError() {
  return Object.assign(
    new Error("Scenario Runner history capacity is occupied by active executions."),
    {
      status: 429,
      code: "SCENARIO_RUNNER_CAPACITY_REACHED",
    },
  )
}

function registerUnsupportedRun({
  context,
  runId,
  strategyId,
  scenarioId,
  diagnostic = "No registered strategy adapter is available for this run.",
}) {
  const record = createBlockedRecord({
    runId,
    strategyId,
    scenarioId,
    diagnostic,
    now: context.now,
  })
  context.records.set(runId, record)
  notify({
    record,
    onUpdate: context.onUpdate,
  })
  return snapshot({ record })
}

function enqueueRun({ context, record, runId }) {
  if (context.queue.length >= context.maxQueuedRuns) {
    transitionRun({
      record,
      status: SCENARIO_RUN_STATUS.BLOCKED,
      now: context.now,
      onUpdate: context.onUpdate,
      diagnostic: "Scenario queue capacity is full. Retry after an execution completes.",
    })
    return snapshot({ record })
  }
  context.queue.push(runId)
  context.waiters.set(runId, createWaiter())
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.QUEUED,
    now: context.now,
    onUpdate: context.onUpdate,
  })
  return snapshot({ record })
}

function submitRun({ context, submission }) {
  const { strategyId, scenarioId, input = null } = submission ?? {}
  if (typeof strategyId !== "string" || !strategyId.trim() ||
      typeof scenarioId !== "string" || !scenarioId.trim()) {
    throw new TypeError("Scenario Runner submission requires strategy and scenario IDs")
  }
  const runId = context.createRunId()
  if (context.records.has(runId)) {
    throw new Error("Scenario Runner duplicate run ID")
  }
  if (!pruneHistory({ context })) {
    throw createCapacityError()
  }
  const adapter = context.adapters.get(strategyId)
  const scenarioExecutable = context.canExecuteScenario({
    strategyId,
    scenarioId,
  }) === true
  if (!adapter || !scenarioExecutable) {
    return registerUnsupportedRun({
      context,
      runId,
      strategyId,
      scenarioId,
      ...(adapter ? {
        diagnostic: "The registered strategy adapter cannot execute this scenario because it is not marked executable.",
      } : {}),
    })
  }
  const record = createRecord({
    runId,
    strategyId,
    scenarioId,
    input,
    now: context.now,
  })
  context.records.set(runId, record)
  notify({
    record,
    onUpdate: context.onUpdate,
  })
  if (context.executions.size >= context.maxConcurrentRuns) {
    return enqueueRun({
      context,
      record,
      runId,
    })
  }
  return startExecution({
    context,
    record,
    adapter,
  })
}

function cancelQueuedRun({ context, record, runId }) {
  context.queue = context.queue.filter((queuedId) => queuedId !== runId)
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.CANCELLED,
    now: context.now,
    onUpdate: context.onUpdate,
  })
  resolveWaiter({
    context,
    runId,
    record,
  })
  return true
}

function cancelRun({ context, runId }) {
  const record = context.records.get(runId)
  if (!record || TERMINAL.has(record.status)) {
    return false
  }
  if (record.status === SCENARIO_RUN_STATUS.QUEUED) {
    return cancelQueuedRun({
      context,
      record,
      runId,
    })
  }
  const execution = context.executions.get(runId)
  if (!execution) {
    return false
  }
  if (record.status === SCENARIO_RUN_STATUS.CANCELLING) {
    return true
  }
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.CANCELLING,
    now: context.now,
    onUpdate: context.onUpdate,
  })
  execution.controller.abort()
  return true
}

function getRun({ context, runId }) {
  const record = context.records.get(runId)
  return record ? snapshot({ record }) : null
}

function listRuns({ context }) {
  return Object.freeze([...context.records.values()]
    .map((record) => snapshot({ record }))
    .sort((...sortArguments) => {
      const [left, right] = sortArguments
      return right.createdAt.localeCompare(left.createdAt)
    }))
}

async function waitForRun({ context, runId }) {
  const record = context.records.get(runId)
  if (!record) {
    throw new Error("Scenario Runner run does not exist")
  }
  if (TERMINAL.has(record.status)) {
    return snapshot({ record })
  }
  const waiter = context.waiters.get(runId)
  if (waiter) {
    return waiter.promise
  }
  const execution = context.executions.get(runId)
  if (!execution?.completion) {
    throw new Error("Scenario Runner run has no active execution")
  }
  return execution.completion
}

async function closeRunner({ context }) {
  const queuedRunIds = [...context.queue]
  for (const runId of queuedRunIds) {
    cancelRun({
      context,
      runId,
    })
  }
  const activeRunIds = [...context.executions.keys()]
  for (const runId of activeRunIds) {
    cancelRun({
      context,
      runId,
    })
  }
  await Promise.all(activeRunIds.map((runId) => waitForRun({
    context,
    runId,
  }).catch(() => null)))
}

function validateRunnerConfiguration({ adapters, canExecuteScenario, maxStoredRuns, maxConcurrentRuns, maxQueuedRuns, timeoutMs }) {
  if (!Array.isArray(adapters) || adapters.some((adapter) =>
    !adapter || typeof adapter.strategyId !== "string" ||
    typeof adapter.execute !== "function" || typeof adapter.cancel !== "function")) {
    throw new TypeError("Scenario Runner requires valid strategy adapters")
  }
  if (typeof canExecuteScenario !== "function") {
    throw new TypeError("Scenario Runner requires a scenario executability policy")
  }
  if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
    throw new RangeError("Scenario Runner concurrency limit must be a positive integer")
  }
  if (!Number.isSafeInteger(maxQueuedRuns) || maxQueuedRuns < 0) {
    throw new RangeError("Scenario Runner queue limit must be a non-negative integer")
  }
  if (!Number.isSafeInteger(maxStoredRuns) || maxStoredRuns < 1) {
    throw new RangeError("Scenario Runner history limit must be a positive integer")
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Scenario Runner timeout must be positive")
  }
}

function createAdapterMap({ adapters }) {
  const adapterMap = new Map()
  for (const adapter of adapters) {
    if (adapterMap.has(adapter.strategyId)) {
      throw new Error(`Scenario Runner has a duplicate strategy adapter: ${adapter.strategyId}`)
    }
    adapterMap.set(adapter.strategyId, adapter)
  }
  return adapterMap
}

export function createScenarioRunner({
  adapters = [],
  createRunId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  timeoutMs = 30_000,
  maxStoredRuns = 100,
  maxConcurrentRuns = 2,
  maxQueuedRuns = 10,
  canExecuteScenario = () => true,
  onUpdate,
} = {}) {
  validateRunnerConfiguration({
    adapters,
    canExecuteScenario,
    maxStoredRuns,
    maxConcurrentRuns,
    maxQueuedRuns,
    timeoutMs,
  })
  const adapterMap = createAdapterMap({ adapters })
  const context = {
    adapters: adapterMap,
    canExecuteScenario,
    records: new Map(),
    executions: new Map(),
    queue: [],
    waiters: new Map(),
    createRunId,
    now,
    timeoutMs,
    maxStoredRuns,
    maxConcurrentRuns,
    maxQueuedRuns,
    onUpdate,
  }
  return Object.freeze({
    submit: (submission) => submitRun({
      context,
      submission,
    }),
    cancel: (runId) => cancelRun({
      context,
      runId,
    }),
    getRun: (runId) => getRun({
      context,
      runId,
    }),
    listRuns: () => listRuns({ context }),
    waitForRun: (runId) => waitForRun({
      context,
      runId,
    }),
    close: () => closeRunner({
      context,
    }),
  })
}
