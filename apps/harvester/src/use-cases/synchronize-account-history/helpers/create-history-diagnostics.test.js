import assert from "node:assert/strict"
import test from "node:test"
import { createHistoryDiagnostics } from "./create-history-diagnostics.js"

test("returns immutable partial-history diagnostics without claiming account-wide completeness", () => {
  const diagnostics = createHistoryDiagnostics({
    state: {
      marketsAttempted: ["BTCUSDT"],
      marketsQueried: [],
      currentMarket: "BTCUSDT",
      orderPagesChecked: 1,
      fillPagesChecked: 0,
      ordersObserved: 2,
      ordersPersisted: 1,
      fillsObserved: 0,
      fillsPersisted: 0,
      requestCount: 1,
    },
    historyPagesComplete: false,
    errorMessage: "simulated persistence failure",
  })

  assert.equal(diagnostics.complete, false, "Exchange retention and configured-market scope must never be reported as complete account history.")
  assert.equal(diagnostics.failureCount, 1, "A failed market scan must produce one actionable diagnostic failure.")
  assert.deepEqual(
    diagnostics.failures,
    [{
      market: "BTCUSDT",
      message: "simulated persistence failure",
    }],
    "The diagnostic failure must identify the market and preserve the original failure message.",
  )
  assert.equal(Object.isFrozen(diagnostics), true, "Callers must not be able to mutate returned synchronization diagnostics.")
  assert.equal(Object.isFrozen(diagnostics.marketsAttempted), true, "Market progress arrays must be immutable snapshots.")
})
