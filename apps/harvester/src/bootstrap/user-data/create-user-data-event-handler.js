import { Fill } from "@coinzilla/entities"

const retryableFailureCategories = new Set(["ORDER_TRANSITION", "REST_RECONCILIATION", "DURABILITY"])
const terminalFailureCategories = new Set(["OWNERSHIP_INTEGRITY", "ACCOUNTING_INTEGRITY"])

function resolveUserDataFailure(failure) {
  const validStage = typeof failure?.stage === "string" && failure.stage.trim().length > 0
  const validRetryable = retryableFailureCategories.has(failure?.category) && failure?.retryable === true
  const validTerminal = terminalFailureCategories.has(failure?.category) && failure?.retryable === false
  if (validStage && (validRetryable || validTerminal)) {
    return failure
  }
  return {
    category: "ACCOUNTING_INTEGRITY",
    stage: "UNCLASSIFIED_ENGINE_FAILURE",
    retryable: false,
  }
}

function getUserDataFailureMessage(failure) {
  if (failure.category === "OWNERSHIP_INTEGRITY") {
    return "rejected an unowned or invalid order event"
  }
  if (failure.category === "ORDER_TRANSITION") {
    return "user-data order transition failed"
  }
  if (failure.category === "REST_RECONCILIATION") {
    return "user-data REST reconciliation failed"
  }
  if (failure.category === "DURABILITY") {
    return "user-data durability barrier failed"
  }
  return "user-data accounting integrity failed"
}

function getOrderIdentityDiagnostics({ event, tradingEngine }) {
  const rejectedOrder = event.executedOrder
  const registeredOrders = tradingEngine.getOrders()
  const brokerOrderId = rejectedOrder?.brokerOrderId ?? event.fill?.brokerOrderId
  const clientOrderId = rejectedOrder?.clientOrderId ?? event.clientOrderId ?? event.fill?.clientOrderId
  const clientIdMatch = registeredOrders.find((order) => order.clientOrderId === clientOrderId)
  const brokerIdMatch = registeredOrders.find((order) =>
    brokerOrderId !== undefined && order.brokerOrderId === brokerOrderId)
  return {
    rejectedOrder,
    brokerOrderId,
    clientOrderId,
    clientIdMatch,
    brokerIdMatch,
  }
}


function getUserDataEventSymbol({ event, identity }) {
  return identity.rejectedOrder?.market?.symbol ?? event.fill?.market?.symbol
}

function requiresStickySafetyBlocker({ failure, event, onSafetyBlockerRaised }) {
  const isUnownedExecution = event.executionType === "TRADE" || event.fill instanceof Fill
  const terminalAccountingFailure = failure.category === "ACCOUNTING_INTEGRITY"
  const unownedExecutionFailure = failure.category === "OWNERSHIP_INTEGRITY" && isUnownedExecution
  return typeof onSafetyBlockerRaised === "function" &&
    (terminalAccountingFailure || unownedExecutionFailure)
}

function createStickySafetyBlockerRequest({ failure, event, identity, eventSymbol }) {
  return {
    scope: eventSymbol ? "MARKET" : "ACCOUNT",
    symbol: eventSymbol ?? null,
    reason: failure.stage,
    evidence: {
      failureCategory: failure.category,
      failureStage: failure.stage,
      eventType: event.eventType ?? null,
      executionType: event.executionType ?? null,
      symbol: eventSymbol ?? null,
      brokerOrderId: identity.brokerOrderId ?? null,
      clientOrderId: identity.clientOrderId ?? null,
      executionId: event.fill?.id ?? event.executionId ?? null,
      orderStatus: identity.rejectedOrder?.status ?? null,
    },
  }
}

function logStickySafetyBlockerFailure({ logger, blocker, eventSymbol, failure }) {
  const { errors } = blocker ?? {}
  logger.error?.({
    message: "terminal user-data safety blocker could not be durably committed",
    symbol: eventSymbol,
    failureCategory: failure.category,
    failureStage: failure.stage,
    errors,
  })
}

function logStickySafetyBlockerException({ logger, error, eventSymbol, failure }) {
  logger.error?.({
    message: "terminal user-data safety blocker append failed",
    symbol: eventSymbol,
    failureCategory: failure.category,
    failureStage: failure.stage,
    error,
  })
}

async function persistStickySafetyBlocker({ failure, event, identity, onSafetyBlockerRaised, logger }) {
  if (!requiresStickySafetyBlocker({
    failure,
    event,
    onSafetyBlockerRaised,
  })) {
    return
  }
  const eventSymbol = getUserDataEventSymbol({
    event,
    identity,
  })
  const request = createStickySafetyBlockerRequest({
    failure,
    event,
    identity,
    eventSymbol,
  })
  try {
    const blocker = await onSafetyBlockerRaised(request)
    if (blocker?.ok !== true || blocker.data?.durable !== true) {
      logStickySafetyBlockerFailure({
        logger,
        blocker,
        eventSymbol,
        failure,
      })
    }
  } catch (error) {
    logStickySafetyBlockerException({
      logger,
      error,
      eventSymbol,
      failure,
    })
  }
}

function logRejectedOrderEvent({ processed, failure, retryable, event, identity, logger }) {
  const { rejectedOrder } = identity
  logger.error?.({
    message: getUserDataFailureMessage(failure),
    failureCategory: failure.category,
    failureStage: failure.stage,
    failureRetryable: retryable,
    eventType: event.eventType ?? "UNKNOWN",
    executionType: event.executionType,
    symbol: rejectedOrder?.market?.symbol ?? event.fill?.market?.symbol,
    brokerOrderId: identity.brokerOrderId,
    clientOrderId: identity.clientOrderId,
    originalClientOrderId: event.originalClientOrderId,
    side: rejectedOrder?.side ?? event.fill?.side,
    orderStatus: rejectedOrder?.status,
    executionId: event.fill?.id ?? event.executionId,
    registryMatchedByClientOrderId: Boolean(identity.clientIdMatch),
    registryMatchedByBrokerOrderId: Boolean(identity.brokerIdMatch),
    clientIdMatchStatus: identity.clientIdMatch?.status,
    clientIdMatchBrokerOrderId: identity.clientIdMatch?.brokerOrderId,
    brokerIdMatchClientOrderId: identity.brokerIdMatch?.clientOrderId,
    errors: (processed.errors ?? []).map((error) => ({
      error,
      name: error?.name ?? "Error",
      message: typeof error?.message === "string" && error.message
        ? error.message
        : error?.cause?.message ?? String(error),
      stack: error?.stack,
      cause: error?.cause,
      causeName: error?.cause?.name,
      causeMessage: error?.cause?.message,
      causeStack: error?.cause?.stack,
    })),
  })
}

async function handleFailedOrderEvent({ processed, event, tradingEngine, state, onSafetyBlockerRaised, logger }) {
  const failure = resolveUserDataFailure(processed.failure)
  const retryable = failure.retryable === true && retryableFailureCategories.has(failure.category)
  state.ready = false
  state.requiresReconciliation = true
  if (retryable) {
    state.retryableRecoveryFailure = {
      generation: state.recoveryGeneration,
      category: failure.category,
      stage: failure.stage,
      retryable: true,
    }
  } else {
    state.accountingFailed = true
    state.retryableRecoveryFailure = null
  }
  state.safetyHaltRequired = true
  state.status = state.accountingFailed
    ? "EXECUTION_ACCOUNTING_FAILED"
    : "AUTHORITATIVE_RECONCILIATION_REQUIRED"

  const identity = getOrderIdentityDiagnostics({
    event,
    tradingEngine,
  })
  await persistStickySafetyBlocker({
    failure,
    event,
    identity,
    onSafetyBlockerRaised,
    logger,
  })
  logRejectedOrderEvent({
    processed,
    failure,
    retryable,
    event,
    identity,
    logger,
  })
}

function getSuccessfulOrderSymbol({ executedOrder, fill }) {
  return executedOrder?.market?.symbol ?? fill?.market?.symbol
}

function getSuccessfulOrderBrokerId({ executedOrder, fill }) {
  return executedOrder?.brokerOrderId ?? fill?.brokerOrderId
}

function getSuccessfulOrderClientId({ executedOrder, event, fill }) {
  return executedOrder?.clientOrderId ?? event.clientOrderId ?? fill?.clientOrderId
}

function createSuccessfulOrderEventLog({ processed, event }) {
  const { executedOrder, fill } = event
  const ignored = processed.data?.ignored === true
  return {
    message: "Order update processed",
    eventType: event.eventType ?? "UNKNOWN",
    executionType: event.executionType,
    symbol: getSuccessfulOrderSymbol({ executedOrder, fill }),
    brokerOrderId: getSuccessfulOrderBrokerId({ executedOrder, fill }),
    clientOrderId: getSuccessfulOrderClientId({ executedOrder, event, fill }),
    originalClientOrderId: event.originalClientOrderId,
    side: executedOrder?.side ?? fill?.side,
    price: executedOrder?.limitPrice?.amount ?? null,
    quantity: executedOrder?.originalQuantity?.amount,
    orderStatus: executedOrder?.status,
    executionId: fill?.id,
    outcome: ignored ? "IGNORED" : "ACCEPTED",
    ignored,
    fillApplied: event.executionType === "TRADE" && !ignored,
  }
}

function logSuccessfulOrderEvent({ processed, event, logger }) {
  logger.info?.(createSuccessfulOrderEventLog({
    processed,
    event,
  }))
}

async function notifyUserDataObserver({
  event,
  recoveryMode,
  onUserDataEvent,
  getPortfolio,
  getRecoveryLedger,
  updatePortfolio,
  updateTradingAccounting,
  logger,
}) {
  try {
    await onUserDataEvent({
      event,
      recoveryMode,
      portfolio: getPortfolio(),
      recoveryLedger: event.fill instanceof Fill
        ? getRecoveryLedger({
          marketId: event.fill.market.id,
        })
        : undefined,
      updatePortfolio,
      updateTradingAccounting,
    })
  } catch (error) {
    // Observability hooks must not roll back a fill already committed
    // to both immutable accounting projections.
    logger.error?.({
      message: "user-data observer failed",
      eventType: event.eventType ?? "UNKNOWN",
      error,
    })
  }
}

async function processOrderUpdate({
  event,
  recoveryMode,
  tradingEngine,
  tradingEnabled,
  state,
  onSafetyBlockerRaised,
  logger,
}) {
  const isOrderUpdate = event?.eventType === "executionReport"
  if (tradingEngine && isOrderUpdate) {
    const processed = await tradingEngine.processUserDataEvent({
      event,
      recoveryMode,
    })
    if (!processed.ok) {
      await handleFailedOrderEvent({
        processed,
        event,
        tradingEngine,
        state,
        onSafetyBlockerRaised,
        logger,
      })
      return {
        shouldNotifyObserver: false,
        reevaluateSymbol: undefined,
      }
    }
    logSuccessfulOrderEvent({
      processed,
      event,
      logger,
    })
    return {
      shouldNotifyObserver: true,
      reevaluateSymbol: processed.data?.reevaluate === true
        ? event.executedOrder.market.symbol
        : undefined,
    }
  }
  if (isOrderUpdate && tradingEnabled) {
    state.accountingFailed = true
    state.ready = false
    state.status = "UNOWNED_ORDER_EVENT_BEFORE_ENGINE_READY"
    logger.error?.({
      message: "received an order report before its order-ownership registry was ready",
      symbol: event.executedOrder?.market?.symbol ?? event.fill?.market?.symbol,
      brokerOrderId: event.executedOrder?.brokerOrderId ?? event.fill?.brokerOrderId,
    })
    return {
      shouldNotifyObserver: false,
      reevaluateSymbol: undefined,
    }
  }
  return {
    shouldNotifyObserver: true,
    reevaluateSymbol: undefined,
  }
}

async function processQueuedUserDataEvent({
  event,
  state,
  tradingEngine,
  tradingEnabled,
  onSafetyBlockerRaised,
  onUserDataEvent,
  getPortfolio,
  getRecoveryLedger,
  updatePortfolio,
  updateTradingAccounting,
  logger,
}) {
  const recoveryMode = state.requiresReconciliation || state.recoveryTask !== null
  const orderUpdate = await processOrderUpdate({
    event,
    recoveryMode,
    tradingEngine,
    tradingEnabled,
    state,
    onSafetyBlockerRaised,
    logger,
  })
  if (!orderUpdate.shouldNotifyObserver) {
    return undefined
  }
  await notifyUserDataObserver({
    event,
    recoveryMode,
    onUserDataEvent,
    getPortfolio,
    getRecoveryLedger,
    updatePortfolio,
    updateTradingAccounting,
    logger,
  })
  return orderUpdate.reevaluateSymbol
}

function handleUserDataQueueFailure({ error, state, logger }) {
  state.accountingFailed = true
  state.ready = false
  state.status = "EVENT_QUEUE_FAILED"
  logger.error?.({
    message: "user-data event queue failed",
    error,
  })
}

async function finalizeUserDataEvent({
  state,
  isStopped,
  cancelOwnedBuysAfterAccountingFailure,
  resumeDeferredStrategyEvaluations,
  tradingEngine,
  reevaluateSymbol,
  logger,
}) {
  if (isStopped()) {
    state.ready = false
    state.status = "STOPPING"
    return
  }
  if (state.accountingFailed || state.safetyHaltRequired) {
    state.ready = false
    state.safetyHaltRequired = false
    await cancelOwnedBuysAfterAccountingFailure()
    return
  }
  if (state.requiresReconciliation) {
    state.ready = false
    state.status = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    return
  }
  if (!state.initialAccountSnapshotReady) {
    state.ready = false
    state.status = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
    return
  }
  state.ready = true
  state.status = "READY"
  if (reevaluateSymbol && tradingEngine) {
    const reevaluated = await tradingEngine.evaluateLatest({
      symbol: reevaluateSymbol,
    })
    if (!reevaluated.ok) {
      logger.error?.({
        message: "next strategy evaluation failed",
        errors: reevaluated.errors,
      })
    }
  }
  resumeDeferredStrategyEvaluations()
}

/**
 * Create the serialized broker user-data event handler.
 *
 * The handler owns event sequencing/queue advancement and observer isolation;
 * bootstrap supplies the live readiness state, engine, accounting callbacks,
 * and process-lifecycle actions.
 */
export function createUserDataEventHandler({
  state,
  getTradingEngine,
  isTradingEnabled,
  isStopped,
  logger,
  onUserDataEvent,
  getPortfolio,
  getRecoveryLedger,
  updatePortfolio,
  updateTradingAccounting,
  cancelOwnedBuysAfterAccountingFailure,
  resumeDeferredStrategyEvaluations,
  onSafetyBlockerRaised,
} = {}) {
  return ({ event } = {}) => {
    const tradingEngine = getTradingEngine()
    const tradingEnabled = isTradingEnabled()
    if (state.intakeStopped) {
      return
    }
    const isExecution = event?.eventType === "executionReport" &&
      event?.executionType === "TRADE"
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      state.ready = false
      state.accountingFailed = true
      state.status = "INVALID_EVENT"
      void cancelOwnedBuysAfterAccountingFailure()
      return
    }
    state.eventSequence += 1
    if (isExecution) {
      logger.info?.({
        message: "Trade execution received",
        symbol: event.fill?.market?.symbol ?? event.executedOrder?.market?.symbol,
        side: event.fill?.side ?? event.executedOrder?.side,
      })
    }

    let reevaluateSymbol
    const task = state.eventQueue
      .then(() => processQueuedUserDataEvent({
        event,
        state,
        tradingEngine,
        tradingEnabled,
        onSafetyBlockerRaised,
        onUserDataEvent,
        getPortfolio,
        getRecoveryLedger,
        updatePortfolio,
        updateTradingAccounting,
        logger,
      }))
      .then((symbol) => {
        reevaluateSymbol = symbol
      })
      .catch((error) => {
        handleUserDataQueueFailure({
          error,
          state,
          logger,
        })
        return undefined
      })
      .finally(() => finalizeUserDataEvent({
        state,
        isStopped,
        cancelOwnedBuysAfterAccountingFailure,
        resumeDeferredStrategyEvaluations,
        tradingEngine,
        reevaluateSymbol,
        logger,
      }))
    state.eventQueue = task
  }
}
