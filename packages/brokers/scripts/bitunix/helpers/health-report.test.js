import assert from "node:assert/strict"
import test from "node:test"
import {
  createSanitizedHealthReport,
  evaluateReadOnlyHealthCheck,
  withholdFreeFormErrorMessages,
} from "./health-report.js"

const requiredOperations = [
  "diagnostic safety confirmation",
  "diagnostic configuration",
]

test("health evaluation fails when a required read-only operation is missing", () => {
  const report = {
    summary: {
      failed: 0,
    },
    results: requiredOperations
      .filter((operation) => operation !== "diagnostic configuration")
      .map((operation) => ({
        operation,
        status: "passed",
      })),
  }
  const result = evaluateReadOnlyHealthCheck({ report })
  assert.deepEqual(result.missingRequiredOperations, ["diagnostic configuration"], "the gate must name the exact missing safety/configuration prerequisite")
  assert.equal(result.healthy, false)
})

test("health evaluation fails when a required order-gate operation fails", () => {
  const results = requiredOperations.map((operation) => ({
    operation,
    status: "passed",
  }))
  results[0].status = "failed"
  const report = {
    summary: {
      failed: 1,
    },
    results,
  }
  assert.equal(evaluateReadOnlyHealthCheck({ report }).healthy, false, "the operator gate must fail when its explicit safety confirmation fails")
})

test("optional order-history failures do not block the guarded order preflight", () => {
  const results = [
    ...requiredOperations.map((operation) => ({
      operation,
      status: "passed",
    })),
    {
      operation: "Broker API getOrderHistory",
      status: "failed",
    },
    {
      operation: "Broker API schema getOrderHistory",
      status: "failed",
    },
  ]
  const report = {
    summary: {
      failed: 2,
    },
    results,
  }

  const result = evaluateReadOnlyHealthCheck({ report })
  assert.equal(result.healthy, true, "the order-history read is not used by the fixed order preflight and must not block it")
  assert.deepEqual(result.nonBlockingFailedOperations, [
    "Broker API getOrderHistory",
    "Broker API schema getOrderHistory",
  ], "optional failures must remain visible in the report even though they do not block the guarded order preflight")
})

test("public health reports copy only allowlisted fields and omit private account payloads", () => {
  const report = {
    schemaVersion: 1,
    startedAt: "2026-11-21T00:00:00.000Z",
    finishedAt: "2026-11-21T00:01:00.000Z",
    runtime: {
      node: "v24.0.0",
      platform: "linux",
      privateRuntimeField: "private-runtime",
    },
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      privateCount: "private-count",
    },
    healthCheck: {
      scope: "operator-order-preflight",
      requiredOperations,
      missingRequiredOperations: ["diagnostic configuration"],
      nonBlockingFailedOperations: ["Broker API getOrderHistory"],
      healthy: false,
      privateField: "private-health",
    },
    results: [{
      operation: "user.account",
      status: "failed",
      durationMs: 12,
      request: { apiKey: "private-key" },
      response: {
        uid: "private-uid",
        balance: "987.65",
      },
      error: {
        name: "BitunixError",
        message: "private balance 987.65",
        code: "BITUNIX_ACCOUNT_READ_FAILED",
        kind: "exchange",
        status: 400,
        exchangeCode: "10001",
        cause: {
          message: "private nested message",
        },
      },
    }],
    events: [{ payload: "private-event" }],
  }
  const published = createSanitizedHealthReport({ report })
  assert.equal(published.results[0].error.code, "BITUNIX_ACCOUNT_READ_FAILED")
  assert.equal(published.healthCheck.scope, "operator-order-preflight", "the public report must identify that this verdict gates only the guarded operator preflight")
  assert.deepEqual(published.healthCheck.nonBlockingFailedOperations, ["Broker API getOrderHistory"], "the public report must preserve names of non-blocking failures without exposing their response data")
  assert.equal(Object.hasOwn(published.results[0], "request"), false)
  assert.equal(Object.hasOwn(published.results[0], "response"), false)
  assert.equal(Object.hasOwn(published, "events"), false)
  for (const privateValue of ["private-uid", "987.65", "private-key", "private-runtime", "private-health"]) {
    assert.equal(JSON.stringify(published).includes(privateValue), false)
  }
})

test("nested free-form error messages are withheld before local report persistence", () => {
  const result = withholdFreeFormErrorMessages({
    value: {
      error: {
        name: "BitunixError",
        message: "private exchange response",
        cause: {
          name: "Error",
          message: "private nested response",
        },
      },
    },
  })
  assert.equal(result.error.message, "[error message withheld]")
  assert.equal(result.error.cause.message, "[error message withheld]")
})

test("operator order failure does not rewrite the read-only diagnostic health verdict", () => {
  const report = {
    summary: {
      failed: 1,
    },
    results: [
      ...requiredOperations.map((operation) => ({
        operation,
        status: "passed",
      })),
      {
        operation: "operator order attempt",
        status: "failed",
      },
    ],
  }

  assert.equal(evaluateReadOnlyHealthCheck({ report }).healthy, true, "the health verdict must describe read-only diagnostics, not the separate operator mutation outcome")
})
