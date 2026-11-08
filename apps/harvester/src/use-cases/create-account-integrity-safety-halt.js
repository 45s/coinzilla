/**
 * Create the account-integrity safety-halt workflow.
 *
 * Reconcile broker-owned order identities before cancelling acknowledged BUYs.
 * Concurrent triggers share one in-flight task so an unsafe stream event and
 * accounting failure cannot race duplicate cancellation passes.
 */
export function createAccountIntegritySafetyHalt({
  getTradingEngine,
  isStopped = () => false,
  logger = {},
} = {}) {
  let cancellationTask

  return function cancelOwnedBuysAfterAccountingFailure() {
    const tradingEngine = getTradingEngine()
    if (!tradingEngine || isStopped()) return Promise.resolve()
    if (cancellationTask) return cancellationTask

    const task = (async () => {
      let reconciliation
      try {
        reconciliation = await tradingEngine.reconcileOwnedOrders()
      } catch (error) {
        logger.error?.({
          message: "account-integrity safety halt could not reconcile owned orders before BUY cancellation",
          error,
        })
      }
      if (reconciliation?.ok !== true) {
        logger.error?.({
          message: "account-integrity safety halt could not fully reconcile owned orders before BUY cancellation",
          result: reconciliation,
        })
      }

      let cancellation
      try {
        cancellation = await tradingEngine.cancelOwnedBuyOrdersForSafetyHalt()
      } catch (error) {
        logger.error?.({
          message: "account-integrity safety halt failed while canceling owned BUY orders",
          error,
        })
        return
      }
      if (cancellation?.ok !== true) {
        logger.error?.({
          message: "account-integrity safety halt could not confirm every owned BUY cancellation",
          result: cancellation,
        })
      }
    })()

    cancellationTask = task.catch((error) => {
      logger.error?.({ message: "account-integrity safety halt workflow failed", error })
    }).finally(() => {
      cancellationTask = null
    })
    return cancellationTask
  }
}
