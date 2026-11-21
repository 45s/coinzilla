import assert from "node:assert/strict"
import test from "node:test"
import { createDiagnosticResult } from "./create-diagnostic-report.js"

test("diagnostic results retain operation timing and safe request/response summaries", () => {
  const result = createDiagnosticResult({
    operation: "market.last_price",
    status: "passed",
    durationMs: 42,
    request: {
      method: "market.last_price",
      params: {
        symbol: "BTCUSDT",
        sign: "secret-signature",
      },
    },
    response: { price: "123.45" },
    secrets: ["secret-signature"],
  })

  assert.equal(result.operation, "market.last_price", "Every diagnostic result must identify the exchange operation")
  assert.equal(result.status, "passed", "Successful operations must be recorded with an explicit passed status")
  assert.equal(result.durationMs, 42, "Operation latency must be recorded for connection troubleshooting")
  assert.equal(result.request.params.sign, "[REDACTED]", "Request signing material must never be included in diagnostic reports")
  assert.deepEqual(result.response, {
    type: "object",
    fields: ["price"],
  }, "Responses must be represented by safe shape summaries by default")
})
