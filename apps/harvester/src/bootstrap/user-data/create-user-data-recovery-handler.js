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
  if (validStage && (validRetryable || validTerminal)) return failure
  return { category: "ACCOUNTING_INTEGRITY", stage: "UNCLASSIFIED_RECOVERY_FAILURE", retryable: false }
}

function createRecoveryFailureError(error, failure) {
  const normalized = error instanceof Error ? error : new Error(String(error), { cause: error })
  normalized.recoveryFailure = resolveRecoveryFailure(normalized.recoveryFailure ?? failure)
  return normalized
}

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
      throw createRecoveryFailureError(
        new Error("Queued user-data event requires another authoritative recovery attempt: " +
          failure.category + " at " + failure.stage),
        failure,
      )
    }
    const runRecoveryStage = async ({ category, stage, retryable, task }) => {
      try { return await task() } catch (error) {
        throw createRecoveryFailureError(error, { category, stage, retryable })
      }
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
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (!reconciliation?.ok) {
          const failure = resolveRecoveryFailure(reconciliation?.failure)
          if (failure.retryable && !state.accountingFailed) {
            state.retryableRecoveryFailure = { generation, category: failure.category, stage: failure.stage, retryable: true }
          } else {
            state.accountingFailed = true
            state.retryableRecoveryFailure = null
            state.status = "EXECUTION_ACCOUNTING_FAILED"
          }
          throw createRecoveryFailureError(
            reconciliation?.errors?.[0] ?? new Error("Owned-order REST/stream reconciliation failed"),
            failure,
          )
        }
        assertNoRetryableRecoveryFailure()
        hasCanonicalOwnershipReconciliation = true
        setCanonicalOwnershipReconciled(true)
      }
      while (true) {
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()

        // Keep the account and open-order snapshots on the same side of all
        // user-data events observed during the REST reads and durable flushes.
        const eventSequence = state.eventSequence
        const snapshot = await runRecoveryStage({
          category: "ACCOUNTING_INTEGRITY", stage: "ACCOUNT_SNAPSHOT_VALIDATION", retryable: false,
          task: refreshAccountSnapshot,
        })
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        const openOrdersResult = await runRecoveryStage({
          category: "ACCOUNTING_INTEGRITY", stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ_EXCEPTION", retryable: false,
          task: () => broker.getOpenOrders({}),
        })
        if (openOrdersResult?.ok !== false && openOrdersResult?.ok !== true) {
          throw createRecoveryFailureError(
            new Error("Account-wide open-orders response is missing an explicit success flag"),
            { category: "ACCOUNTING_INTEGRITY", stage: "ACCOUNT_WIDE_OPEN_ORDERS_RESPONSE", retryable: false },
          )
        }
        if (openOrdersResult.ok === false) {
          const details = openOrdersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
          const cause = openOrdersResult?.errors?.find?.((error) => error instanceof Error)
          throw createRecoveryFailureError(
            new Error("Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""), { cause }),
            { category: "REST_RECONCILIATION", stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ", retryable: true },
          )
        }
        if (!Array.isArray(openOrdersResult.data)) {
          throw createRecoveryFailureError(
            new Error("Authoritative account-wide open-orders response is not an array"),
            { category: "ACCOUNTING_INTEGRITY", stage: "ACCOUNT_WIDE_OPEN_ORDERS_SNAPSHOT", retryable: false },
          )
        }
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (eventSequence !== state.eventSequence) continue

        await runRecoveryStage({
          category: "ACCOUNTING_INTEGRITY", stage: "RECOVERY_ACCOUNT_AUDIT_VALIDATION", retryable: false,
          task: () => publishAccountSnapshot({ phase: "RECOVERY", snapshot }),
        })
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        if (eventSequence !== state.eventSequence) continue

        await runRecoveryStage({
          category: "ACCOUNTING_INTEGRITY", stage: "RECOVERY_OPEN_ORDERS_AUDIT_VALIDATION", retryable: false,
          task: () => publishOpenOrdersSnapshot({
            phase: "RECOVERY",
            blockOnExistingOrders: tradingEnabled,
            ownershipReconciled: tradingEnabled && hasCanonicalOwnershipReconciliation,
            orders: openOrdersResult.data,
          }),
        })
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
        if (state.accountingFailed) throw new Error("User-data accounting failed during recovery")
        assertNoRetryableRecoveryFailure()
        await drainUserDataEvents()
        if (!isCurrentGeneration()) throw createRecoveryFailureError(
          new Error("User-data recovery generation was superseded"),
          { category: "ORDER_TRANSITION", stage: "RECOVERY_GENERATION_FENCING", retryable: true },
        )
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
          throw createRecoveryFailureError(error, { category: "ORDER_TRANSITION", stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT", retryable: true })
        }
        if (acknowledgement?.accepted !== true) {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          const reason = typeof acknowledgement?.reason === "string"
            ? `: ${acknowledgement.reason}`
            : ""
          throw createRecoveryFailureError(
            new Error("Broker rejected the application recovery acknowledgement" + reason),
            { category: "ORDER_TRANSITION", stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT", retryable: true },
          )
        }
        if (typeof acknowledgement.completed !== "boolean") {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          throw createRecoveryFailureError(
            new Error("Broker returned an invalid recovery acknowledgement result"),
            { category: "ORDER_TRANSITION", stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT", retryable: true },
          )
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
          throw createRecoveryFailureError(error, { category: "ORDER_TRANSITION", stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT", retryable: true })
        }
        if (acknowledged !== true) {
          state.lastAcknowledgedRecoveryGeneration = previousAcknowledgedGeneration
          state.requiresReconciliation = true
          throw createRecoveryFailureError(
            new Error("Broker rejected the application recovery acknowledgement"),
            { category: "ORDER_TRANSITION", stage: "BROKER_RECOVERY_ACKNOWLEDGEMENT", retryable: true },
          )
        }
      }
      logger.info?.({
        message: "application recovery completed and broker acknowledgement accepted",
        generation,
        reconciledOrders: reconciliation.data?.reconciled ?? 0,
      })
    } catch (error) {
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

      if (!isCurrentGeneration()) {
        logger.error?.({
          message: "application recovery failed; trading remains blocked",
          generation,
          currentGeneration: state.recoveryGeneration,
          staleGeneration: true,
          failureCategory: error?.recoveryFailure?.category,
          failureStage: error?.recoveryFailure?.stage,
          error,
          errorName: error?.name ?? "Error",
          errorMessage,
          errorStack: error?.stack,
          cause,
          causeName: cause instanceof Error ? cause.name : undefined,
          causeMessage,
          causeStack: cause instanceof Error ? cause.stack : undefined,
        })
        return
      }

      const failure = resolveRecoveryFailure(error?.recoveryFailure)
      if (failure.retryable && !state.accountingFailed) {
        state.retryableRecoveryFailure = { generation, category: failure.category, stage: failure.stage, retryable: true }
      } else {
        state.accountingFailed = true
        state.retryableRecoveryFailure = null
      }
      state.ready = false
      state.requiresReconciliation = true
      state.status = state.accountingFailed ? "EXECUTION_ACCOUNTING_FAILED" : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
      logger.error?.({
        message: "application recovery failed; trading remains blocked",
        generation,
        failureCategory: state.retryableRecoveryFailure?.category,
        failureStage: state.retryableRecoveryFailure?.stage,
        error,
        errorName: error?.name ?? "Error",
        errorMessage,
        errorStack: error?.stack,
        cause,
        causeName: cause instanceof Error ? cause.name : undefined,
        causeMessage,
        causeStack: cause instanceof Error ? cause.stack : undefined,
      })
    } finally {
      if (state.recoveryTask === recoveryTask) state.recoveryTask = null
    }
    })()
    state.recoveryTask = recoveryTask
  }
}
