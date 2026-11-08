import { Fill } from "@coinzilla/entities"

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
  cancelOwnedBuysAfterAccountingFailure, resumeDeferredStrategyEvaluations,
} = {}) {
  return ({ event } = {}) => {
    const tradingEngine = getTradingEngine()
    const tradingEnabled = isTradingEnabled()
    if (userDataState.intakeStopped) return
    const isExecution = event?.eventType === "executionReport" &&
      event?.executionType === "TRADE"
    const isOrderUpdate = event?.eventType === "executionReport"
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      userDataState.ready = false
      userDataState.accountingFailed = true
      userDataState.status = "INVALID_EVENT"
      void cancelOwnedBuysAfterAccountingFailure()
      return
    }
    userDataState.eventSequence += 1
    let reevaluateSymbol

    if (isExecution) {
      logger.info?.({
        message: "Trade execution received",
        symbol: event.fill?.market?.symbol ?? event.executedOrder?.market?.symbol,
        side: event.fill?.side ?? event.executedOrder?.side,
      })
    }
    const task = userDataState.eventQueue.then(async () => {
      if (tradingEngine && isOrderUpdate) {
        const processed = await tradingEngine.processUserDataEvent({
          event,
        })
        if (!processed.ok) {
          userDataState.ready = false
          userDataState.accountingFailed = true
          userDataState.status = "EXECUTION_ACCOUNTING_FAILED"
          const rejectedOrder = event.executedOrder
          const registeredOrders = tradingEngine.getOrders()
          const incomingBrokerOrderId = rejectedOrder?.brokerOrderId ?? event.fill?.brokerOrderId
          const incomingClientOrderId = rejectedOrder?.clientOrderId ?? event.clientOrderId ?? event.fill?.clientOrderId
          const clientIdMatch = registeredOrders.find((order) =>
            order.clientOrderId === incomingClientOrderId)
          const brokerIdMatch = registeredOrders.find((order) =>
            incomingBrokerOrderId !== undefined &&
            order.brokerOrderId === incomingBrokerOrderId)
          logger.error?.({
            message: "rejected an unowned or invalid order event",
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
              name: error?.name ?? "Error",
              message: error?.message ?? String(error),
              stack: error?.stack,
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
        if (processed.data?.reevaluate === true) reevaluateSymbol = event.executedOrder.market.symbol
      } else if (isOrderUpdate && tradingEnabled) {
        userDataState.accountingFailed = true
        userDataState.ready = false
        userDataState.status = "UNOWNED_ORDER_EVENT_BEFORE_ENGINE_READY"
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
      userDataState.accountingFailed = true
      userDataState.ready = false
      userDataState.status = "EVENT_QUEUE_FAILED"
      logger.error?.({ message: "user-data event queue failed", error })
    }).finally(async () => {
      if (isStopped()) {
        userDataState.ready = false
        userDataState.status = "STOPPED"
        return
      }
      if (userDataState.accountingFailed) {
        userDataState.ready = false
        await cancelOwnedBuysAfterAccountingFailure()
        return
      }
      if (userDataState.requiresReconciliation) {
        userDataState.ready = false
        userDataState.status = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        return
      }
      if (!userDataState.initialAccountSnapshotReady) {
        userDataState.ready = false
        userDataState.status = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
        return
      }
      userDataState.ready = true
      userDataState.status = "READY"
      if (reevaluateSymbol && tradingEngine) {
        const reevaluated = await tradingEngine.evaluateLatest({ symbol: reevaluateSymbol })
        if (!reevaluated.ok) logger.error?.({ message: "next strategy evaluation failed", errors: reevaluated.errors })
      }
      resumeDeferredStrategyEvaluations()
    })
    userDataState.eventQueue = task
  }
}
