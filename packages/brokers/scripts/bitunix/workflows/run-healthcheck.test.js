import assert from "node:assert/strict"
import test from "node:test"
import { evaluateReadOnlyHealthCheck } from "../helpers/health-report.js"
import { runHealthcheckWorkflow } from "./run-healthcheck.js"

const requiredOperations = [
  "diagnostic safety confirmation",
  "diagnostic configuration",
  "REST private account balances",
  "WebSocket connection",
  "ping",
  "user.account",
  "user.info",
]

function createDiagnosticReport({ failed = 0 } = {}) {
  const results = requiredOperations.map((operation) => ({
    operation,
    status: "passed",
    durationMs: 1,
  }))
  if (failed > 0) {
    results[0].status = "failed"
  }
  return {
    schemaVersion: 1,
    startedAt: "2026-11-21T00:00:00.000Z",
    finishedAt: "2026-11-21T00:00:01.000Z",
    runtime: {
      node: "v24.0.0",
      platform: "linux",
    },
    summary: {
      total: results.length,
      passed: results.length - failed,
      failed,
      skipped: 0,
    },
    results,
    events: [],
    schemaObservations: [],
  }
}

function createPublisher({ events, publishedReports }) {
  return async ({ runDiagnostics, env }) => {
    events.push("report branch workflow")
    const report = await runDiagnostics({
      env,
      onProgress: () => {},
    })
    publishedReports.push(report)
    const healthCheck = evaluateReadOnlyHealthCheck({ report })
    return {
      report,
      healthCheck,
      branch: "diagnostics/bitunix-health-test",
      commitSha: "safe-test-commit",
      reportPath: "packages/brokers/diagnostics/reports/test.json",
      localReportPath: "packages/brokers/.diagnostics/test.json",
      pushError: null,
      exitCode: !healthCheck.healthy ||
        report.results.some((entry) =>
          entry.operation === "operator order attempt" && entry.status === "failed")
        ? 1
        : 0,
    }
  }
}

const stdout = { write() {} }
const env = {
  BITUNIX_API_KEY: "test-api-key",
  BITUNIX_API_SECRET: "test-api-secret",
}

test("place-order mode runs diagnostics first and executes the order inside report-branch workflow", async () => {
  const events = []
  const publishedReports = []
  let orderCalls = 0
  const exitCode = await runHealthcheckWorkflow({
    mode: "place-order",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => {
      events.push("read-only diagnostics")
      return createDiagnosticReport()
    },
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
    runOperatorOrder: async () => {
      events.push("operator order")
      orderCalls += 1
      return {
        ok: true,
        mutationOutcome: "CONFIRMED",
        data: { id: "private-order-id" },
      }
    },
  })

  assert.deepEqual(events, ["report branch workflow", "read-only diagnostics", "operator order"])
  assert.equal(orderCalls, 1, "the order runner must be called exactly once")
  assert.equal(exitCode, 0)
  assert.equal(publishedReports[0].results.at(-1).operation, "operator order attempt")
  assert.equal(publishedReports[0].results.at(-1).status, "passed")
  assert.equal(JSON.stringify(publishedReports[0]).includes("private-order-id"), false)
})

test("place-order mode skips the order when read-only health checks are not healthy", async () => {
  const events = []
  const publishedReports = []
  let orderCalls = 0
  const exitCode = await runHealthcheckWorkflow({
    mode: "place-order",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => createDiagnosticReport({ failed: 1 }),
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
    runOperatorOrder: async () => {
      orderCalls += 1
      return {
        ok: true,
        mutationOutcome: "CONFIRMED",
      }
    },
  })

  assert.equal(orderCalls, 0, "an unhealthy read-only check must prevent order dispatch")
  assert.equal(exitCode, 1)
  assert.equal(publishedReports[0].results.at(-1).status, "skipped")
  assert.equal(publishedReports[0].results.at(-1).error.code, "HEALTHCHECK_NOT_HEALTHY")
})

test("operator exceptions are recorded as OUTCOME_UNKNOWN without publishing free-form error text", async () => {
  const events = []
  const publishedReports = []
  const exitCode = await runHealthcheckWorkflow({
    mode: "place-order",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => createDiagnosticReport(),
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
    runOperatorOrder: async () => {
      throw new Error("private exchange response")
    },
  })

  const operatorResult = publishedReports[0].results.at(-1)
  assert.equal(exitCode, 1)
  assert.equal(operatorResult.status, "failed")
  assert.equal(operatorResult.error.code, "OUTCOME_UNKNOWN")
  assert.equal(operatorResult.error.message, "[error message withheld]")
  assert.equal(JSON.stringify(publishedReports[0]).includes("private exchange response"), false)
})

test("ordinary publish mode does not invoke an operator order callback", async () => {
  const events = []
  const publishedReports = []
  const exitCode = await runHealthcheckWorkflow({
    mode: "publish",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => createDiagnosticReport(),
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
  })

  assert.equal(exitCode, 0)
  assert.equal(publishedReports[0].results.some((entry) => entry.operation === "operator order attempt"), false)
})
