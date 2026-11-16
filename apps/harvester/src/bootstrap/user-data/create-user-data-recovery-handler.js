/**
 * Create the application-side user-data recovery coordinator.
 *
 * The coordinator reconciles owned orders, brackets REST snapshots with the
 * serialized user-data event sequence, durably publishes account/open-order
 * audits, and acknowledges the broker recovery generation only after all
 * application checks succeed.
 */
const retryableRecoveryFailureCategories = new Set(["ORDER_TRANSITION", "REST_RECONCILIATION", "DURABILITY"])
const terminalRecoveryFailureCategories = new Set(["OWNERSHIP_INTEGRITY", "ACCOUNTING_INTEGRITY", "DURABILITY"])

function resolveRecoveryFailure(failure) {
  const validStage = typeof failure?.stage === "string" && failure.stage.trim().length > 0
  const validRetryable = retryableRecoveryFailureCategories.has(failure?.category) && failure?.retryable === true
  const validTerminal = terminalRecoveryFailureCategories.has(failure?.category) && failure?.retryable === false
  if (validStage && (validRetryable || validTerminal)) {
    return failure
  }
  return {
    category: "ACCOUNTING_INTEGRITY",
    stage: "UNCLASSIFIED_RECOVERY_FAILURE",
    retryable: false,
  }
}

function createRecoveryFailureError({ error, failure }) {
  const normalized = error instanceof Error ? error : new Error(String(error), { cause: error })
  normalized.recoveryFailure = resolveRecoveryFailure(normalized.recoveryFailure ?? failure)
  return normalized
}

function isCurrentRecoveryGeneration({ state, isStopped, generation }) {
  return !isStopped() && generation === state.recoveryGeneration
}

function assertCurrentRecoveryGeneration({ context }) {
  if (isCurrentRecoveryGeneration(context)) {
    return
  }
  throw createRecoveryFailureError({
    error: new Error("User-data recovery generation was superseded"),
    failure: {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_GENERATION_FENCING",
      retryable: true,
    },
  })
}

function assertNoRecoveryAccountingFailure({ state }) {
  if (state.accountingFailed) {
    throw new Error("User-data accounting failed during recovery")
  }
}

function assertNoRetryableRecoveryFailure({ state, generation }) {
  const failure = state.retryableRecoveryFailure
  if (failure?.generation !== generation) {
    return
  }
  throw createRecoveryFailureError({
    error: new Error(
      `Queued user-data event requires another authoritative recovery attempt: ${failure.category} at ${failure.stage}`,
    ),
    failure,
  })
}

async function runRecoveryStage({ category, stage, retryable, task }) {
  try {
    return await task()
  } catch (error) {
    throw createRecoveryFailureError({
      error,
      failure: { category, stage, retryable },
    })
  }
}

async function reconcileOwnedOrders({ context }) {
  const { tradingEnabled, tradingEngine, drainUserDataEvents, state } = context
  if (!tradingEnabled) {
    return {
      reconciliation: { ok: true, data: { reconciled: 0, symbols: [] } },
      hasCanonicalOwnershipReconciliation: false,
    }
  }
  if (!tradingEngine) {
    throw new Error("Trading engine is unavailable during user-data recovery")
  }
  const reconciliation = await tradingEngine.reconcileOwnedOrders({
    recoveryMode: true,
    beforeApply: drainUserDataEvents,
  })
  assertCurrentRecoveryGeneration({ context })
  assertNoRecoveryAccountingFailure({ state })
  assertNoRetryableRecoveryFailure({ state, generation: context.generation })
  if (!reconciliation?.ok) {
    const failure = resolveRecoveryFailure(reconciliation?.failure)
    if (failure.retryable && !state.accountingFailed) {
      state.retryableRecoveryFailure = {
        generation: context.generation,
        category: failure.category,
        stage: failure.stage,
        retryable: true,
      }
    } else {
      state.accountingFailed = true
      state.retryableRecoveryFailure = null
      state.status = "EXECUTION_ACCOUNTING_FAILED"
    }
    throw createRecoveryFailureError({
      error: reconciliation?.errors?.[0] ?? new Error("Owned-order REST/stream reconciliation failed"),
      failure,
    })
  }
  assertNoRetryableRecoveryFailure({ state, generation: context.generation })
  context.setCanonicalOwnershipReconciled(true)
  return {
    reconciliation,
    hasCanonicalOwnershipReconciliation: true,
  }
}

async function readAccountWideOpenOrders({ context }) {
  let result
  try {
    result = await context.broker.getOpenOrders({})
  } catch (error) {
    throw createRecoveryFailureError({
      error,
      failure: {
        category: "ACCOUNTING_INTEGRITY",
        stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ_EXCEPTION",
        retryable: false,
      },
    })
  }
  if (result?.ok !== false && result?.ok !== true) {
    throw createRecoveryFailureError({
      error: new Error("Account-wide open-orders response is missing an explicit success flag"),
      failure: {
        category: "ACCOUNTING_INTEGRITY",
        stage: "ACCOUNT_WIDE_OPEN_ORDERS_RESPONSE",
        retryable: false,
      },
    })
  }
  if (result.ok === false) {
    const details = result.errors?.map((error) => error?.message ?? String(error)).join("; ")
    const cause = result.errors?.find?.((error) => error instanceof Error)
    throw createRecoveryFailureError({
      error: new Error(
        `Unable to load authoritative account-wide open orders${details ? `: ${details}` : ""}`,
        { cause },
      ),
      failure: {
        category: "REST_RECONCILIATION",
        stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ",
        retryable: true,
      },
    })
  }
  if (!Array.isArray(result.data)) {
    throw createRecoveryFailureError({
      error: new Error("Authoritative account-wide open-orders response is not an array"),
      failure: {
        category: "ACCOUNTING_INTEGRITY",
        stage: "ACCOUNT_WIDE_OPEN_ORDERS_SNAPSHOT",
        retryable: false,
      },
    })
  }
  return result.data
}

async function drainAndValidateRecoveryEvents({ context }) {
  await context.drainUserDataEvents()
  assertCurrentRecoveryGeneration({ context })
  assertNoRecoveryAccountingFailure({ state: context.state })
  assertNoRetryableRecoveryFailure({
    state: context.state,
    generation: context.generation,
  })
}

async function publishRecoveryAccountAudit({ context, snapshot }) {
  await runRecoveryStage({
    category: "ACCOUNTING_INTEGRITY",
    stage: "RECOVERY_ACCOUNT_AUDIT_VALIDATION",
    retryable: false,
    task: () => context.publishAccountSnapshot({ phase: "RECOVERY", snapshot }),
  })
}

async function publishRecoveryOpenOrdersAudit({
  context,
  orders,
  hasCanonicalOwnershipReconciliation,
}) {
  await runRecoveryStage({
    category: "ACCOUNTING_INTEGRITY",
    stage: "RECOVERY_OPEN_ORDERS_AUDIT_VALIDATION",
    retryable: false,
    task: () => context.publishOpenOrdersSnapshot({
      phase: "RECOVERY",
      ownershipReconciled: context.tradingEnabled && hasCanonicalOwnershipReconciliation,
      orders,
    }),
  })
}

async function captureConsistentRecoverySnapshots({
  context,
  hasCanonicalOwnershipReconciliation,
}) {
  const { state } = context
  while (true) {
    await drainAndValidateRecoveryEvents({ context })
    const eventSequence = state.eventSequence
    const snapshot = await runRecoveryStage({
      category: "ACCOUNTING_INTEGRITY",
      stage: "ACCOUNT_SNAPSHOT_VALIDATION",
      retryable: false,
      task: context.refreshAccountSnapshot,
    })
    assertCurrentRecoveryGeneration({ context })
    const orders = await readAccountWideOpenOrders({ context })
    await drainAndValidateRecoveryEvents({ context })
    if (eventSequence !== state.eventSequence) {
      continue
    }

    await publishRecoveryAccountAudit({ context, snapshot })
    assertCurrentRecoveryGeneration({ context })
    assertNoRecoveryAccountingFailure({ state })
    assertNoRetryableRecoveryFailure({ state, generation: context.generation })
    await drainAndValidateRecoveryEvents({ context })
    if (eventSequence !== state.eventSequence) {
      continue
    }

    await publishRecoveryOpenOrdersAudit({
      context,
      orders,
      hasCanonicalOwnershipReconciliation,
    })
    await drainAndValidateRecoveryEvents({ context })
    if (eventSequence === state.eventSequence) {
      return
    }
  }
}

function logRecoveryAcknowledgementPending({ context, reconciliation }) {
  const { logger, generation, state } = context
  state.ready = false
  state.requiresReconciliation = true
  logger.info?.({
    message: "application recovery acknowledged locally; waiting for broker-wide recovery completion",
    generation,
    reconciledOrders: reconciliation.data?.reconciled ?? 0,
  })
}

function acknowledgeRecoveryResult({ context, userDataSubscription, brokerRecoveryGeneration, reconciliation }) {
  const { state, generation } = context
  const previousAcknowledgedGeneration = state.lastAcknowledgedRecoveryGeneration
  state.lastAcknowledgedRecoveryGeneration = generation
  let acknowledgement
  try {
    acknowledgement = userDataSubscription.acknowledgeRecoveryResult(brokerRecoveryGeneration)
  } catch (error) {
    state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
    throw createRecoveryFailureError({
      error,
      failure: {
        category: "ORDER_TRANSITION",
        stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT",
        retryable: true,
      },
    })
  }
  if (acknowledgement?.accepted !== true) {
    state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
    const reason = typeof acknowledgement?.reason === "string"
      ? `: ${acknowledgement.reason}`
      : ""
    throw createRecoveryFailureError({
      error: new Error(`Broker rejected the application recovery acknowledgement${reason}`),
      failure: {
        category: "ORDER_TRANSITION",
        stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT",
        retryable: true,
      },
    })
  }
  if (typeof acknowledgement.completed !== "boolean") {
    state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
    throw createRecoveryFailureError({
      error: new Error("Broker returned an invalid recovery acknowledgement result"),
      failure: {
        category: "ORDER_TRANSITION",
        stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT",
        retryable: true,
      },
    })
  }
  if (!acknowledgement.completed) {
    logRecoveryAcknowledgementPending({ context, reconciliation })
    return false
  }
  return true
}

function acknowledgeLegacyRecovery({ context, userDataSubscription }) {
  const { state, generation } = context
  const previousAcknowledgedGeneration = state.lastAcknowledgedRecoveryGeneration
  state.lastAcknowledgedRecoveryGeneration = generation
  state.requiresReconciliation = false
  let acknowledged
  try {
    acknowledged = userDataSubscription.acknowledgeRecovery()
  } catch (error) {
    state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
    state.requiresReconciliation = true
    throw createRecoveryFailureError({
      error,
      failure: {
        category: "ORDER_TRANSITION",
        stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT",
        retryable: true,
      },
    })
  }
  if (acknowledged !== true) {
    state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
    state.requiresReconciliation = true
    throw createRecoveryFailureError({
      error: new Error("Broker rejected the application recovery acknowledgement"),
      failure: {
        category: "ORDER_TRANSITION",
        stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT",
        retryable: true,
      },
    })
  }
  return true
}

function acknowledgeBrokerRecovery({ context, reconciliation }) {
  const { userDataSubscription, brokerRecoveryGeneration } = context
  if (typeof userDataSubscription.acknowledgeRecoveryResult === "function") {
    return acknowledgeRecoveryResult({
      context,
      userDataSubscription,
      brokerRecoveryGeneration,
      reconciliation,
    })
  }
  return acknowledgeLegacyRecovery({ context, userDataSubscription })
}

function getRecoveryErrorDetails({ error }) {
  const cause = error?.cause
  let errorMessage
  if (typeof error?.message === "string" && error.message) {
    errorMessage = error.message
  } else if (cause instanceof Error && cause.message) {
    errorMessage = cause.message
  } else {
    errorMessage = String(error)
  }
  let causeMessage
  if (cause instanceof Error) {
    causeMessage = cause.message
  } else if (cause !== undefined) {
    causeMessage = String(cause)
  }
  return {
    cause,
    errorName: error?.name ?? "Error",
    errorMessage,
    errorStack: error?.stack,
    causeName: cause instanceof Error ? cause.name : undefined,
    causeMessage,
    causeStack: cause instanceof Error ? cause.stack : undefined,
  }
}

function logStaleRecoveryFailure({ context, error, details }) {
  context.logger.error?.({
    message: "application recovery failed; trading remains blocked",
    generation: context.generation,
    currentGeneration: context.state.recoveryGeneration,
    staleGeneration: true,
    failureCategory: error?.recoveryFailure?.category,
    failureStage: error?.recoveryFailure?.stage,
    error,
    ...details,
  })
}

function applyCurrentRecoveryFailure({ context, error }) {
  const { state, generation } = context
  const failure = resolveRecoveryFailure(error?.recoveryFailure)
  if (failure.retryable && !state.accountingFailed) {
    state.retryableRecoveryFailure = {
      generation,
      category: failure.category,
      stage: failure.stage,
      retryable: true,
    }
  } else {
    state.accountingFailed = true
    state.retryableRecoveryFailure = null
  }
  state.ready = false
  state.requiresReconciliation = true
  state.status = state.accountingFailed
    ? "EXECUTION_ACCOUNTING_FAILED"
    : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
}

function logCurrentRecoveryFailure({ context, error, details }) {
  const { state, generation } = context
  context.logger.error?.({
    message: "application recovery failed; trading remains blocked",
    generation,
    failureCategory: state.retryableRecoveryFailure?.category,
    failureStage: state.retryableRecoveryFailure?.stage,
    error,
    ...details,
  })
}

function handleRecoveryFailure({ context, error }) {
  const details = getRecoveryErrorDetails({ error })
  if (!isCurrentRecoveryGeneration(context)) {
    logStaleRecoveryFailure({ context, error, details })
    return
  }
  applyCurrentRecoveryFailure({ context, error })
  logCurrentRecoveryFailure({ context, error, details })
}

async function executeRecoveryAttempt({ context }) {
  try {
    context.logger.info?.({
      message: "application recovery started after user-data transport reconnect",
      generation: context.generation,
    })
    const { reconciliation, hasCanonicalOwnershipReconciliation } = await reconcileOwnedOrders({ context })
    await captureConsistentRecoverySnapshots({
      context,
      hasCanonicalOwnershipReconciliation,
    })
    const completed = acknowledgeBrokerRecovery({ context, reconciliation })
    if (!completed) {
      return
    }
    context.logger.info?.({
      message: "application recovery completed and broker acknowledgement accepted",
      generation: context.generation,
      reconciledOrders: reconciliation.data?.reconciled ?? 0,
    })
  } catch (error) {
    handleRecoveryFailure({ context, error })
  }
}

function hasRecoveryAcknowledgement({ userDataSubscription, logger }) {
  const supportsResult = typeof userDataSubscription?.acknowledgeRecoveryResult === "function"
  const supportsLegacy = typeof userDataSubscription?.acknowledgeRecovery === "function"
  if (!supportsResult && !supportsLegacy) {
    logger.error?.({
      message: "cannot acknowledge user-data recovery; subscription acknowledgement is unavailable",
    })
    return false
  }
  return true
}

function hasValidBrokerRecoveryGeneration({ userDataSubscription, brokerRecoveryGeneration, logger }) {
  if (typeof userDataSubscription.acknowledgeRecoveryResult !== "function" ||
      Number.isSafeInteger(brokerRecoveryGeneration)) {
    return true
  }
  logger.error?.({
    message: "cannot acknowledge user-data recovery; broker recovery generation is unavailable",
  })
  return false
}

function shouldDeferRecovery({ state }) {
  state.pendingRecovery = state.requiresReconciliation &&
    !state.accountingFailed &&
    !state.recoveryTask &&
    state.lastAcknowledgedRecoveryGeneration !== state.recoveryGeneration
}

function isRecoveryAlreadyHandled({ state }) {
  return !state.requiresReconciliation ||
    state.accountingFailed ||
    state.recoveryTask ||
    state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration
}

function createRecoveryContext({
  state,
  isStopped,
  generation,
  userDataSubscription,
  tradingEngine,
  tradingEnabled,
  broker,
  drainUserDataEvents,
  setCanonicalOwnershipReconciled,
  refreshAccountSnapshot,
  publishAccountSnapshot,
  publishOpenOrdersSnapshot,
  logger,
}) {
  return {
    state,
    isStopped,
    generation,
    userDataSubscription,
    brokerRecoveryGeneration: state.recoveryBrokerGeneration,
    tradingEngine,
    tradingEnabled,
    broker,
    drainUserDataEvents,
    setCanonicalOwnershipReconciled,
    refreshAccountSnapshot,
    publishAccountSnapshot,
    publishOpenOrdersSnapshot,
    logger,
  }
}

export function createUserDataRecoveryHandler({
  state,
  isStopped,
  getUserDataSubscription,
  getTradingEngine,
  tradingEnabled,
  broker,
  drainUserDataEvents,
  setCanonicalOwnershipReconciled,
  refreshAccountSnapshot,
  publishAccountSnapshot,
  publishOpenOrdersSnapshot,
  logger,
} = {}) {
  return function startUserDataRecovery() {
    const userDataSubscription = getUserDataSubscription()
    const tradingEngine = getTradingEngine()
    if (isStopped()) {
      state.pendingRecovery = false
      return
    }
    if (!state.startupComplete) {
      shouldDeferRecovery({ state })
      return
    }

    state.pendingRecovery = false
    if (isRecoveryAlreadyHandled({ state })) {
      return
    }
    if (!hasRecoveryAcknowledgement({ userDataSubscription, logger })) {
      return
    }
    const brokerRecoveryGeneration = state.recoveryBrokerGeneration
    if (!hasValidBrokerRecoveryGeneration({
      userDataSubscription,
      brokerRecoveryGeneration,
      logger,
    })) {
      return
    }

    state.pendingRecovery = false
    state.retryableRecoveryFailure = null
    const generation = state.recoveryGeneration
    const context = createRecoveryContext({
      state,
      isStopped,
      generation,
      userDataSubscription,
      tradingEngine,
      tradingEnabled,
      broker,
      drainUserDataEvents,
      setCanonicalOwnershipReconciled,
      refreshAccountSnapshot,
      publishAccountSnapshot,
      publishOpenOrdersSnapshot,
      logger,
    })
    const recoveryTask = executeRecoveryAttempt({ context }).finally(() => {
      if (state.recoveryTask === recoveryTask) {
        state.recoveryTask = null
      }
    })
    state.recoveryTask = recoveryTask
  }
}
