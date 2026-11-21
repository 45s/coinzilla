import assert from "node:assert/strict"
import test from "node:test"
import { mapRuntimeErrorEntryToRow } from "./runtime-error-row-mapping.js"

test("maps explicit runtime error facts and redacts credentials from searchable text", () => {
  const row = mapRuntimeErrorEntryToRow({
    runtimeSessionId: "session-123",
    entry: {
      timestamp: "2026-11-21T08:44:20.000Z",
      level: "error",
      method: "error",
      data: {
        message: "History sync failed token=private-token",
        errorName: "HistorySyncError",
        errorCode: "HISTORY_SYNC_CURSOR_WRITE_FAILED",
        errorMessage: "Cursor write failed apiKey=private-key",
        component: "synchronize-account-history",
        operation: "saveOrderCursor",
        providerType: "binance",
        providerInstanceId: "binanceTestnet",
        accountId: "binance-primary",
        environment: "testnet",
        symbol: "ZROFDUSD",
        brokerOrderId: "981545",
        clientOrderId: "h-order-1",
        executionId: "15507",
        failureCategory: "PERSISTENCE",
        failureStage: "ORDER_CURSOR_SAVE",
        historyDiagnostics: {
          currentMarket: "ZROFDUSD",
          ordersPersisted: 999,
          complete: false,
          errorMessage: "secret=must-not-be-copied",
        },
        strategyId: undefined,
        errorDetails: {
          stack: "Error: private-key",
        },
        apiKey: "private-key",
      },
    },
  })

  assert.equal(row.runtime_session_id, "session-123", "Runtime errors must retain the existing process session identity.")
  assert.equal(row.occurred_at, "2026-11-21T08:44:20.000Z", "The logger timestamp must be preserved exactly.")
  assert.equal(row.error_code, "HISTORY_SYNC_CURSOR_WRITE_FAILED", "Stable error codes must remain searchable.")
  assert.equal(row.message, "Cursor write failed apiKey=[REDACTED]", "Credential assignments must be redacted from searchable messages.")
  assert.equal(row.symbol, "ZROFDUSD", "Explicit market identity must be retained.")
  assert.equal(row.strategy_id, null, "Missing strategy attribution must remain SQL NULL.")
  assert.equal(row.execution_id, "15507", "Explicit execution identity must be retained.")
  assert.doesNotMatch(row.details_json, /private-key|must-not-be-copied|stack|apiKey/, "Unrestricted details and sensitive fields must not enter relational diagnostics.")
  assert.match(row.details_json, /ZROFDUSD/, "Allowlisted history diagnostics must remain searchable.")
})

test("does not invent context when a logger error contains only a message", () => {
  const row = mapRuntimeErrorEntryToRow({
    runtimeSessionId: "session-minimal",
    entry: {
      timestamp: "2026-11-21T08:45:00.000Z",
      level: "error",
      data: {
        message: "A runtime failure occurred",
      },
    },
  })

  assert.equal(row.error_name, null, "Missing error names must remain absent.")
  assert.equal(row.error_code, null, "Missing error codes must remain absent.")
  assert.equal(row.symbol, null, "Missing market identity must remain absent.")
  assert.equal(row.strategy_id, null, "Missing strategy identity must remain absent.")
  assert.equal(row.details_json, null, "No structured details must produce SQL NULL rather than fabricated JSON.")
})
