/** Build an immutable snapshot of exchange-history synchronization progress. */

export function createHistoryDiagnostics({ state, historyPagesComplete, errorMessage } = {}) {
  const failures = errorMessage === undefined
    ? []
    : [Object.freeze({
        market: state.currentMarket,
        message: errorMessage,
      })]
  return Object.freeze({
    historyScope: "CONFIGURED_MARKETS",
    marketsAttempted: Object.freeze([...state.marketsAttempted]),
    marketsQueried: Object.freeze([...state.marketsQueried]),
    currentMarket: state.currentMarket,
    orderPagesChecked: state.orderPagesChecked,
    fillPagesChecked: state.fillPagesChecked,
    ordersObserved: state.ordersObserved,
    ordersPersisted: state.ordersPersisted,
    fillsObserved: state.fillsObserved,
    fillsPersisted: state.fillsPersisted,
    requestCount: state.requestCount,
    failureCount: failures.length,
    failures: Object.freeze(failures),
    historyPagesComplete,
    marketHistoryPagesComplete: historyPagesComplete,
    marketUniverseComplete: false,
    retentionCoverageConfirmed: false,
    complete: false,
    errorMessage,
  })
}
