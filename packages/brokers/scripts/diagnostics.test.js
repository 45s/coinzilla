import assert from "node:assert/strict"
import test from "node:test"
import {
  createDiagnosticResult,
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue,
  summarizePrivatePayload,
} from "./diagnostics.js"

test("diagnostic sanitization redacts credentials and sensitive fields recursively", () => {
  const sanitized = sanitizeDiagnosticValue({
    value: {
      method: "market.last_price",
      params: {
        apiKey: "test-api-key",
        sign: "test-signature",
        nonce: "test-nonce",
        symbol: "BTCUSDT",
      },
      nested: {
        token: "private-token",
        balance: "12.3400",
        uid: 12345,
      },
      message: "request failed with test-api-secret",
    },
    secrets: ["test-api-secret"],
  })

  assert.equal(sanitized.params.apiKey, "[REDACTED]", "API keys must never appear in persisted diagnostic requests")
  assert.equal(sanitized.params.sign, "[REDACTED]", "Bitunix signatures must never appear in diagnostic output")
  assert.equal(sanitized.params.nonce, "[REDACTED]", "Authentication nonces must never appear in diagnostic output")
  assert.equal(sanitized.params.symbol, "BTCUSDT", "Non-sensitive request parameters must remain useful for debugging")
  assert.equal(sanitized.nested.token, "[REDACTED]", "Token-like response fields must be redacted at every nesting level")
  assert.equal(sanitized.nested.balance, "[REDACTED]", "Account balance values must not be persisted")
  assert.equal(sanitized.nested.uid, "[REDACTED]", "Account identifiers must not be persisted")
  assert.equal(sanitized.message, "request failed with [REDACTED]", "Known credential values must be removed from free-form messages")
})

test("private response summaries preserve shape without exposing account values", () => {
  const summary = summarizePrivatePayload([
    {
      coin: "BTC",
      balance: "0.123456",
      balanceLocked: "0.01",
    },
    {
      coin: "USDT",
      balance: "900.00",
      balanceLocked: "0",
    },
  ])

  assert.deepEqual(summary, {
    type: "array",
    itemCount: 2,
    fields: ["balance", "balanceLocked", "coin"],
  }, "Private account responses must report structure and counts without persisting balances or asset values")
})

test("diagnostic errors preserve stable classification while redacting messages", () => {
  const error = Object.assign(new Error("Bitunix rejected test-api-secret"), {
    code: "BITUNIX_WEBSOCKET_EXCHANGE_REJECTED",
    kind: "exchange",
    exchangeCode: "10001",
    method: "user.account",
  })
  const sanitized = sanitizeDiagnosticError({
    error,
    secrets: ["test-api-secret"],
  })

  assert.equal(sanitized.name, "Error", "Diagnostic errors must retain the concrete error name")
  assert.equal(sanitized.code, "BITUNIX_WEBSOCKET_EXCHANGE_REJECTED", "Stable local error codes must remain searchable")
  assert.equal(sanitized.kind, "exchange", "The transport or exchange failure classification must remain visible")
  assert.equal(sanitized.exchangeCode, "10001", "The opaque Bitunix response code must remain available for investigation")
  assert.equal(sanitized.message, "[error message withheld]", "Free-form errors must never be persisted, even after credential redaction")
})

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
