import assert from "node:assert/strict"
import test from "node:test"
import { createHistoryDiagnostics } from "./create-history-diagnostics.js"

function createDiagnosticsFixture() {
  return createHistoryDiagnostics({
    state: {
      marketsAttempted: ["BTCUSDT", "ETHUSDT"],
      orderMarketsQueried: ["ETHUSDT"],
      fillMarketsQueried: ["ETHUSDT"],
      marketsQueried: ["ETHUSDT"],
      marketsFailed: ["BTCUSDT"],
      currentMarket: null,
      orderPagesChecked: 1,
      fillPagesChecked: 1,
      ordersObserved: 2,
      ordersPersisted: 1,
      fillsObserved: 0,
      fillsPersisted: 0,
      requestCount: 2,
      failures: [{
        market: "BTCUSDT",
        historyType: "orders",
        failureStage: "ORDER_RECORD_PERSIST",
        pageCursor: "0",
        recordIndex: 2,
        brokerOrderId: "11",
        clientOrderId: "second-order",
        lastPersistedOrderId: "10",
        errorName: "Error",
        errorCode: null,
        message: "Exchange response included https://api.example/?signature=private",
        stack: "private stack",
      }],
    },
    historyPagesComplete: false,
  })
}

test("returns immutable per-market progress and safe failure details without claiming account-wide completeness", () => {
  const diagnostics = createDiagnosticsFixture()
  assert.equal(diagnostics.complete, false, "Exchange retention and configured-market scope must never be reported as complete account history.")
  assert.equal(diagnostics.failureCount, 1, "A failed market scan must produce one actionable diagnostic failure.")
  assert.doesNotMatch(
    JSON.stringify(diagnostics.failures),
    /api\.example|signature=private|private stack/,
    "Untrusted failure messages and stacks must not enter immutable history diagnostics.",
  )
  assert.deepEqual(diagnostics.marketsAttempted, ["BTCUSDT", "ETHUSDT"], "Diagnostics must retain every configured market in attempt order.")
  assert.deepEqual(diagnostics.orderMarketsQueried, ["ETHUSDT"], "Diagnostics must identify the market whose order scan completed.")
  assert.deepEqual(diagnostics.fillMarketsQueried, ["ETHUSDT"], "Diagnostics must identify the market whose fill scan completed.")
  assert.deepEqual(diagnostics.marketsFailed, ["BTCUSDT"], "Diagnostics must identify the market whose scan failed.")
  assert.deepEqual(
    diagnostics.failures,
    [{
      market: "BTCUSDT",
      historyType: "orders",
      failureStage: "ORDER_RECORD_PERSIST",
      pageCursor: "0",
      recordIndex: 2,
      brokerOrderId: "11",
      clientOrderId: "second-order",
      lastPersistedOrderId: "10",
      errorName: "Error",
    }],
    "The diagnostic failure must retain safe, actionable page and record context.",
  )
  assert.equal(Object.isFrozen(diagnostics), true, "Callers must not be able to mutate returned synchronization diagnostics.")
  assert.equal(Object.isFrozen(diagnostics.marketsAttempted), true, "Market progress arrays must be immutable snapshots.")
  assert.equal(Object.isFrozen(diagnostics.failures[0]), true, "Failure records must be immutable snapshots.")
})
