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
    if (
      typeof userDataSubscription?.acknowledgeRecoveryResult !== "function" &&
      typeof userDataSubscription?.acknowledgeRecovery !== "function"
    ) {
      logger.error?.({
        message: "cannot acknowledge user-data recovery; subscription acknowledgement is unavailable",
      })
      return
    }
    const brokerRecoveryGeneration = state.recoveryBrokerGeneration
    if (
      typeof userDataSubscription.acknowledgeRecoveryResult === "function" &&
      !Number.isSafeInteger(brokerRecoveryGeneration)
    ) {
      logger.error?.({
        message: "cannot acknowledge user-data recovery; broker recovery generation is unavailable",
      })
      return
    }

    state.pendingRecovery = false
    // A new single-flight attempt clears only the previous retryable marker.
    // Canonical reconciliation and both durable audit barriers must succeed
    // again before this generation can be acknowledged.
    state.retryableRecoveryFailure = null
    const generation = state.recoveryGeneration
    const isCurrentGeneration = () => !isStopped() && generation === state.recoveryGeneration
    const assertNoRetryableRecoveryFailure = () => {
      const failure = state.retryableRecoveryFailure
      if (failure?.generation !== generation) return
      throw new Error(
        "Queued user-data event requires another authoritative recovery attempt: " +
        failure.category + " at " + failure.stage,
      )
    }
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
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (!reconciliation?.ok) {
          const failure = reconciliation?.failure
          if (!failure) {
            state.retryableRecoveryFailure = {
              generation,
              category: "REST_RECONCILIATION",
              stage: "OWNED_ORDER_RECONCILIATION",
              retryable: true,
            }
          } else if (
            failure.retryable === true &&
            ["ORDER_TRANSITION", "REST_RECONCILIATION", "DURABILITY"].includes(failure.category)
          ) {
            state.retryableRecoveryFailure = {
              generation,
              category: failure.category,
              stage: failure.stage,
              retryable: true,
            }
          } else {
            state.accountingFailed = true
            state.retryableRecoveryFailure = null
            state.status = "EXECUTION_ACCOUNTING_FAILED"
          }
          throw reconciliation?.errors?.[0] ?? new Error("Owned-order REST/stream reconciliation failed")
        }
        assertNoRetryableRecoveryFailure()
        hasCanonicalOwnershipReconciliation = true
        setCanonicalOwnershipReconciled(true)
      }
      while (true) {
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()

        // Keep the account and open-order snapshots on the same side of all
        // user-data events observed during the REST reads and durable flushes.
        const eventSequence = state.eventSequence
        const snapshot = await refreshAccountSnapshot()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        const openOrdersResult = await broker.getOpenOrders({})
        if (!openOrdersResult?.ok || !Array.isArray(openOrdersResult.data)) {
          const details = openOrdersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
          const cause = openOrdersResult?.errors?.find?.((error) => error instanceof Error)
          throw new Error(
            "Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""),
            { cause },
          )
        }
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (eventSequence !== state.eventSequence) continue

        await publishAccountSnapshot({ phase: "RECOVERY", snapshot })
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (eventSequence !== state.eventSequence) continue

        await publishOpenOrdersSnapshot({
          phase: "RECOVERY",
          blockOnExistingOrders: tradingEnabled,
          ownershipReconciled: tradingEnabled && hasCanonicalOwnershipReconciliation,
          orders: openOrdersResult.data,
        })
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (eventSequence === state.eventSequence) break
      }

      // The broker only emits "reconciled" after every active subscriber
      // acknowledges. Record local acceptance before the call because the
      // final acknowledgement may publish "reconciled" synchronously.
      const previousAcknowledgedGeneration = state.lastAcknowledgedRecoveryGeneration
      if (typeof userDataSubscription.acknowledgeRecoveryResult === "function") {
        state.lastAcknowledgedRecoveryGeneration = generation
        let acknowledgement
        try {
          acknowledgement = userDataSubscription.acknowledgeRecoveryResult(brokerRecoveryGeneration)
        } catch (error) {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          throw error
        }
        if (acknowledgement?.accepted !== true) {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          const reason = typeof acknowledgement?.reason === "string"
            ? `: ${acknowledgement.reason}`
            : ""
          throw new Error("Broker rejected the application recovery acknowledgement" + reason)
        }
        if (typeof acknowledgement.completed !== "boolean") {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          throw new Error("Broker returned an invalid recovery acknowledgement result")
        }
        if (!acknowledgement.completed) {
          // This subscriber is reconciled, but another active subscriber is
          // still pending. Local acceptance is not application readiness.
          state.ready = false
          state.requiresReconciliation = true
          logger.info?.({
            message: "application recovery acknowledged locally; waiting for broker-wide recovery completion",
            generation,
            reconciledOrders: reconciliation.data?.reconciled ?? 0,
          })
          return
        }
      } else {
        // Compatibility fallback for older broker implementations. Their
        // boolean API cannot distinguish local acceptance from global completion.
        state.lastAcknowledgedRecoveryGeneration = generation
        state.requiresReconciliation = false
        let acknowledged
        try {
          acknowledged = userDataSubscription.acknowledgeRecovery()
        } catch (error) {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          state.requiresReconciliation = true
          throw error
        }
        if (acknowledged !== true) {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          state.requiresReconciliation = true
          throw new Error("Broker rejected the application recovery acknowledgement")
        }
      }
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
        error,
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
