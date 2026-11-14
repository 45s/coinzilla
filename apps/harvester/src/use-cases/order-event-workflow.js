import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { compareDecimal, toResult } from "@coinzilla/utils"
import { EXTERNAL_ORDERS_POLICIES } from "../domain/external-orders-policy.js"
import { isHarvesterClientOrderId } from "../application/orders/is-harvester-client-order-id.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import {
  mapBrokerExecutionReportData,
  mapExecutionInvalidFillData,
  mapExecutionAccountingFailedData,
  mapExecutionUnownedOrderData,
  mapOrderUpdatedData,
  mapFillAppliedData,
  mapDuplicateFillData,
  mapRecoveryCycleCompletedData,
} from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { makeReconcileTerminalOrderFills } from "./reconcile-terminal-order-fills.js"
import { failureResult, withFailure } from "./recovery-failure.js"

/**
 * Coordinate canonical user-data order events and execution-fill application.
 * The caller owns serialization and supplies accounting, cancellation,
 * recovery-cycle and strategy-evaluation transitions.
 */
// eslint-disable-next-line max-lines-per-function -- workflow factory wires serialized event transitions and accounting ports.
export function makeOrderEventWorkflow({
  state,
  broker,
  eventPublisher,
  pairs,
  updateTradingAccounting,
  recordBuyExecutionFill,
  recordSellExecutionFill,
  pause,
  resolveRecoveryManagedCancellation,
  cancelAndReconcileRecoverySells,
  evaluateLatestTransition,
  getReconciledBuyExecutionPrice,
  assertReconciledSellExecution,
  completeRecoveryCycle,
  publishRecoveryCycleNotCompleted,
  isStopping,
} = {}) {
  const processExecutionFillTransition = async ({
    order,
    fill
  } = {}) => {
    try {
      if (!(fill instanceof Fill)) {
        const error = new TypeError("TRADE event requires a canonical Fill")
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL,
          dataResult: mapExecutionInvalidFillData({
            order,
            reason: "MISSING_FILL",
            error
          }),
        })
        return failureResult({
          error,
          category: "REST_RECONCILIATION",
          stage: "STREAM_FILL_MISSING",
          retryable: true,
        })
      }
      if (!(order instanceof CanonicalOrder)) {
        return failureResult({
          error: new TypeError("Execution fill requires its registered canonical order"),
          category: "OWNERSHIP_INTEGRITY",
          stage: "FILL_ORDER_REGISTRY",
          retryable: false,
        })
      }
      const symbol = order.market.symbol
      if (fill.market.id !== order.market.id || fill.side !== order.side ||
          fill.brokerOrderId !== order.brokerOrderId ||
          (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId)) {
        const error = new Error("Canonical Fill identity does not match its registered order")
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL,
          dataResult: mapExecutionInvalidFillData({
            order,
            fill,
            reason: "IDENTITY_MISMATCH",
            error
          }),
        })
        await pause({
          symbol,
          reason: "EXECUTION_FILL_ORDER_IDENTITY_MISMATCH",
          error
        })
        return failureResult({
          error,
          category: "OWNERSHIP_INTEGRITY",
          stage: "FILL_ORDER_IDENTITY",
          retryable: false,
        })
      }
      const accounting = await updateTradingAccounting({ fill })
      if (!accounting?.ok) {
        const error = accounting?.errors?.[0] ?? new Error("Execution accounting failed")
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.EXECUTION_ACCOUNTING_FAILED,
          dataResult: mapExecutionAccountingFailedData({
            order,
            fill,
            error
          }),
        })
        await pause({
          symbol,
          reason: "EXECUTION_ACCOUNTING_FAILED",
          error
        })
        return failureResult({
          errors: accounting?.errors ?? [error],
          category: "ACCOUNTING_INTEGRITY",
          stage: "FILL_ACCOUNTING",
          retryable: false,
        })
      }
      if (fill.side === "BUY") {
        recordBuyExecutionFill({ fill })
        state.completedRecoverySellSymbols.delete(symbol)
        state.completedRecoverySellOrdersBySymbol.delete(symbol)
      }
      if (fill.side === "SELL") {recordSellExecutionFill({ fill })}
      if (accounting.data?.applied === true) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
          dataResult: mapFillAppliedData({ fill }),
        })
      } else if (accounting.data?.duplicate === true) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.EXECUTION_DUPLICATE_FILL,
          dataResult: mapDuplicateFillData({ fill }),
        })
      }
      return toResult({ data: {
        applied: accounting.data?.applied === true,
        duplicate: accounting.data?.duplicate === true
      } })
    } catch (error) {
      return failureResult({
        error,
        category: "ACCOUNTING_INTEGRITY",
        stage: "FILL_ACCOUNTING",
        retryable: false,
      })
    }
  }

  const reconcileTerminalOrderFills = makeReconcileTerminalOrderFills({
    broker,
    processedFillsByOrder: state.processedFillsByOrder,
    pause,
    processExecutionFillTransition,
  })

  const processUserDataEventTransition = async ({
    event,
    recoveryMode = false,
    terminalFillsReconciled = false,
  } = {}) => { // eslint-disable-line complexity, max-lines-per-function, max-statements -- serialized event transition preserves fill and order-state invariants.
    try {
      if (event?.eventType === "executionReport" && event?.brokerEvidence) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.BROKER_EXECUTION_REPORT,
          dataResult: mapBrokerExecutionReportData({ evidence: event.brokerEvidence })
        })
      }
      const order = event?.executedOrder
      if (!(order instanceof CanonicalOrder)) {
        if (event?.eventType === "executionReport") {
          return failureResult({
            error: new TypeError("Execution report requires canonical executedOrder"),
            category: "OWNERSHIP_INTEGRITY",
            stage: "CANONICAL_ORDER_VALIDATION",
            retryable: false,
          })
        }
        return toResult({ data: { ignored: true } })
      }
      const symbol = order.market.symbol
      const update = state.registry.applyUpdate({ order })
      if (update.unknown) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.EXECUTION_UNOWNED_ORDER,
          dataResult: mapExecutionUnownedOrderData({ order }),
        })
        const hasHarvesterIdentity = [
          order.clientOrderId,
          event.clientOrderId,
          event.originalClientOrderId,
        ].some(isHarvesterClientOrderId)
        const externalOrdersPolicy = pairs[symbol]?.externalOrdersPolicy ?? EXTERNAL_ORDERS_POLICIES.IGNORE
        if (!hasHarvesterIdentity && externalOrdersPolicy === EXTERNAL_ORDERS_POLICIES.IGNORE) {
          return toResult({ data: {
            ignored: true,
            externalOrder: true
          } })
        }
        await pause({
          symbol,
          reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT"
        })
        return failureResult({
          error: new Error("Order update does not belong to a Harvester order"),
          category: "OWNERSHIP_INTEGRITY",
          stage: "ORDER_REGISTRY_MATCH",
          retryable: false,
        })
      }
      state.registry = update.registry
      if (update.applied === true) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
          dataResult: mapOrderUpdatedData({
          order,
          executionType: event.executionType,
          evidence: event.brokerEvidence
        })
        })
      }

      if (state.reconciledTerminalOrderClientIds.delete(order.clientOrderId)) {
        return toResult({ data: {
          ignored: true,
          terminalStateAlreadyReconciled: true
        } })
      }

      if (recoveryMode && ["CANCELED", "EXPIRED", "REJECTED"].includes(order.status) &&
          state.unrequestedTerminalOrderClientIds.has(order.clientOrderId)) {
        const error = new Error("Recovered Harvester order reached a terminal exchange state without a durable cancellation intent: " + order.clientOrderId)
        await pause({
          symbol,
          reason: "UNREQUESTED_TERMINAL_ORDER_STATE_DURING_RECOVERY",
          error
        })
        return failureResult({
          error,
          category: "OWNERSHIP_INTEGRITY",
          stage: "UNREQUESTED_TERMINAL_ORDER_STATE",
          retryable: false,
        })
      }

      if (recoveryMode && order.status === "CANCELED" &&
          compareDecimal({
            left: order.executedQuantity.amount,
            right: "0"
          }) === 0) {
        if (resolveRecoveryManagedCancellation({ order })) {
          state.deferredEvaluations.add(symbol)
        }
      }

      if (event.executionType === "TRADE") {
        const fillResult = await processExecutionFillTransition({
          order,
          fill: event.fill
        })
        if (!fillResult.ok) {return fillResult}
      }

      if (!terminalFillsReconciled &&
          ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(order.status)) {
        const terminal = await reconcileTerminalOrderFills({
          order,
          ...(event.executionType === "TRADE" ? { eventFill: event.fill } : {}),
        })
        if (!terminal?.ok) {return terminal}
      }
      if (update.duplicate || update.stale) {
        const isUnprocessedFill = order.status === "FILLED" &&
          !state.completedOrderTransitions.has(order.clientOrderId)
        if (!isUnprocessedFill) {
          if (!recoveryMode && order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status) &&
              order.brokerOrderId && state.replacementIntents.has(symbol)) {
            const cancellation = await cancelAndReconcileRecoverySells({
              symbol,
              marketId: order.market.id
            })
            if (!cancellation.ok) {return withFailure(cancellation, {
              category: "ORDER_TRANSITION",
              stage: "RECOVERY_SELL_CANCELLATION",
              retryable: true
            })}
            if (cancellation.data?.deferred === true) {
              return toResult({ data: {
                ignored: true,
                replacementDeferred: true
              } })
            }
            state.replacementIntents.delete(symbol)
            const replacement = await evaluateLatestTransition({ symbol })
            if (!replacement.ok) {return withFailure(replacement, {
              category: "ORDER_TRANSITION",
              stage: "RECOVERY_SELL_REPLACEMENT",
              retryable: true
            })}
            return toResult({ data: {
              ignored: true,
              recoverySellReplaced: true,
              ...replacement.data
            } })
          }
          return toResult({ data: { ignored: true } })
        }
      }

      if (order.status === "FILLED") {
        if (state.completedOrderTransitions.has(order.clientOrderId)) {
          return toResult({ data: { ignored: true } })
        }
        state.completedOrderTransitions.add(order.clientOrderId)
      }

      if (!recoveryMode && order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status) &&
          state.replacementIntents.has(symbol)) {
        const cancellation = await cancelAndReconcileRecoverySells({
          symbol,
          marketId: order.market.id,
        })
        if (!cancellation.ok) {return withFailure(cancellation, {
          category: "ORDER_TRANSITION",
          stage: "RECOVERY_SELL_CANCELLATION",
          retryable: true
        })}
        if (cancellation.data?.deferred === true) {
          return toResult({ data: {
            order,
            replacementDeferred: true
          } })
        }
        state.replacementIntents.delete(symbol)
        const replacement = await evaluateLatestTransition({ symbol })
        if (!replacement.ok) {return withFailure(replacement, {
          category: "ORDER_TRANSITION",
          stage: "RECOVERY_SELL_REPLACEMENT",
          retryable: true
        })}
        return toResult({ data: {
          order,
          recoverySellReplaced: true,
          ...replacement.data
        } })
      }
      if (!recoveryMode && order.side === "BUY" && order.status === "PARTIALLY_FILLED" &&
          isStopping?.()) {
        state.shutdownRecoveryReplanSymbols.add(symbol)
        return toResult({
          data: {
            order,
            waitingForFullFill: true,
            shutdown: true,
            recoverySellReplanPending: true,
          },
        })
      }
      if (!recoveryMode && order.side === "BUY" && order.status === "PARTIALLY_FILLED" &&
          state.registry.getActiveOrders({ marketId: order.market.id }).some((active) => active.side === "SELL")) {
        const cancellation = await cancelAndReconcileRecoverySells({
          symbol,
          marketId: order.market.id,
        })
        if (!cancellation.ok) {return withFailure(cancellation, {
          category: "ORDER_TRANSITION",
          stage: "RECOVERY_SELL_CANCELLATION",
          retryable: true
        })}
        if (cancellation.data?.deferred === true) {
          return toResult({ data: {
            order,
            replacementDeferred: true,
            waitingForFullFill: true
          } })
        }
        state.replacementIntents.delete(symbol)
        const replacement = await evaluateLatestTransition({ symbol })
        if (!replacement.ok) {return withFailure(replacement, {
          category: "ORDER_TRANSITION",
          stage: "RECOVERY_SELL_REPLACEMENT",
          retryable: true
        })}
        return toResult({
          data: {
            ...replacement.data,
            order,
            recoverySellReplaced: true,
            waitingForFullFill: true,
          },
        })
      }
      if (order.status === "PARTIALLY_FILLED") {
        return toResult({ data: {
          order,
          waitingForFullFill: true
        } })
      }
      if (order.side === "BUY" &&
          ["CANCELED", "EXPIRED", "REJECTED"].includes(order.status) &&
          compareDecimal({
            left: order.executedQuantity.amount,
            right: "0"
          }) > 0) {
        if (isStopping?.()) {state.shutdownRecoveryReplanSymbols.add(symbol)}
        await pause({
          symbol,
          reason: "PARTIALLY_FILLED_ORDER_CANCELED_REQUIRES_REVIEW"
        })
        return failureResult({
          error: new Error("Partially filled order canceled; pair paused for review"),
          category: "ACCOUNTING_INTEGRITY",
          stage: "PARTIAL_FILL_TERMINAL_STATE",
          retryable: false,
        })
      }
      if (!["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(order.status)) {
        return toResult({ data: {
          order,
          waitingForTerminalState: true
        } })
      }
      if (order.status === "FILLED" && order.side === "BUY") {
        if (recoveryMode) {resolveRecoveryManagedCancellation({ order })}
        if (isStopping?.()) {
          state.shutdownRecoveryReplanSymbols.add(symbol)
          let executionPrice
          try {
            executionPrice = getReconciledBuyExecutionPrice({ order })
          } catch (error) {
            await pause({
              symbol,
              reason: "BUY_FILL_RECONCILIATION_FAILED",
              error
            })
            return failureResult({
              error,
              category: "ACCOUNTING_INTEGRITY",
              stage: "BUY_EXECUTION_PRICE",
              retryable: false,
            })
          }
          state.trailingBuy.set(symbol, false)
          state.buyReferenceOverrides.delete(symbol)
          state.lastBuyPrices.set(symbol, executionPrice)
          state.buyExecutionTotals.delete(order.brokerOrderId)
          return toResult({
            data: {
              order,
              shutdown: true,
              recoverySellReplanPending: true,
            },
          })
        }
        let executionPrice
        try {
          executionPrice = getReconciledBuyExecutionPrice({ order })
        } catch (error) {
          await pause({
            symbol,
            reason: "BUY_FILL_RECONCILIATION_FAILED",
            error
          })
          return failureResult({
            error,
            category: "ACCOUNTING_INTEGRITY",
            stage: "BUY_EXECUTION_PRICE",
            retryable: false,
          })
        }
        if (!recoveryMode) {
          const cancellation = await cancelAndReconcileRecoverySells({
            symbol,
            marketId: order.market.id,
          })
          if (!cancellation.ok) {return withFailure(cancellation, {
            category: "ORDER_TRANSITION",
            stage: "RECOVERY_SELL_CANCELLATION",
            retryable: true
          })}
        }
        state.trailingBuy.set(symbol, false)
        state.buyReferenceOverrides.delete(symbol)
        state.lastBuyPrices.set(symbol, executionPrice)
        state.buyExecutionTotals.delete(order.brokerOrderId)
      }
      if (order.status === "REJECTED") {
        await pause({
          symbol,
          reason: "ORDER_REJECTED"
        })
        return toResult({ data: {
          order,
          paused: true
        } })
      }
      if (order.side === "SELL" && ["CANCELED", "EXPIRED"].includes(order.status)) {
        if (recoveryMode) {
          // Recovery reconciliation establishes exchange facts only. It must
          // not submit a replacement until startup has reconciled every
          // same-market cancellation intent and the runtime resumes trading.
          state.deferredEvaluations.add(symbol)
          return toResult({
            data: {
              order,
              terminalFillHistoryReconciled: true,
              recoveryReplacementDeferred: true,
            },
          })
        }
        state.replacementIntents.delete(symbol)
        const replacement = await evaluateLatestTransition({ symbol })
        if (!replacement.ok) {return withFailure(replacement, {
          category: "ORDER_TRANSITION",
          stage: "RECOVERY_SELL_REPLACEMENT",
          retryable: true
        })}
        return toResult({
          data: {
            ...replacement.data,
            order,
            reevaluate: true,
            terminalFillHistoryReconciled: true,
            recoverySellReplaced: true,
          },
        })
      }
      if (order.status === "FILLED" && order.side === "SELL") {
        state.completedRecoverySellSymbols.add(symbol)
        state.completedRecoverySellOrdersBySymbol.set(symbol, order)
        if (recoveryMode) {
          resolveRecoveryManagedCancellation({ order })
        } else {
          state.replacementIntents.delete(symbol)
        }
        try {
          assertReconciledSellExecution({ order })
        } catch (error) {
          await pause({
            symbol,
            reason: "SELL_FILL_RECONCILIATION_FAILED",
            error
          })
          return failureResult({
            error,
            category: "ACCOUNTING_INTEGRITY",
            stage: "SELL_FILL_RECONCILIATION",
            retryable: false,
          })
        }
        const completion = await completeRecoveryCycle({
          marketId: order.market.id,
          keepQuantity: String(pairs[symbol].keepQuantity),
          minProfit: String(pairs[symbol].minProfit),
          sellOrder: order,
        })
        if (!completion?.ok) {
          await pause({
            symbol,
            reason: completion?.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_FAILED",
            error: completion?.errors?.[0]
          })
          return failureResult({
            errors: completion?.errors ?? [new Error("Recovery cycle completion evaluation failed")],
            category: "ACCOUNTING_INTEGRITY",
            stage: "RECOVERY_CYCLE_COMPLETION",
            retryable: false,
          })
        }
        if (!completion.data?.eligible) {
          publishRecoveryCycleNotCompleted({
            order,
            completion
          })
          if (["RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY"].includes(completion.data?.reason) &&
              completion.data?.pause === false) {
            // Keep the original cost/proceeds basis. The next serialized
            // evaluation will plan another SELL for any residual that still
            // satisfies current exchange filters; untradeable remainder is
            // reported as dust by the pure strategy until it can be combined.
            state.sellExecutionTotals.delete(order.brokerOrderId)
            return toResult({
              data: {
                order,
                reevaluate: true,
                residualSellThrough: true,
                realizedNetProfit: completion.data.realizedNetProfit,
              },
            })
          }
          await pause({
            symbol,
            reason: completion.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_FAILED"
          })
          return failureResult({
            error: new Error("Recovery cycle did not meet completion conditions"),
            category: "ACCOUNTING_INTEGRITY",
            stage: "RECOVERY_CYCLE_COMPLETION",
            retryable: false,
          })
        }
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
          dataResult: mapRecoveryCycleCompletedData({
            symbol,
            marketId: order.market.id,
            freeQuantity: completion.data.freeQuantity,
            keepQuantity: String(pairs[symbol].keepQuantity),
            minProfit: String(pairs[symbol].minProfit),
            realizedNetProfit: completion.data.realizedNetProfit,
            ...(completion.data.dust === undefined ? {} : { dust: completion.data.dust }),
          }),
        })
        state.sellExecutionTotals.delete(order.brokerOrderId)
        state.completedRecoverySellSymbols.delete(symbol)
        state.completedRecoverySellOrdersBySymbol.delete(symbol)
        state.trailingBuy.set(symbol, true)
      }
      if (recoveryMode) {
        state.deferredEvaluations.add(symbol)
      }
      return toResult({ data: {
        order,
        reevaluate: true
      } })
    } catch (error) {
      return failureResult({
        error,
        category: "ACCOUNTING_INTEGRITY",
        stage: "UNCLASSIFIED_ORDER_EVENT_TRANSITION",
        retryable: false,
      })
    }
  }

  return Object.freeze({
    processExecutionFillTransition,
    reconcileTerminalOrderFills,
    processUserDataEventTransition,
  })
}
