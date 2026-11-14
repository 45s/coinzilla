import { performance } from "node:perf_hooks"
import {
  stopMarketIntake as stopMarketIntakeDefault,
  stopUserDataIntake as stopUserDataIntakeDefault,
  disconnectBroker as disconnectBrokerDefault,
} from "../broker/cleanup-broker.js"

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function summarizeUnresolvedOrder(order) {
  const symbol = order?.market?.symbol ?? order?.symbol
  return {
    ...(typeof symbol === "string" ? { symbol } : {}),
    ...(typeof order?.side === "string" ? { side: order.side } : {}),
    ...(typeof order?.clientOrderId === "string" ? { clientOrderId: order.clientOrderId } : {}),
    ...(typeof order?.brokerOrderId === "string" ? { brokerOrderId: order.brokerOrderId } : {}),
    ...(typeof order?.status === "string" ? { status: order.status } : {}),
    ...(order?.executedQuantity?.amount !== undefined
      ? { executedQuantity: order.executedQuantity.amount }
      : {}),
    ...(order?.originalQuantity?.amount !== undefined
      ? { originalQuantity: order.originalQuantity.amount }
      : {}),
  }
}

function getSafeFailureReason(error) {
  return error?.recoveryFailure?.stage ??
    (typeof error?.code === "string" ? error.code : null) ??
    error?.name ??
    "UNKNOWN"
}

/**
 * Create an idempotent Harvester shutdown handler.
 *
 * The shutdown path drains accepted work, reconciles owned BUYs, stops user-data
 * intake, then reconciles and verifies recovery SELL coverage against the final
 * accounting state. Shutdown recovery can submit SELLs only; it cannot submit
 * a new standing BUY.
 */
// eslint-disable-next-line max-lines-per-function -- shutdown coordinator encodes the ordered fail-closed lifecycle.
export function createShutdownHandler({
  state,
  logger,
  tradingEnabled,
  getTradingEngine,
  subscriptions,
  bookSubscriptions,
  marketPriceIntake,
  getUserDataSubscription,
  broker,
  brokerName,
  eventPublisher,
  publishAccountSnapshot,
  stopMarketIntake = stopMarketIntakeDefault,
  stopUserDataIntake = stopUserDataIntakeDefault,
  disconnectBroker = disconnectBrokerDefault,
  now = () => performance.now(),
  runtimeSessionId,
} = {}) {
  let shutdownPromise
  return function stop({
    requestedAt,
    requestLogged = false,
    stopStateEstablishedLogged = false,
    preShutdownErrors = []
  } = {}) {
    if (shutdownPromise) {return shutdownPromise}
    if (state.stopped) {return Promise.resolve()}

    const shutdownRequestedAt = requestedAt ?? now()
    const shutdownCorrelationId = runtimeSessionId ?? null
    const logPhase = ({
      phase,
      status,
      durationMs,
      failureReason
    } = {}) => {
      logSystem(logger, {
        message: "Harvester shutdown phase " + status.toLowerCase(),
        shutdownPhase: phase,
        phaseStatus: status,
        shutdownCorrelationId,
        elapsedMs: Math.max(0, now() - shutdownRequestedAt),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(failureReason ? { failureReason } : {}),
      })
    }
    const isPhaseFailure = (result) =>
      result?.ok === false || (Array.isArray(result) && result.length > 0)
    // eslint-disable-next-line complexity -- reason fallback chain preserves bounded diagnostics across phase result shapes.
    const getPhaseFailureReason = (result) =>
      result?.failure?.stage ??
      result?.data?.findings?.[0]?.reason ??
      result?.errors?.[0]?.recoveryFailure?.stage ??
      result?.errors?.[0]?.code ??
      result?.errors?.[0]?.name ??
      "PHASE_RESULT_FAILED"
    const runPhase = async (...args) => {
      const [phase, operation, isFailure = isPhaseFailure] = args
      const startedAt = now()
      logPhase({
        phase,
        status: "STARTED"
      })
      try {
        const result = await operation()
        const failed = isFailure(result)
        logPhase({
          phase,
          status: failed ? "FAILED" : "COMPLETED",
          durationMs: Math.max(0, now() - startedAt),
          ...(failed ? { failureReason: getPhaseFailureReason(result) } : {}),
        })
        return result
      } catch (error) {
        logPhase({
          phase,
          status: "FAILED",
          durationMs: Math.max(0, now() - startedAt),
          failureReason: getSafeFailureReason(error),
        })
        throw error
      }
    }

    if (!requestLogged) {
      logPhase({
        phase: "SHUTDOWN_REQUESTED",
        status: "COMPLETED",
        durationMs: 0
      })
    }
    const stateEstablishedAt = now()
    const shutdownStartedFromStatus = state.status
    state.stopped = true
    state.ready = false
    state.status = "STOPPING"
    if (!stopStateEstablishedLogged) {
      logPhase({
        phase: "STOP_STATE_ESTABLISHED",
        status: "COMPLETED",
        durationMs: Math.max(0, stateEstablishedAt - shutdownRequestedAt),
      })
    }

    // eslint-disable-next-line complexity, max-statements -- ordered shutdown phases are the safety contract.
    shutdownPromise = (async () => {
      const tradingEngine = getTradingEngine()
      const userDataSubscription = getUserDataSubscription()
      const auditReasons = preShutdownErrors.length > 0 ? ["OPERATOR_CONTROL_SHUTDOWN_FAILED"] : []
      const stageFailures = []
      let snapshotError
      let unresolvedOrders = []
      let recoverySellFindings = []
      let recoverySellReconciliation

      const logShutdownFailure = ({
        message,
        stage,
        result,
        error
      } = {}) => {
        let errors
        if (error) {
          errors = [error]
        } else if (result?.errors?.length) {
          const { errors: resultErrors } = result
          errors = resultErrors
        } else {
          errors = [new Error(message)]
        }
        const failure = result?.failure ?? error?.recoveryFailure ??
          errors.find((entry) => entry?.recoveryFailure)?.recoveryFailure
        const failureMetadata = failure
          ? {
            category: failure.category ?? null,
            stage: failure.stage ?? null,
            retryable: typeof failure.retryable === "boolean" ? failure.retryable : null,
          }
          : null
        const errorDetails = errors.map((entry) => ({
          name: entry?.name ?? "Error",
          code: typeof entry?.code === "string" ? entry.code : null,
          failureStage: entry?.recoveryFailure?.stage ?? null,
        }))
        stageFailures.push({
          stage: stage ?? "UNKNOWN",
          failure: failureMetadata,
          errors: errorDetails
        })
        logger.error?.({
          message,
          stage,
          failure: failureMetadata,
          errors: errorDetails,
          shutdownCorrelationId,
        })
      }

      const runPhaseSafely = async ({
        phase,
        operation,
        stage,
        message,
        auditReason,
        isFailure,
      } = {}) => {
        try {
          const result = await runPhase(phase, operation, isFailure)
          const failed = isFailure ? isFailure(result) : isPhaseFailure(result)
          if (failed) {
            if (auditReason && !auditReasons.includes(auditReason)) auditReasons.push(auditReason)
            const errors = Array.isArray(result)
              ? result.flatMap((entry) => entry?.status === "rejected" ? [entry.reason] : [entry])
              : result?.errors ?? []
            logShutdownFailure({
              message,
              stage,
              result: { errors },
            })
          }
          return result
        } catch (error) {
          if (auditReason && !auditReasons.includes(auditReason)) auditReasons.push(auditReason)
          logShutdownFailure({
            message,
            stage,
            error
          })
          return {
            ok: false,
            errors: [error]
          }
        }
      }

      const marketIntakeResult = await runPhaseSafely({
        phase: "MARKET_INTAKE_STOP",
        operation: () => stopMarketIntake({
          subscriptions,
          bookSubscriptions
        }),
        stage: "MARKET_INTAKE_STOP",
        message: "Shutdown market-intake stop failed",
        auditReason: "MARKET_INTAKE_SHUTDOWN_FAILED",
      })
      const marketIntakeErrors = Array.isArray(marketIntakeResult)
        ? marketIntakeResult
        : marketIntakeResult?.errors ?? []
      // Unsubscribing prevents new callbacks; accepted market work must finish
      // before the first owned-order reconciliation or BUY cancellation.
      const pendingMarketTasks = [...marketPriceIntake.values()]
        .map(({ latestWebSocketPriceTask }) => latestWebSocketPriceTask)
        .filter(Boolean)
      await runPhaseSafely({
        phase: "MARKET_WORK_DRAIN",
        operation: () => Promise.allSettled(pendingMarketTasks),
        stage: "MARKET_WORK_DRAIN",
        message: "Shutdown market-work drain failed",
        auditReason: "MARKET_WORK_DRAIN_FAILED",
        isFailure: (results) => results.some((result) => result.status === "rejected"),
      })
      await runPhaseSafely({
        phase: "USER_DATA_DRAIN_INITIAL",
        operation: () => state.eventQueue,
        stage: "USER_DATA_DRAIN_INITIAL",
        message: "Initial shutdown user-data drain failed",
        auditReason: "USER_DATA_DRAIN_FAILED",
      })

      if (tradingEnabled && tradingEngine) {
        try {
          const reconciliation = await runPhase("INITIAL_RECONCILIATION", () =>
            tradingEngine.reconcileOwnedOrders())
          if (reconciliation?.ok !== true) {
            auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
            logShutdownFailure({
              message: "Shutdown order reconciliation failed",
              stage: "BEFORE_BUY_CANCELLATION",
              result: reconciliation,
            })
          }
        } catch (error) {
          auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
          logShutdownFailure({
            message: "Shutdown order reconciliation failed",
            stage: "BEFORE_BUY_CANCELLATION",
            error,
          })
        }

        try {
          const cancellation = await runPhase("BUY_CANCELLATION", () =>
            tradingEngine.cancelOwnedBuyOrdersForShutdown())
          if (cancellation?.ok !== true) {
            auditReasons.push("OWNED_BUY_CANCELLATION_FAILED")
            logShutdownFailure({
              message: "Shutdown BUY cancellation failed",
              stage: "CANCEL_OWNED_BUYS",
              result: cancellation,
            })
          }
        } catch (error) {
          auditReasons.push("OWNED_BUY_CANCELLATION_FAILED")
          logShutdownFailure({
            message: "Shutdown BUY cancellation failed",
            stage: "CANCEL_OWNED_BUYS",
            error,
          })
        }
      }

      // Fills racing BUY cancellation are applied before user-data intake stops.
      await runPhaseSafely({
        phase: "USER_DATA_DRAIN",
        operation: () => state.eventQueue,
        stage: "USER_DATA_DRAIN",
        message: "Shutdown user-data drain failed",
        auditReason: "USER_DATA_DRAIN_FAILED",
      })
      const userDataIntakeResult = await runPhaseSafely({
        phase: "USER_DATA_INTAKE_STOP",
        operation: () => stopUserDataIntake({ userDataSubscription }),
        stage: "USER_DATA_INTAKE_STOP",
        message: "Shutdown user-data intake stop failed",
        auditReason: "USER_DATA_INTAKE_SHUTDOWN_FAILED",
      })
      const userDataIntakeErrors = Array.isArray(userDataIntakeResult)
        ? userDataIntakeResult
        : userDataIntakeResult?.errors ?? []
      state.intakeStopped = true
      await runPhaseSafely({
        phase: "USER_DATA_DRAIN_FINAL",
        operation: () => state.eventQueue,
        stage: "USER_DATA_DRAIN_FINAL",
        message: "Final shutdown user-data drain failed",
        auditReason: "USER_DATA_DRAIN_FAILED",
      })

      if (tradingEnabled && tradingEngine) {
        try {
          const reconciliation = await runPhase("FINAL_RECONCILIATION", () =>
            tradingEngine.reconcileOwnedOrders())
          if (reconciliation?.ok !== true) {
            auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
            logShutdownFailure({
              message: "Final shutdown order reconciliation failed",
              stage: "FINAL_OWNED_ORDER_RECONCILIATION",
              result: reconciliation,
            })
          }
        } catch (error) {
          auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
          logShutdownFailure({
            message: "Final shutdown order reconciliation failed",
            stage: "FINAL_OWNED_ORDER_RECONCILIATION",
            error,
          })
        }

        try {
          recoverySellReconciliation = await runPhase("RECOVERY_SELL_RECONCILIATION", () =>
            tradingEngine.reconcileRecoverySellsForShutdown())
          if (recoverySellReconciliation?.ok !== true) {
            auditReasons.push("SHUTDOWN_RECOVERY_SELL_RECONCILIATION_FAILED")
            logShutdownFailure({
              message: "Shutdown recovery SELL reconciliation failed",
              stage: "SHUTDOWN_RECOVERY_SELL_RECONCILIATION",
              result: recoverySellReconciliation,
            })
          }
        } catch (error) {
          auditReasons.push("SHUTDOWN_RECOVERY_SELL_RECONCILIATION_FAILED")
          logShutdownFailure({
            message: "Shutdown recovery SELL reconciliation failed",
            stage: "SHUTDOWN_RECOVERY_SELL_RECONCILIATION",
            error,
          })
        }

        // Verify replacement acknowledgements and any immediate fills before
        // evaluating final coverage or writing the CLOSING audit.
        try {
          const reconciliation = await runPhase("POST_REPLAN_RECONCILIATION", () =>
            tradingEngine.reconcileOwnedOrders())
          if (reconciliation?.ok !== true) {
            auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
            logShutdownFailure({
              message: "Post-replan shutdown order reconciliation failed",
              stage: "POST_REPLAN_OWNED_ORDER_RECONCILIATION",
              result: reconciliation,
            })
          }
        } catch (error) {
          auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
          logShutdownFailure({
            message: "Post-replan shutdown order reconciliation failed",
            stage: "POST_REPLAN_OWNED_ORDER_RECONCILIATION",
            error,
          })
        }

        try {
          const coverage = await runPhase(
            "RECOVERY_SELL_COVERAGE_AUDIT",
            () => tradingEngine.auditShutdownRecoverySellCoverage(),
            (result) => result?.ok !== true || result.data?.covered !== true,
          )
          recoverySellFindings = coverage?.data?.findings ?? []
          if (coverage?.ok !== true || coverage.data?.covered !== true) {
            auditReasons.push("SHUTDOWN_RECOVERY_SELL_COVERAGE_INCOMPLETE")
            for (const finding of recoverySellFindings) {
              auditReasons.push(
                `SHUTDOWN_RECOVERY_SELL_COVERAGE:${finding.symbol}:${finding.reason}:required=${finding.requiredQuantity ?? "unknown"}:committed=${finding.committedQuantity ?? "unknown"}`,
              )
            }
            logShutdownFailure({
              message: "Final recovery SELL coverage is incomplete",
              stage: "SHUTDOWN_RECOVERY_SELL_COVERAGE_AUDIT",
              result: coverage,
            })
          }
        } catch (error) {
          auditReasons.push("SHUTDOWN_RECOVERY_SELL_COVERAGE_INCOMPLETE")
          logShutdownFailure({
            message: "Final recovery SELL coverage audit failed",
            stage: "SHUTDOWN_RECOVERY_SELL_COVERAGE_AUDIT",
            error,
          })
        }

        const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"])
        unresolvedOrders = tradingEngine.getOrders().filter((order) => {
          if (terminalStatuses.has(order.status)) return false
          if (order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status)) return false
          return true
        })
        if (unresolvedOrders.length > 0) auditReasons.push(`UNRESOLVED_OWNED_ORDERS:${unresolvedOrders.length}`)
        if (state.accountingFailed || state.requiresReconciliation || state.safetyHaltRequired) {
          auditReasons.push("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")
        }
      }

      if (tradingEnabled) {
        const closingAuditResult = await runPhaseSafely({
          phase: "CLOSING_AUDIT",
          operation: () => publishAccountSnapshot({
            phase: "CLOSING",
            auditStatus: auditReasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
            auditReasons,
          }),
          stage: "CLOSING_AUDIT",
          message: "Closing account snapshot failed",
          auditReason: "CLOSING_ACCOUNT_SNAPSHOT_FAILED",
          isFailure: (result) => result?.ok === false,
        })
        if (closingAuditResult?.ok === false) {
          snapshotError = closingAuditResult.errors?.[0] ?? new Error("Closing account snapshot failed")
        }
      }

      const disconnectResult = await runPhaseSafely({
        phase: "BROKER_DISCONNECT",
        operation: () => disconnectBroker({
          broker,
          brokerName,
          eventPublisher,
          logger
        }),
        stage: "BROKER_DISCONNECT",
        message: "Broker disconnect failed",
      })
      let disconnectErrors = []
      if (Array.isArray(disconnectResult)) {
        disconnectErrors = disconnectResult
      } else if (disconnectResult?.ok === false) {
        disconnectErrors = disconnectResult.errors?.length > 0
          ? disconnectResult.errors
          : [new Error("Broker disconnect failed")]
      }
      const shutdownAuditFailed = tradingEnabled && auditReasons.length > 0
      const auditError = shutdownAuditFailed
        ? new Error(`CLOSING account audit is incomplete: ${auditReasons.join(", ")}`)
        : undefined
      const cleanupErrors = [
        ...preShutdownErrors,
        ...marketIntakeErrors,
        ...userDataIntakeErrors,
        ...disconnectErrors,
        ...(snapshotError ? [snapshotError] : []),
        ...(auditError ? [auditError] : []),
      ]
      const shutdownDiagnostics = Object.freeze({
        previousStatus: shutdownStartedFromStatus ?? null,
        shutdownCorrelationId,
        auditReasons: Object.freeze([...auditReasons]),
        recoverySellReconciliation: recoverySellReconciliation?.ok === true
          ? Object.freeze({
            ok: true,
            reconciledSymbols: recoverySellReconciliation.data?.reconciledSymbols ?? []
          })
          : Object.freeze({ ok: false }),
        recoverySellFindings: Object.freeze(recoverySellFindings.map((finding) => Object.freeze({ ...finding }))),
        failureReasons: Object.freeze(stageFailures.flatMap((entry) =>
          entry.errors.map((error) => error.failureStage ?? error.code ?? error.name))),
        stageFailures: Object.freeze(stageFailures.map((failure) => Object.freeze({
          stage: failure.stage,
          failure: failure.failure ? Object.freeze({ ...failure.failure }) : null,
          errors: Object.freeze(failure.errors.map((error) => Object.freeze({ ...error }))),
        }))),
        cleanupFailures: Object.freeze(cleanupErrors.map((error) => Object.freeze({
          name: error?.name ?? "Error",
          code: typeof error?.code === "string" ? error.code : null,
          failureStage: error?.recoveryFailure?.stage ?? null,
        }))),
        userData: Object.freeze({
          accountingFailed: state.accountingFailed === true,
          requiresReconciliation: state.requiresReconciliation === true,
          safetyHaltRequired: state.safetyHaltRequired === true,
          retryableRecoveryFailure: state.retryableRecoveryFailure
            ? Object.freeze({
              generation: state.retryableRecoveryFailure.generation,
              category: state.retryableRecoveryFailure.category,
              stage: state.retryableRecoveryFailure.stage,
              retryable: state.retryableRecoveryFailure.retryable,
            })
            : null,
          recoveryGeneration: Number.isSafeInteger(state.recoveryGeneration) ? state.recoveryGeneration : null,
          lastAcknowledgedRecoveryGeneration: Number.isSafeInteger(state.lastAcknowledgedRecoveryGeneration)
            ? state.lastAcknowledgedRecoveryGeneration
            : null,
        }),
        unresolvedOrders: Object.freeze(unresolvedOrders.map((order) =>
          Object.freeze(summarizeUnresolvedOrder(order)))),
      })
      if (cleanupErrors.length > 0) {
        state.status = "SHUTDOWN_INCOMPLETE"
        logger.error?.({
          message: "Shutdown incomplete; runtime did not reach STOPPED",
          ...shutdownDiagnostics,
        })
        logPhase({
          phase: "SHUTDOWN_FAILED",
          status: "FAILED",
          durationMs: Math.max(0, now() - shutdownRequestedAt),
          failureReason: "SHUTDOWN_INCOMPLETE",
        })
        const shutdownError = new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
        shutdownError.shutdownDiagnostics = shutdownDiagnostics
        throw shutdownError
      }
      state.status = "STOPPED"
      logPhase({
        phase: "RUNTIME_SHUTDOWN_COMPLETED",
        status: "COMPLETED",
        durationMs: Math.max(0, now() - shutdownRequestedAt),
      })
    })()
    return shutdownPromise
  }
}
