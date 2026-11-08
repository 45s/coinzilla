/**
 * Create the application-side user-data recovery coordinator.
 *
 * The coordinator reconciles owned orders, brackets REST snapshots with the
 * serialized user-data event sequence, durably publishes account/open-order
 * audits, and acknowledges the broker recovery generation only after all
 * application checks succeed.
 */
export function createUserDataRecoveryHandler({
  state, isStopped, getUserDataSubscription, getTradingEngine, tradingEnabled,
  broker, drainUserDataEvents, setCanonicalOwnershipReconciled,
  refreshAccountSnapshot, publishAccountSnapshot, publishOpenOrdersSnapshot, logger,
} = {}) {
  return function startUserDataRecovery() {
    const userDataSubscription = getUserDataSubscription()
    const tradingEngine = getTradingEngine()
    let hasCanonicalOwnershipReconciliation = false
    if (isStopped()) {
      state.pendingRecovery = false
      return
    }
    if (!state.startupComplete) {
      state.pendingRecovery = state.requiresReconciliation &&
        !state.accountingFailed &&
        !state.recoveryTask &&
        state.lastAcknowledgedRecoveryGeneration !== state.recoveryGeneration
      return
    }

    // This flag only represents work deferred by the startup barrier. Once
    // startup is complete, reminders either start/retry recovery or are ignored.
    state.pendingRecovery = false
    if (!state.requiresReconciliation || state.accountingFailed || state.recoveryTask ||
      state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration) {
      return
    }
    if (typeof userDataSubscription?.acknowledgeRecovery !== "function") {
    logger.error?.({
      message: "cannot acknowledge user-data recovery; subscription acknowledgement is unavailable",
    })
    return
    }

    state.pendingRecovery = false
    const generation = state.recoveryGeneration
    const isCurrentGeneration = () => !isStopped() && generation === state.recoveryGeneration
    const recoveryTask = (async () => {
    try {
      logger.info?.({
        message: "application recovery started after user-data transport reconnect",
        generation,
      })

      let reconciliation = { ok: true, data: { reconciled: 0, symbols: [] } }
      if (tradingEnabled) {
        if (!tradingEngine) throw new Error("Trading engine is unavailable during user-data recovery")
        reconciliation = await tradingEngine.reconcileOwnedOrders({
          recoveryMode: true,
          beforeApply: drainUserDataEvents,
        })
        if (!reconciliation?.ok) {
          throw reconciliation?.errors?.[0] ?? new Error("Owned-order REST/stream reconciliation failed")
        }
        hasCanonicalOwnershipReconciliation = true
        setCanonicalOwnershipReconciled(true)
      }
      while (true) {
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")

        // Keep the account and open-order snapshots on the same side of all
        // user-data events observed during the REST reads and durable flushes.
        const eventSequence = state.eventSequence
        const snapshot = await refreshAccountSnapshot()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        const openOrdersResult = await broker.getOpenOrders({})
        if (!openOrdersResult?.ok || !Array.isArray(openOrdersResult.data)) {
          const details = openOrdersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
          throw new Error(
            "Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""),
          )
        }
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        if (eventSequence !== state.eventSequence) continue

        await publishAccountSnapshot({ phase: "RECOVERY", snapshot })
        await publishOpenOrdersSnapshot({
          phase: "RECOVERY",
          blockOnExistingOrders: tradingEnabled,
          ownershipReconciled: tradingEnabled && hasCanonicalOwnershipReconciliation,
          orders: openOrdersResult.data,
        })
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        if (eventSequence === state.eventSequence) break
      }

      // The broker only emits "reconciled" after every subscriber acknowledges.
      // Keep the application gate closed unless this generation has passed
      // order/fill reconciliation and durable account/order audits.
      state.requiresReconciliation = false
      const acknowledged = userDataSubscription.acknowledgeRecovery()
      if (acknowledged !== true) {
        state.requiresReconciliation = true
        throw new Error("Broker rejected the application recovery acknowledgement")
      }
      state.lastAcknowledgedRecoveryGeneration = generation
      logger.info?.({
        message: "application recovery completed and broker acknowledgement accepted",
        generation,
        reconciledOrders: reconciliation.data?.reconciled ?? 0,
      })
    } catch (error) {
      state.ready = false
      state.requiresReconciliation = true
      state.status = state.accountingFailed
        ? "EXECUTION_ACCOUNTING_FAILED"
        : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
      logger.error?.({
        message: "application recovery failed; trading remains blocked",
        generation,
        errorName: error?.name ?? "Error",
        errorMessage: error?.message || String(error),
        errorStack: error?.stack,
      })
    } finally {
      if (state.recoveryTask === recoveryTask) state.recoveryTask = null
    }
    })()
    state.recoveryTask = recoveryTask
  }
}
