import assert from "node:assert/strict"
import test from "node:test"
import { BrokerDiagnosticError } from "./diagnostic-error.js"
import { sanitizeDiagnosticError } from "../helpers/diagnostics.js"

test("Broker diagnostic errors preserve stable codes, safe context, and cause identity", () => {
  const cause = new TypeError("private diagnostic failure")
  const error = new BrokerDiagnosticError({
    code: "BROKER_DIAGNOSTIC_SCHEMA_MISMATCH",
    message: "Bitunix response schema mismatch",
    context: {
      path: "/api/spot/v1/market/last_price",
      issues: "unexpected_value_type",
    },
    cause,
  })

  assert.equal(error.name, "BrokerDiagnosticError", "diagnostic errors must retain their concrete type name")
  assert.equal(error.code, "BROKER_DIAGNOSTIC_SCHEMA_MISMATCH", "diagnostic errors must expose a stable machine-readable code")
  assert.strictEqual(error.cause, cause, "diagnostic errors must preserve the original cause identity")
  assert.deepEqual(error.context, {
    path: "/api/spot/v1/market/last_price",
    issues: "unexpected_value_type",
  }, "diagnostic errors must retain only safe scalar context")
  assert.equal(Object.isFrozen(error.context), true, "diagnostic error context must be immutable")

  const sanitized = sanitizeDiagnosticError({
    error,
    secrets: ["private diagnostic failure"],
  })
  assert.equal(sanitized.code, error.code, "sanitized diagnostic output must retain the stable code")
  assert.deepEqual(sanitized.context, error.context, "sanitized diagnostic output must retain safe context")
  assert.equal(JSON.stringify(sanitized).includes("private diagnostic failure"), false, "sanitized diagnostic output must withhold free-form error text")
})
