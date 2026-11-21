/** Build an immutable snapshot of exchange-history synchronization progress. */

const FAILURE_STRING_FIELDS = Object.freeze([
  ["market", 100],
  ["historyType", 100],
  ["failureStage", 100],
  ["pageCursor", 200],
  ["brokerOrderId", 200],
  ["clientOrderId", 200],
  ["tradeId", 200],
  ["lastPersistedOrderId", 200],
  ["lastPersistedTradeId", 200],
  ["errorName", 200],
  ["errorCode", 200],
])

function createSafeHistoryFailure(failure = {}) {
  const safe = {}
  for (const [field, maximumLength] of FAILURE_STRING_FIELDS) {
    if (typeof failure[field] === "string") {
      safe[field] = failure[field].slice(0, maximumLength)
    }
  }
  if (Number.isSafeInteger(failure.recordIndex) && failure.recordIndex > 0) {
    safe.recordIndex = failure.recordIndex
  }
  return Object.freeze(safe)
}

export function createHistoryDiagnostics({ state, historyPagesComplete } = {}) {
  const failures = Object.freeze(state.failures.map(createSafeHistoryFailure))
  const pagesComplete = historyPagesComplete === true && failures.length === 0
  return Object.freeze({
    historyScope: "CONFIGURED_MARKETS",
    marketsAttempted: Object.freeze([...state.marketsAttempted]),
    orderMarketsQueried: Object.freeze([...state.orderMarketsQueried]),
    fillMarketsQueried: Object.freeze([...state.fillMarketsQueried]),
    marketsQueried: Object.freeze([...state.marketsQueried]),
    marketsFailed: Object.freeze([...state.marketsFailed]),
    currentMarket: state.currentMarket,
    orderPagesChecked: state.orderPagesChecked,
    fillPagesChecked: state.fillPagesChecked,
    ordersObserved: state.ordersObserved,
    ordersPersisted: state.ordersPersisted,
    fillsObserved: state.fillsObserved,
    fillsPersisted: state.fillsPersisted,
    requestCount: state.requestCount,
    failureCount: failures.length,
    failures,
    historyPagesComplete: pagesComplete,
    marketHistoryPagesComplete: pagesComplete,
    marketUniverseComplete: false,
    retentionCoverageConfirmed: false,
    complete: false,
  })
}
