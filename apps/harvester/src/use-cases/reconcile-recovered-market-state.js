import { Market } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { auditRecoveredAccountState } from "./audit-recovered-account-state.js"

function unwrapResult({ result, field }) {
  if (result?.ok === false) {
    throw result.errors?.[0] ?? new Error(field + " failed without an error detail")
  }
  return result?.ok === true ? result.data : result
}

/**
 * Reconcile one recovered market against read-only exchange evidence.
 *
 * The caller supplies the engine's serialized, read-only owned-order
 * reconciliation boundary and state accessors. This use case deliberately has
 * no order-placement or cancellation dependency. Owned-order reconciliation
 * must query canonical order history/open orders/fills and update only the
 * candidate in-memory recovery state (plus the existing local Journal barrier
 * used by the engine).
 *
 * @param {object} options
 * @param {object} options.projection - Successful Journal recovery projection.
 * @param {Function} options.reconcileOwnedOrders - Serialized read-only engine reconciliation boundary.
 * @param {Function} options.getRecoveredState - Returns the candidate state after owned-order reconciliation.
 * @param {Function} options.refreshAccountSnapshot - Returns a canonical AccountSnapshot or result.
 * @param {Function} options.getOpenOrders - Returns the account-wide canonical open-order set or result.
 * @param {Function} options.fetchMarketTradeHistory - Fetches complete history for the target market from startTime.
 * @param {Array<Market>} options.markets - Canonical metadata for every known market in the account.
 * @param {Market} options.targetMarket - The single market being certified.
 * @param {object} options.historyRetentionEvidence - Candidate operator-reviewed coverage fact.
 * @param {Function} [options.auditAccountState] - Test seam; defaults to the production account audit.
 * @returns {Promise<object>} Read-only reconciliation result; ready is true only for a fully audited target market.
 */
export async function reconcileRecoveredMarketState({
  projection,
  reconcileOwnedOrders,
  getRecoveredState,
  refreshAccountSnapshot,
  getOpenOrders,
  fetchMarketTradeHistory,
  markets,
  targetMarket,
  historyRetentionEvidence,
  auditAccountState = auditRecoveredAccountState,
} = {}) {
  try {
    if (projection?.ok !== true || !projection.data) {
      throw new TypeError("reconcileRecoveredMarketState requires a successful Journal recovery projection")
    }
    if (typeof reconcileOwnedOrders !== "function" ||
        typeof getRecoveredState !== "function" ||
        typeof refreshAccountSnapshot !== "function" ||
        typeof getOpenOrders !== "function" ||
        typeof fetchMarketTradeHistory !== "function") {
      throw new TypeError("reconcileRecoveredMarketState requires all read-only reconciliation dependencies")
    }
    if (!(targetMarket instanceof Market)) {
      throw new TypeError("reconcileRecoveredMarketState requires a canonical target Market")
    }
    if (!Array.isArray(markets) || !markets.includes(targetMarket)) {
      throw new TypeError("reconcileRecoveredMarketState markets must include the exact target Market")
    }
    if (typeof auditAccountState !== "function") {
      throw new TypeError("reconcileRecoveredMarketState auditAccountState must be a function")
    }
    if (
      historyRetentionEvidence?.factType !== "MARKET_HISTORY_COVERAGE_CONFIRMED" ||
      historyRetentionEvidence.symbol !== targetMarket.symbol ||
      !Number.isSafeInteger(historyRetentionEvidence.coveredFromTime) ||
      historyRetentionEvidence.coveredFromTime < 0
    ) {
      throw new TypeError("History-retention evidence must identify the target market and a valid coverage start")
    }

    const orderReconciliation = await reconcileOwnedOrders({ recoveryMode: true })
    if (orderReconciliation?.ok !== true) {
      return toResult({
        errors: orderReconciliation?.errors ?? [new Error("Canonical owned-order reconciliation failed")],
      })
    }

    const recoveredState = unwrapResult({
      result: await getRecoveredState(),
      field: "Recovered state read",
    })
    const [currentAccountSnapshotResult, openOrdersResult, historyResult] = await Promise.all([
      refreshAccountSnapshot(),
      getOpenOrders(),
      fetchMarketTradeHistory({
        market: targetMarket,
        startTime: historyRetentionEvidence.coveredFromTime,
      }),
    ])
    const currentAccountSnapshot = unwrapResult({
      result: currentAccountSnapshotResult,
      field: "Fresh account snapshot",
    })
    const openOrders = unwrapResult({ result: openOrdersResult, field: "Account-wide open orders" })
    const history = unwrapResult({ result: historyResult, field: "Target-market trade history" })
    if (!Array.isArray(openOrders)) {
      throw new TypeError("Account-wide open-order read must return an array")
    }
    if (!history || typeof history !== "object" || Array.isArray(history)) {
      throw new TypeError("Target-market trade-history read must return an evidence object")
    }

    const auditResult = await auditAccountState({
      projection,
      recoveredState,
      currentAccountSnapshot,
      openOrders,
      markets,
      exchangeTradeHistory: {
        ...history,
        historyRetentionEvidence,
      },
      requireCompleteTradeHistory: true,
      tradeHistoryScope: "MARKET",
      targetMarket,
    })
    if (auditResult?.ok !== true) {
      return toResult({
        errors: auditResult?.errors ?? [new Error("Recovered account-state audit failed")],
      })
    }

    const audit = auditResult.data
    const skipped = audit?.skipped === true
    const targetMarketBlocked = audit?.targetMarketBlocked === true
    const tradeHistoryComplete = audit?.tradeHistory?.complete === true
    const ready = !skipped && !targetMarketBlocked && tradeHistoryComplete
    const status = skipped ? "SKIPPED" : ready ? "READY" : "BLOCKED"
    const reason = skipped
      ? audit.reason ?? "NO_PRIOR_TRADING_STATE"
      : targetMarketBlocked
        ? "TARGET_MARKET_BLOCKED"
        : tradeHistoryComplete
          ? undefined
          : "TRADE_HISTORY_NOT_COMPLETE"

    return toResult({
      data: Object.freeze({
        symbol: targetMarket.symbol,
        ready,
        status,
        ...(reason ? { reason } : {}),
        orderReconciliation: orderReconciliation.data,
        audit,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
