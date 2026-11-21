import assert from "node:assert/strict"
import test from "node:test"
import { appendOrderAttemptResult } from "./operator-attempt-report.js"

function createReport({ failed = 0 } = {}) {
  return {
    summary: {
      total: 2,
      passed: 2 - failed,
      failed,
      skipped: 0,
    },
    results: [
      {
        operation: "REST ping",
        status: "passed",
        durationMs: 4,
      },
      {
        operation: "user.account",
        status: "passed",
        durationMs: 6,
      },
    ],
  }
}

test("confirmed order result adds only a safe passed status to the published report", () => {
  const report = appendOrderAttemptResult({
    report: createReport(),
    operatorResult: {
      ok: true,
      mutationOutcome: "CONFIRMED",
      data: { id: "private-order-id" },
    },
    durationMs: 120,
    secrets: ["private-api-key"],
  })

  assert.equal(report.summary.total, 3)
  assert.equal(report.summary.passed, 3)
  assert.equal(report.results[2].operation, "operator order attempt")
  assert.equal(report.results[2].status, "passed")
  assert.equal(JSON.stringify(report).includes("private-order-id"), false)
})

test("declined order adds a skipped result and does not claim a mutation", () => {
  const report = appendOrderAttemptResult({
    report: createReport(),
    operatorResult: {
      ok: false,
      mutationOutcome: "NOT_SENT",
      declined: true,
    },
    durationMs: 10,
  })

  assert.equal(report.summary.skipped, 1)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.results[2].status, "skipped")
  assert.equal(Object.hasOwn(report.results[2], "error"), false)
})

test("a failed health check skips the order and publishes only its safe skip code", () => {
  const report = appendOrderAttemptResult({
    report: createReport({ failed: 1 }),
    operatorResult: {
      ok: false,
      mutationOutcome: "NOT_SENT",
      skipped: true,
      skipCode: "HEALTHCHECK_NOT_HEALTHY",
    },
    durationMs: 0,
  })

  assert.equal(report.summary.failed, 1)
  assert.equal(report.summary.skipped, 1)
  assert.equal(report.results[2].status, "skipped")
  assert.equal(report.results[2].error.code, "HEALTHCHECK_NOT_HEALTHY")
})

test("rejected and unknown outcomes expose safe codes but withhold messages and order identifiers", () => {
  const rejectedError = new Error("private exchange message with account balance")
  rejectedError.code = "EXCHANGE_REJECTED"
  rejectedError.exchangeCode = "10001"
  rejectedError.status = 400
  const rejected = appendOrderAttemptResult({
    report: createReport(),
    operatorResult: {
      ok: false,
      mutationOutcome: "REJECTED",
      data: { id: "private-order-id" },
      errors: [rejectedError],
    },
    durationMs: 30,
  })
  assert.equal(rejected.summary.failed, 1)
  assert.equal(rejected.results[2].error.code, "EXCHANGE_REJECTED")
  assert.equal(rejected.results[2].error.exchangeCode, "10001")
  assert.equal(rejected.results[2].error.message, "[error message withheld]")
  assert.equal(JSON.stringify(rejected).includes("private-order-id"), false)
  assert.equal(JSON.stringify(rejected).includes("account balance"), false)

  const unknownError = new Error("private dispatch detail")
  const unknown = appendOrderAttemptResult({
    report: createReport(),
    operatorResult: {
      ok: false,
      mutationOutcome: "OUTCOME_UNKNOWN",
      errors: [unknownError],
    },
    durationMs: 50,
  })
  assert.equal(unknown.results[2].error.code, "OUTCOME_UNKNOWN")
  assert.equal(unknown.results[2].error.message, "[error message withheld]")
})
