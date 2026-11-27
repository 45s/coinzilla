import { createHash } from "node:crypto"
import { redactScenarioEvidence } from "./redact-scenario-evidence.js"
import {
  SCENARIO_RUN_STATUS,
  TERMINAL_SCENARIO_RUN_STATUSES,
} from "../../domain/scenario-runner/run-status.js"

const TERMINAL = new Set(TERMINAL_SCENARIO_RUN_STATUSES)

function createJsonDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function createScenarioIdentity({
  strategyId,
  scenarioId,
}) {
  return `${strategyId}/${scenarioId}`
}

function collectMissingReplayProvenance({ identity, replayProvenance, sourceRevision }) {
  const missing = new Set(replayProvenance?.missing ?? [])
  const requiredHashes = [
    ["sourceCommitSha", /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i],
    ["checkedOutCommitSha", /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i],
    ["sourceTreeSha", /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i],
    ["dependencyLockSha256", /^[a-f0-9]{64}$/i],
    ["buildArtifactSha256", /^[a-f0-9]{64}$/i],
    ["scenarioRegistrySha256", /^[a-f0-9]{64}$/i],
  ]
  for (const [field, pattern] of requiredHashes) {
    if (typeof identity[field] !== "string" || !pattern.test(identity[field])) {
      missing.add(`verified ${field} is unavailable`)
    }
  }
  const missingRuntimeIdentity = typeof identity.runtimeIdentity !== "string" ||
    !identity.runtimeIdentity.trim()
  if (missingRuntimeIdentity) {
    missing.add("runtime identity is unavailable")
  }
  if (replayProvenance?.verified === true) {
    missing.add("caller-supplied verified replay provenance claim is not trusted")
  } else {
    missing.add("trusted build-artifact verification is not integrated into the Scenario Runner trust boundary")
  }
  if (sourceRevision && identity.sourceCommitSha !== sourceRevision) {
    missing.add("active source commit does not match the recorded source revision")
  }
  return missing
}

function normalizeReplayProvenance({
  replayProvenance,
  sourceRevision,
}) {
  const identity = replayProvenance?.identity ?? {}
  const missing = collectMissingReplayProvenance({
    identity,
    replayProvenance,
    sourceRevision,
  })
  return {
    verified: missing.size === 0,
    missing: [...missing],
    identity: {
      sourceCommitSha: identity.sourceCommitSha ?? null,
      checkedOutCommitSha: identity.checkedOutCommitSha ?? null,
      sourceTreeSha: identity.sourceTreeSha ?? null,
      dependencyLockSha256: identity.dependencyLockSha256 ?? null,
      buildArtifactSha256: identity.buildArtifactSha256 ?? null,
      runtimeIdentity: identity.runtimeIdentity ?? null,
      scenarioRegistrySha256: identity.scenarioRegistrySha256 ?? null,
    },
  }
}

function appendUnverifiedProvenanceReasons({ missing, provenance, unavailableReason }) {
  if (provenance?.verified !== true) {
    missing.push(...(provenance?.missing ?? [unavailableReason]))
  }
}

function hasMatchingReplayInput({ original }) {
  const originalInput = original.replayInput ?? original.input
  return Boolean(original.inputSha256) &&
    createJsonDigest(originalInput) === original.inputSha256
}

function hasMatchingReplayScenarioIdentity({ original }) {
  const scenarioIdentity = createScenarioIdentity({
    strategyId: original.strategyId,
    scenarioId: original.scenarioId,
  })
  return original.scenarioIdentity === scenarioIdentity
}

function collectReplayBlockReasons({ original, context }) {
  const missing = []
  const originalProvenance = original.replayProvenance
  const activeProvenance = context.replayProvenance
  appendUnverifiedProvenanceReasons({
    missing,
    provenance: originalProvenance,
    unavailableReason: "original run provenance is unavailable",
  })
  appendUnverifiedProvenanceReasons({
    missing,
    provenance: activeProvenance,
    unavailableReason: "active runtime provenance is unavailable",
  })
  if (JSON.stringify(originalProvenance?.identity) !==
      JSON.stringify(activeProvenance?.identity)) {
    missing.push("active source/build/runtime/registry provenance differs from the original run")
  }
  if (!hasMatchingReplayInput({ original })) {
    missing.push("original scenario input identity cannot be verified")
  }
  if (!hasMatchingReplayScenarioIdentity({ original })) {
    missing.push("original strategy/scenario identity cannot be verified")
  }
  return missing
}
function createReplayBlockDiagnostic({ original, context }) {
  const missing = collectReplayBlockReasons({
    original,
    context,
  })
  return missing.length
    ? `Exact replay is blocked because provenance is incomplete or mismatched: ${[...new Set(missing)].join("; ")}.`
    : null
}

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
    record.diagnostics.push(redactScenarioEvidence(diagnostic))
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

function createBlockedRecord({
  runId,
  strategyId,
  scenarioId,
  diagnostic,
  now,
  sourceRevision = null,
  replayOfRunId = null,
  input = null,
  replayProvenance = null,
}) {
  const timestamp = now()
  return {
    runId,
    strategyId,
    scenarioId,
    scenarioIdentity: createScenarioIdentity({
      strategyId,
      scenarioId,
    }),
    inputSha256: createJsonDigest(input),
    replayProvenance: replayProvenance === null ? null : structuredClone(replayProvenance),
    sourceRevision,
    replayOfRunId,
    status: SCENARIO_RUN_STATUS.BLOCKED,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: timestamp,
    input: redactScenarioEvidence(input),
    output: null,
    diagnostics: [redactScenarioEvidence(diagnostic)],
    transitions: [{
      status: SCENARIO_RUN_STATUS.BLOCKED,
      at: timestamp,
    }],
  }
}

function createRecord({
  runId,
  strategyId,
  scenarioId,
  input,
  now,
  sourceRevision,
  replayOfRunId = null,
  replayProvenance,
}) {
  const timestamp = now()
  const record = {
    runId,
    strategyId,
    scenarioId,
    scenarioIdentity: createScenarioIdentity({
      strategyId,
      scenarioId,
    }),
    inputSha256: createJsonDigest(input),
    replayProvenance: structuredClone(replayProvenance),
    sourceRevision,
    replayOfRunId,
    status: SCENARIO_RUN_STATUS.ACCEPTED,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: null,
    input: redactScenarioEvidence(input),
    output: null,
    diagnostics: [],
    transitions: [{
      status: SCENARIO_RUN_STATUS.ACCEPTED,
      at: timestamp,
    }],
  }
  Object.defineProperty(record, "executionInput", {
    value: input === null ? null : structuredClone(input),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(record, "replayInput", {
    value: input === null ? null : structuredClone(input),
    configurable: false,
    writable: false,
  })
  return record
}

function createExecutionRace({ adapter, record, controller, timeoutMs, onStarted }) {
  let timer
  const executionInput = structuredClone(record.executionInput ?? record.input)
  const execution = Promise.resolve().then(() => adapter.execute({
    runId: record.runId,
    scenarioId: record.scenarioId,
    input: executionInput,
    signal: controller.signal,
    onStarted,
  }))
  const executionResult = execution.then(
    (output) => ({
      kind: "output",
      output,
    }),
    (error) => ({
      kind: "error",
      error,
    }),
  )
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  return {
    promise: Promise.race([
      executionResult,
      timeout,
    ]).finally(() => clearTimeout(timer)),
  }
}

function pruneHistory({ context }) {
  while (context.records.size >= context.maxStoredRuns) {
    const oldestTerminal = [...context.records.entries()].find(([runId, record]) =>
      TERMINAL.has(record.status) && !context.executions.has(runId))
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
      delete record.executionInput
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


function createCleanupFailureDiagnostic({ error, cancellationRequested, timedOut = false }) {
  const cleanupMessage = error instanceof Error ? error.message : "Unknown cleanup error."
  let reason = "Scenario execution failed"
  if (cancellationRequested) {
    reason = "Scenario cancellation was requested"
  } else if (timedOut) {
    reason = "Scenario execution exceeded its time limit"
  }
  return `${reason}; worker cleanup could not be confirmed: ${cleanupMessage}`
}

function finishUnconfirmedCleanup({ context, record, error, cancellationRequested, timedOut = false, status }) {
  transitionRun({
    record,
    status,
    now: context.now,
    onUpdate: context.onUpdate,
    diagnostic: createCleanupFailureDiagnostic({
      error,
      cancellationRequested,
      timedOut,
    }),
  })
  const execution = context.executions.get(record.runId)
  if (execution) {
    execution.cleanupUnconfirmed = true
  }
  resolveWaiter({
    context,
    runId: record.runId,
    record,
  })
  // Keep the execution slot occupied until worker termination is confirmed.
  return snapshot({ record })
}

async function retryUnconfirmedCleanup({ context, record, runId, execution }) {
  try {
    const cleanupConfirmed = await execution.adapter.cancel({
      runId,
      reason: "cleanup-retry",
    })
    if (cleanupConfirmed !== true) {
      throw new Error("The adapter did not confirm worker termination.")
    }
  } catch (error) {
    record.diagnostics.push(redactScenarioEvidence(
      `Worker cleanup retry failed: ${error instanceof Error ? error.message : "Unknown cleanup error."}`,
    ))
    record.updatedAt = context.now()
    notify({
      record,
      onUpdate: context.onUpdate,
    })
    return false
  }
  context.executions.delete(runId)
  record.diagnostics.push("Worker cleanup was confirmed by a retry.")
  record.updatedAt = context.now()
  notify({
    record,
    onUpdate: context.onUpdate,
  })
  scheduleQueuedRuns({ context })
  return true
}

async function finishTimedOutExecution({ context, record, adapter }) {
  const cancellationRequested = record.status === SCENARIO_RUN_STATUS.CANCELLING
  context.executions.get(record.runId)?.controller.abort()
  try {
    const cleanupConfirmed = await adapter.cancel({
      runId: record.runId,
      reason: cancellationRequested ? "cancelled" : "timeout",
    })
    if (cleanupConfirmed !== true) {
      throw new Error("The adapter did not confirm worker termination.")
    }
  } catch (error) {
    return finishUnconfirmedCleanup({
      context,
      record,
      error,
      cancellationRequested,
      timedOut: !cancellationRequested,
      status: cancellationRequested
        ? SCENARIO_RUN_STATUS.FAILED
        : SCENARIO_RUN_STATUS.TIMED_OUT,
    })
  }
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
  return null
}

function failUnstartedExecution({ context, record }) {
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.FAILED,
    now: context.now,
    onUpdate: context.onUpdate,
    diagnostic: "Strategy adapter completed without confirming isolated worker readiness.",
  })
}

function finishExecutionResult({ context, record, result }) {
  if (record.status === SCENARIO_RUN_STATUS.CANCELLING || result.kind === "cancelled") {
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
  } else if (record.status === SCENARIO_RUN_STATUS.STARTING) {
    failUnstartedExecution({
      context,
      record,
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
    record.output = redactScenarioEvidence(result.output)
    transitionRun({
      record,
      status: SCENARIO_RUN_STATUS.COMPLETED,
      now: context.now,
      onUpdate: context.onUpdate,
    })
  }
}

async function finishExecution({ context, record, adapter, result }) {
  if (result.kind === "timeout") {
    const cleanupFailure = await finishTimedOutExecution({
      context,
      record,
      adapter,
    })
    if (cleanupFailure) {
      return cleanupFailure
    }
  } else if (result.kind === "error" && result.error?.cleanupConfirmed === false) {
    return finishUnconfirmedCleanup({
      context,
      record,
      error: result.error,
      cancellationRequested: record.status === SCENARIO_RUN_STATUS.CANCELLING,
      status: SCENARIO_RUN_STATUS.FAILED,
    })
  } else {
    finishExecutionResult({
      context,
      record,
      result,
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
  context.executions.set(record.runId, {
    controller,
    adapter,
  })
  const race = createExecutionRace({
    adapter,
    record,
    controller,
    timeoutMs: context.timeoutMs,
    onStarted: () => {
      if (record.status === SCENARIO_RUN_STATUS.STARTING && !controller.signal.aborted) {
        transitionRun({
          record,
          status: SCENARIO_RUN_STATUS.RUNNING,
          now: context.now,
          onUpdate: context.onUpdate,
        })
      }
    },
  })
  delete record.executionInput
  transitionRun({
    record,
    status: SCENARIO_RUN_STATUS.STARTING,
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

function createInputValidationError({ errors }) {
  const message = errors.length > 0
    ? errors.join("\n")
    : "Scenario input does not satisfy the registered schema."
  return Object.assign(new Error(message), {
    status: 400,
    code: "SCENARIO_RUNNER_INPUT_INVALID",
  })
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
  replayOfRunId = null,
  input = null,
}) {
  const record = createBlockedRecord({
    runId,
    strategyId,
    scenarioId,
    diagnostic,
    now: context.now,
    sourceRevision: context.sourceRevision,
    replayOfRunId,
    input,
    replayProvenance: context.replayProvenance,
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
    delete record.executionInput
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

function validateSubmission({ submission }) {
  const { strategyId, scenarioId, input = null } = submission ?? {}
  if (typeof strategyId !== "string" || !strategyId.trim() ||
      typeof scenarioId !== "string" || !scenarioId.trim()) {
    throw Object.assign(
      new TypeError("Scenario Runner submission requires strategy and scenario IDs"),
      {
        status: 400,
        code: "SCENARIO_RUNNER_SUBMISSION_INVALID",
      },
    )
  }
  return {
    strategyId,
    scenarioId,
    input,
  }
}

function resolveExecutableAdapter({ context, strategyId, scenarioId }) {
  const adapter = context.adapters.get(strategyId)
  const executable = context.canExecuteScenario({
    strategyId,
    scenarioId,
  }) === true
  return {
    adapter,
    executable,
  }
}

function registerUnexecutableSubmission({ context, runId, strategyId, scenarioId, adapter, replayOfRunId = null, input = null }) {
  if (!pruneHistory({ context })) {
    throw createCapacityError()
  }
  const diagnostic = adapter
    ? "The registered strategy adapter cannot execute this scenario because it is not marked executable."
    : undefined
  return registerUnsupportedRun({
    context,
    runId,
    strategyId,
    scenarioId,
    ...(diagnostic ? { diagnostic } : {}),
    replayOfRunId,
    input,
  })
}

function createAcceptedRun({ context, runId, strategyId, scenarioId, input, replayOfRunId = null }) {
  if (!pruneHistory({ context })) {
    throw createCapacityError()
  }
  const record = createRecord({
    runId,
    strategyId,
    scenarioId,
    input,
    now: context.now,
    sourceRevision: context.sourceRevision,
    replayOfRunId,
    replayProvenance: context.replayProvenance,
  })
  context.records.set(runId, record)
  notify({
    record,
    onUpdate: context.onUpdate,
  })
  return record
}

function scheduleAcceptedRun({ context, record, adapter }) {
  if (context.executions.size >= context.maxConcurrentRuns) {
    return enqueueRun({
      context,
      record,
      runId: record.runId,
    })
  }
  return startExecution({
    context,
    record,
    adapter,
  })
}

function submitRun({ context, submission, replayOfRunId = null }) {
  const { strategyId, scenarioId, input } = validateSubmission({ submission })
  const runId = context.createRunId()
  if (context.records.has(runId)) {
    throw new Error("Scenario Runner duplicate run ID")
  }
  const { adapter, executable } = resolveExecutableAdapter({
    context,
    strategyId,
    scenarioId,
  })
  if (!adapter || !executable) {
    return registerUnexecutableSubmission({
      context,
      runId,
      strategyId,
      scenarioId,
      adapter,
      replayOfRunId,
      input,
    })
  }
  const validation = context.validateScenarioInput({
    strategyId,
    scenarioId,
    input,
  })
  if (validation?.valid !== true) {
    throw createInputValidationError({
      errors: Array.isArray(validation?.errors) ? validation.errors : [],
    })
  }
  const record = createAcceptedRun({
    context,
    runId,
    strategyId,
    scenarioId,
    input,
    replayOfRunId,
    replayProvenance: context.replayProvenance,
  })
  return scheduleAcceptedRun({
    context,
    record,
    adapter,
  })
}


function createBlockedReplay({ context, original, diagnostic }) {
  if (!pruneHistory({ context })) {
    throw createCapacityError()
  }
  const runId = context.createRunId()
  if (context.records.has(runId)) {
    throw new Error("Scenario Runner duplicate run ID")
  }
  const record = createBlockedRecord({
    runId,
    strategyId: original.strategyId,
    scenarioId: original.scenarioId,
    diagnostic,
    now: context.now,
    sourceRevision: context.sourceRevision,
    replayOfRunId: original.runId,
    input: original.replayInput ?? original.input,
    replayProvenance: context.replayProvenance,
  })
  context.records.set(runId, record)
  notify({
    record,
    onUpdate: context.onUpdate,
  })
  return snapshot({ record })
}

function replayRun({ context, runId }) {
  const original = context.records.get(runId)
  if (!original) {
    throw new Error("Scenario Runner original run does not exist")
  }
  if (!TERMINAL.has(original.status)) {
    throw new Error("Scenario Runner can replay only a terminal run")
  }
  if (original.status === SCENARIO_RUN_STATUS.BLOCKED) {
    return createBlockedReplay({
      context,
      original,
      diagnostic: "Exact replay is blocked because the original run never executed.",
    })
  }
  if (!original.sourceRevision || !context.sourceRevision) {
    return createBlockedReplay({
      context,
      original,
      diagnostic: "Exact replay is blocked because the original or active runtime source revision is unknown.",
    })
  }
  if (original.sourceRevision !== context.sourceRevision) {
    return createBlockedReplay({
      context,
      original,
      diagnostic: "Exact replay is blocked because the original source revision does not match the active runtime revision.",
    })
  }
  const provenanceDiagnostic = createReplayBlockDiagnostic({
    original,
    context,
  })
  if (provenanceDiagnostic) {
    return createBlockedReplay({
      context,
      original,
      diagnostic: provenanceDiagnostic,
    })
  }
  return submitRun({
    context,
    replayOfRunId: original.runId,
    submission: {
      strategyId: original.strategyId,
      scenarioId: original.scenarioId,
      input: structuredClone(original.replayInput),
    },
  })
}

function cancelQueuedRun({ context, record, runId }) {
  context.queue = context.queue.filter((queuedId) => queuedId !== runId)
  delete record.executionInput
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
  if (!record) {
    return false
  }
  const execution = context.executions.get(runId)
  if (TERMINAL.has(record.status)) {
    if (execution?.cleanupUnconfirmed) {
      return retryUnconfirmedCleanup({
        context,
        record,
        runId,
        execution,
      })
    }
    return false
  }
  if (record.status === SCENARIO_RUN_STATUS.QUEUED) {
    return cancelQueuedRun({
      context,
      record,
      runId,
    })
  }
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
  await Promise.all(activeRunIds.map((runId) => cancelRun({
    context,
    runId,
  })))
  await Promise.all(activeRunIds.map((runId) => waitForRun({
    context,
    runId,
  }).catch(() => null)))
  const unresolvedRunIds = [...context.executions.keys()]
  if (unresolvedRunIds.length > 0) {
    throw new Error(`Scenario Runner shutdown failed because worker cleanup could not be confirmed for run(s): ${unresolvedRunIds.join(", ")}`)
  }
}

function validateRunnerConfiguration({ adapters, canExecuteScenario, validateScenarioInput, maxStoredRuns, maxConcurrentRuns, maxQueuedRuns, timeoutMs }) {
  if (!Array.isArray(adapters) || adapters.some((adapter) =>
    !adapter || typeof adapter.strategyId !== "string" ||
    typeof adapter.execute !== "function" || typeof adapter.cancel !== "function")) {
    throw new TypeError("Scenario Runner requires valid strategy adapters")
  }
  if (typeof canExecuteScenario !== "function") {
    throw new TypeError("Scenario Runner requires a scenario executability policy")
  }
  if (typeof validateScenarioInput !== "function") {
    throw new TypeError("Scenario Runner requires a scenario input validation policy")
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

function createRunnerContext({
  adapters,
  createRunId,
  now,
  timeoutMs,
  maxStoredRuns,
  maxConcurrentRuns,
  maxQueuedRuns,
  canExecuteScenario,
  validateScenarioInput,
  onUpdate,
  sourceRevision,
  replayProvenance,
}) {
  validateRunnerConfiguration({
    adapters,
    canExecuteScenario,
    validateScenarioInput,
    maxStoredRuns,
    maxConcurrentRuns,
    maxQueuedRuns,
    timeoutMs,
  })
  return {
    adapters: createAdapterMap({ adapters }),
    sourceRevision,
    replayProvenance: normalizeReplayProvenance({
      replayProvenance,
      sourceRevision,
    }),
    canExecuteScenario,
    validateScenarioInput,
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
}

function normalizeSourceRevision({ sourceRevision }) {
  if (sourceRevision === null || sourceRevision === undefined) {
    return null
  }
  if (typeof sourceRevision !== "string" ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sourceRevision)) {
    throw new TypeError("Scenario Runner source revision must be a full Git commit SHA")
  }
  return sourceRevision.toLowerCase()
}

function createScenarioRunnerApi({ context }) {
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
    replay: (runId) => replayRun({
      context,
      runId,
    }),
    close: () => closeRunner({
      context,
    }),
  })
}

export function createScenarioRunner(options = {}) {
  const {
    adapters = [],
    createRunId = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    timeoutMs = 30_000,
    maxStoredRuns = 100,
    maxConcurrentRuns = 2,
    maxQueuedRuns = 10,
    canExecuteScenario = () => true,
    validateScenarioInput = () => ({
      valid: true,
      errors: [],
    }),
    onUpdate,
    sourceRevision,
    replayProvenance,
  } = options
  const context = createRunnerContext({
    adapters,
    createRunId,
    now,
    timeoutMs,
    maxStoredRuns,
    maxConcurrentRuns,
    maxQueuedRuns,
    canExecuteScenario,
    validateScenarioInput,
    onUpdate,
    sourceRevision: normalizeSourceRevision({
      sourceRevision: sourceRevision ?? replayProvenance?.identity?.sourceCommitSha,
    }),
    replayProvenance,
  })
  return createScenarioRunnerApi({ context })
}
