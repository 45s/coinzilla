import assert from "node:assert/strict"
import test from "node:test"
import { sanitizeDiagnosticValue } from "./sanitize-diagnostic-data.js"
import {
  createSanitizedHealthReport,
  evaluateOperatorOrderProbeHealthCheck,
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


test("sanitized health report retains only safe selected probe identity and outcome", () => {
  const published = createSanitizedHealthReport({
    report: {
      schemaVersion: 1,
      startedAt: "2026-11-21T00:00:00.000Z",
      finishedAt: "2026-11-21T00:00:01.000Z",
      runtime: {
        node: "v24.0.0",
        platform: "linux",
      },
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
      },
      healthCheck: {
        scope: "operator-order-probe",
        requiredOperations: ["operator order probe"],
        missingRequiredOperations: [],
        nonBlockingFailedOperations: [],
        healthy: true,
      },
      results: [{
        operation: "operator order probe",
        status: "passed",
        durationMs: 1,
        probeId: "limit-buy-1",
        mutationOutcome: "REJECTED",
        request: { apiKey: "must-not-publish" },
      }],
    },
  })

  assert.equal(published.results[0].probeId, "limit-buy-1")
  assert.equal(published.results[0].mutationOutcome, "REJECTED")
  assert.equal(JSON.stringify(published).includes("must-not-publish"), false)
})


test("operator probe health gate accepts deterministic rejection and confirmation, but blocks unknown outcomes", () => {
  for (const mutationOutcome of ["REJECTED", "CONFIRMED"]) {
    const result = evaluateOperatorOrderProbeHealthCheck({
      report: {
        results: [{
          operation: "operator order probe",
          status: "passed",
          mutationOutcome,
        }],
      },
    })
    assert.equal(result.healthy, true, mutationOutcome)
    assert.equal(result.scope, "operator-order-probe")
  }

  for (const mutationOutcome of ["OUTCOME_UNKNOWN", "NOT_SENT"]) {
    const result = evaluateOperatorOrderProbeHealthCheck({
      report: {
        results: [{
          operation: "operator order probe",
          status: "failed",
          mutationOutcome,
        }],
      },
    })
    assert.equal(result.healthy, false, mutationOutcome)
    assert.deepEqual(result.missingRequiredOperations, ["operator order probe"])
  }
})

test("operator probe health gate treats an explicit operator decline as a safe skip", () => {
  const result = evaluateOperatorOrderProbeHealthCheck({
    report: {
      results: [{
        operation: "operator order probe",
        status: "skipped",
        mutationOutcome: "NOT_SENT",
      }],
    },
  })

  assert.equal(result.healthy, true)
  assert.deepEqual(result.missingRequiredOperations, [])
})


test("published order-read evidence includes symbol and orderId but keeps other diagnostics private", () => {
  const orderId = "2124329325141426176"
  const symbol = "HYPEUSDT"
  const openOrdersResponse = sanitizeDiagnosticValue({
    value: {
      ok: true,
      data: [{ id: orderId, symbol, status: "OPEN" }],
      errors: [],
    },
  })
  const detailRequest = sanitizeDiagnosticValue({
    value: {
      method: "getOrder",
      arguments: [{ symbol, orderId }],
    },
  })
  const detailResponse = sanitizeDiagnosticValue({
    value: {
      ok: true,
      data: {
        id: orderId,
        symbol,
        status: "OPEN",
        price: "30",
        volume: "0.366",
        balance: "must-be-redacted",
        uid: "must-also-be-redacted",
      },
      errors: [],
    },
  })
  const published = createSanitizedHealthReport({
    report: {
      schemaVersion: 1,
      startedAt: "2026-11-22T00:00:00.000Z",
      finishedAt: "2026-11-22T00:00:01.000Z",
      runtime: { node: "v26.13.0", platform: "win32" },
      summary: { total: 3, passed: 3, failed: 0, skipped: 0 },
      healthCheck: {
        scope: "bitunix-order-read",
        requiredOperations: ["Broker API getOpenOrders", "Broker API getOrder for every discovered order"],
        missingRequiredOperations: [],
        nonBlockingFailedOperations: [],
        healthy: true,
      },
      results: [
        { operation: "Broker API getOpenOrders", status: "passed", durationMs: 41438, response: openOrdersResponse },
        { operation: "Broker API getOrder", status: "passed", durationMs: 304, request: detailRequest, response: detailResponse },
        {
          operation: "user.account",
          status: "passed",
          request: { apiKey: "must-not-publish" },
          response: { balance: "must-not-publish" },
        },
      ],
      events: [{ payload: "must-not-publish" }],
    },
  })

  const open = published.results.find((result) => result.operation === "Broker API getOpenOrders")
  const detail = published.results.find((result) => result.operation === "Broker API getOrder")
  assert.equal(open.response.data[0].id, orderId)
  assert.equal(open.response.data[0].symbol, symbol)
  assert.equal(detail.request.arguments[0].orderId, orderId)
  assert.equal(detail.request.arguments[0].symbol, symbol)
  assert.equal(detail.response.data.id, orderId)
  assert.equal(detail.response.data.symbol, symbol)
  assert.equal(detail.response.data.price, "30")
  assert.equal(detail.response.data.volume, "0.366")
  assert.equal(detail.response.data.balance, "[REDACTED]")
  assert.equal(detail.response.data.uid, "[REDACTED]")
  const publicJson = JSON.stringify(published)
  assert.equal(publicJson.includes("must-not-publish"), false)
  assert.equal(Object.hasOwn(published.results[2], "request"), false)
  assert.equal(Object.hasOwn(published.results[2], "response"), false)
  assert.equal(Object.hasOwn(published, "events"), false)
})
