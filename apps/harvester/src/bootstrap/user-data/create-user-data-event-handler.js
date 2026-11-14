import { Fill } from "@coinzilla/entities"


const retryableFailureCategories = new Set(["ORDER_TRANSITION", "REST_RECONCILIATION", "DURABILITY"])
const terminalFailureCategories = new Set(["OWNERSHIP_INTEGRITY", "ACCOUNTING_INTEGRITY"])

function resolveUserDataFailure(failure) {
  const validStage = typeof failure?.stage === "string" && failure.stage.trim().length > 0
  const validRetryable = retryableFailureCategories.has(failure?.category) && failure?.retryable === true
  const validTerminal = terminalFailureCategories.has(failure?.category) && failure?.retryable === false
  if (validStage && (validRetryable || validTerminal)) { return failure }
  return { category: "ACCOUNTING_INTEGRITY", stage: "UNCLASSIFIED_ENGINE_FAILURE", retryable: false }
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

/**
 * Create the serialized broker user-data event handler.
 *
 * The handler owns event sequencing/queue advancement and observer isolation;
 * bootstrap supplies the live readiness state, engine, accounting callbacks,
 * and process-lifecycle actions.
 */
export function createUserDataEventHandler({
  state, getTradingEngine, isTradingEnabled, isStopped, logger, onUserDataEvent,
  getPortfolio, getRecoveryLedger, updatePortfolio, updateTradingAccounting,
  cancelOwnedBuysAfterAccountingFailure, resumeDeferredStrategyEvaluations, onSafetyBlockerRaised,
} = {}) {
  return ({ event } = {}) => {
    const tradingEngine = getTradingEngine()
    const tradingEnabled = isTradingEnabled()
    if (state.intakeStopped) { return }
    const isExecution = event?.eventType === "executionReport" &&
      event?.executionType === "TRADE"
    const isOrderUpdate = event?.eventType === "executionReport"
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      state.ready = false
      state.accountingFailed = true
      state.status = "INVALID_EVENT"
      void cancelOwnedBuysAfterAccountingFailure()
      return
    }
    state.eventSequence += 1
    let reevaluateSymbol

    if (isExecution) {
      logger.info?.({
        message: "Trade execution received",
        symbol: event.fill?.market?.symbol ?? event.executedOrder?.market?.symbol,
        side: event.fill?.side ?? event.executedOrder?.side,
      })
    }
    const task = state.eventQueue.then(async () => {
      const recoveryMode = state.requiresReconciliation || state.recoveryTask !== null
      if (tradingEngine && isOrderUpdate) {
        const processed = await tradingEngine.processUserDataEvent({
          event,
          recoveryMode,
        })
        if (!processed.ok) {
          const failure = resolveUserDataFailure(processed.failure)
          const retryable = failure.retryable === true &&
            retryableFailureCategories.has(failure.category)
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
          if (state.accountingFailed) {
            state.status = "EXECUTION_ACCOUNTING_FAILED"
          } else {
            state.status = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
          }
          const rejectedOrder = event.executedOrder
          const registeredOrders = tradingEngine.getOrders()
          const incomingBrokerOrderId = rejectedOrder?.brokerOrderId ?? event.fill?.brokerOrderId
          const incomingClientOrderId = rejectedOrder?.clientOrderId ?? event.clientOrderId ?? event.fill?.clientOrderId
          const clientIdMatch = registeredOrders.find((order) =>
            order.clientOrderId === incomingClientOrderId)
          const brokerIdMatch = registeredOrders.find((order) =>
            incomingBrokerOrderId !== undefined &&
            order.brokerOrderId === incomingBrokerOrderId)
          const eventSymbol = rejectedOrder?.market?.symbol ?? event.fill?.market?.symbol
          const isUnownedExecution = event.executionType === "TRADE" || event.fill instanceof Fill
          const requiresStickyBlocker = failure.category === "ACCOUNTING_INTEGRITY" ||
            (failure.category === "OWNERSHIP_INTEGRITY" && isUnownedExecution)
          if (requiresStickyBlocker && typeof onSafetyBlockerRaised === "function") {
            const evidence = {
              failureCategory: failure.category,
              failureStage: failure.stage,
              eventType: event.eventType ?? null,
              executionType: event.executionType ?? null,
              symbol: eventSymbol ?? null,
              brokerOrderId: incomingBrokerOrderId ?? null,
              clientOrderId: incomingClientOrderId ?? null,
              executionId: event.fill?.id ?? event.executionId ?? null,
              orderStatus: rejectedOrder?.status ?? null,
            }
            try {
              const blocker = await onSafetyBlockerRaised({
                scope: eventSymbol ? "MARKET" : "ACCOUNT",
                symbol: eventSymbol ?? null,
                reason: failure.stage,
                evidence,
              })
              if (blocker?.ok !== true || blocker.data?.durable !== true) {
                logger.error?.({
                  message: "terminal user-data safety blocker could not be durably committed",
                  symbol: eventSymbol,
                  failureCategory: failure.category,
                  failureStage: failure.stage,
                  errors: blocker?.errors,
                })
              }
            } catch (error) {
              logger.error?.({
                message: "terminal user-data safety blocker append failed",
                symbol: eventSymbol,
                failureCategory: failure.category,
                failureStage: failure.stage,
                error,
              })
            }
          }
          logger.error?.({
            message: getUserDataFailureMessage(failure),
            failureCategory: failure.category,
            failureStage: failure.stage,
            failureRetryable: retryable,
            eventType: event.eventType ?? "UNKNOWN",
            executionType: event.executionType,
            symbol: rejectedOrder?.market?.symbol ?? event.fill?.market?.symbol,
            brokerOrderId: incomingBrokerOrderId,
            clientOrderId: incomingClientOrderId,
            originalClientOrderId: event.originalClientOrderId,
            side: rejectedOrder?.side ?? event.fill?.side,
            orderStatus: rejectedOrder?.status,
            executionId: event.fill?.id ?? event.executionId,
            registryMatchedByClientOrderId: Boolean(clientIdMatch),
            registryMatchedByBrokerOrderId: Boolean(brokerIdMatch),
            clientIdMatchStatus: clientIdMatch?.status,
            clientIdMatchBrokerOrderId: clientIdMatch?.brokerOrderId,
            brokerIdMatchClientOrderId: brokerIdMatch?.clientOrderId,
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
          return
        }
        logger.info?.({
          message: "Order update processed",
          eventType: event.eventType ?? "UNKNOWN",
          executionType: event.executionType,
          symbol: event.executedOrder?.market?.symbol ?? event.fill?.market?.symbol,
          brokerOrderId: event.executedOrder?.brokerOrderId ?? event.fill?.brokerOrderId,
          clientOrderId: event.executedOrder?.clientOrderId ?? event.clientOrderId ?? event.fill?.clientOrderId,
          originalClientOrderId: event.originalClientOrderId,
          side: event.executedOrder?.side ?? event.fill?.side,
          price: event.executedOrder?.limitPrice?.amount ?? null,
          quantity: event.executedOrder?.originalQuantity?.amount,
          orderStatus: event.executedOrder?.status,
          executionId: event.fill?.id,
          outcome: processed.data?.ignored === true ? "IGNORED" : "ACCEPTED",
          ignored: processed.data?.ignored === true,
          fillApplied: event.executionType === "TRADE" && processed.data?.ignored !== true,
        })
        if (processed.data?.reevaluate === true) { reevaluateSymbol = event.executedOrder.market.symbol }
      } else if (isOrderUpdate && tradingEnabled) {
        state.accountingFailed = true
        state.ready = false
        state.status = "UNOWNED_ORDER_EVENT_BEFORE_ENGINE_READY"
        logger.error?.({
          message: "received an order report before its order-ownership registry was ready",
          symbol: event.executedOrder?.market?.symbol ?? event.fill?.market?.symbol,
          brokerOrderId: event.executedOrder?.brokerOrderId ?? event.fill?.brokerOrderId,
        })
        return
      }

      try {
        await onUserDataEvent({
          event,
          recoveryMode,
          portfolio: getPortfolio(),
          recoveryLedger: event.fill instanceof Fill
            ? getRecoveryLedger({ marketId: event.fill.market.id })
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
    }).catch((error) => {
      state.accountingFailed = true
      state.ready = false
      state.status = "EVENT_QUEUE_FAILED"
      logger.error?.({ message: "user-data event queue failed", error })
    }).finally(async () => {
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
        const reevaluated = await tradingEngine.evaluateLatest({ symbol: reevaluateSymbol })
        if (!reevaluated.ok) { logger.error?.({ message: "next strategy evaluation failed", errors: reevaluated.errors }) }
      }
      resumeDeferredStrategyEvaluations()
    })
    state.eventQueue = task
  }
}
