import assert from "node:assert/strict"
import test from "node:test"
import { evaluateOrderReadHealthCheck, evaluateReadOnlyHealthCheck } from "../helpers/health-report.js"
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

function createDiagnosticReport({ failed = 0, failedOperation = requiredOperations[0] } = {}) {
  const results = requiredOperations.map((operation) => ({
    operation,
    status: "passed",
    durationMs: 1,
  }))
  if (failed > 0) {
    const requiredResult = results.find((result) => result.operation === failedOperation)
    if (requiredResult) {
      requiredResult.status = "failed"
    } else {
      results.push({
        operation: failedOperation,
        status: "failed",
        durationMs: 1,
      })
    }
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
  return async ({ runDiagnostics, healthCheckEvaluator = evaluateReadOnlyHealthCheck, env }) => {
    events.push("report branch workflow")
    const report = await runDiagnostics({
      env,
      onProgress: () => {},
    })
    const healthCheck = healthCheckEvaluator({ report })
    report.healthCheck = healthCheck
    publishedReports.push(report)
    return {
      report,
      healthCheck,
      branch: "diagnostics/bitunix-health-test",
      commitSha: "safe-test-commit",
      reportPath: "packages/brokers/diagnostics/reports/test.json",
      localReportPath: "packages/brokers/.diagnostics/test.json",
      pushError: null,
      exitCode: !healthCheck.healthy || report.summary.failed > 0 ||
        report.results.some((entry) =>
          (entry.operation === "operator order attempt" || entry.operation === "operator order probe") && entry.status === "failed")
        ? 1
        : 0,
    }
  }
}

function createEmptyOrderScanBroker() {
  return () => ({
    connect: async () => {},
    getOpenOrders: async () => ({
      ok: true,
      data: [],
      errors: [],
    }),
    disconnect: async () => {},
  })
}

async function runWorkflow(options) {
  return runHealthcheckWorkflow({
    brokerFactory: createEmptyOrderScanBroker(),
    ...options,
  })
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
  const exitCode = await runWorkflow({
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

test("place-order mode proceeds to guarded preflight when only optional order history fails", async () => {
  const events = []
  const publishedReports = []
  let orderCalls = 0
  const exitCode = await runWorkflow({
    mode: "place-order",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => createDiagnosticReport({
      failed: 1,
      failedOperation: "Broker API getOrderHistory",
    }),
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
    runOperatorOrder: async () => {
      orderCalls += 1
      events.push("operator order")
      return {
        ok: true,
        mutationOutcome: "TEST_ONLY",
      }
    },
  })

  assert.equal(orderCalls, 1, "the guarded order runner must be reached despite an unrelated history diagnostic failure")
  assert.equal(publishedReports[0].healthCheck.healthy, true, "the explicit safety/configuration gate must remain ready")
  assert.deepEqual(publishedReports[0].healthCheck.nonBlockingFailedOperations, [
    "Broker API getOrderHistory",
  ], "the optional history failure must remain visible")
  assert.equal(publishedReports[0].results.at(-1).operation, "operator order attempt")
  assert.equal(exitCode, 1, "the command must still return a failing diagnostic status even after the order attempt is recorded")
})

test("place-order mode skips the order when read-only health checks are not healthy", async () => {
  const events = []
  const publishedReports = []
  let orderCalls = 0
  const exitCode = await runWorkflow({
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
  const exitCode = await runWorkflow({
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
  const exitCode = await runWorkflow({
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


test("pre-dispatch operator failures are recorded as NOT_SENT, not OUTCOME_UNKNOWN", async () => {
  const events = []
  const publishedReports = []
  const preflightError = Object.assign(new Error("private balance preflight failure"), {
    mutationOutcome: "NOT_SENT",
  })
  const exitCode = await runWorkflow({
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
      throw preflightError
    },
  })

  const operatorResult = publishedReports[0].results.at(-1)
  assert.equal(exitCode, 1)
  assert.equal(operatorResult.status, "failed")
  assert.equal(operatorResult.error.code, "NOT_SENT")
  assert.equal(operatorResult.error.message, "[error message withheld]")
  assert.equal(JSON.stringify(publishedReports[0]).includes("private balance preflight failure"), false)
})


test("probe-order mode skips generic diagnostics and runs one selected probe", async () => {
  const events = []
  const publishedReports = []
  let probeCalls = 0
  const exitCode = await runWorkflow({
    mode: "probe-order",
    probeId: "limit-buy-1",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => {
      events.push("unexpected generic diagnostics")
      throw new Error("generic diagnostics must be skipped for a focused probe")
    },
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
    runOperatorProbe: async ({ probeId }) => {
      events.push(`operator probe:${probeId}`)
      probeCalls += 1
      return {
        ok: false,
        mutationOutcome: "REJECTED",
        errors: [Object.assign(new Error("exchange rejected"), {
          code: "BITUNIX_REST_EXCHANGE_REJECTED",
          exchangeCode: "10005",
          status: 200,
          kind: "exchange",
        })],
      }
    },
  })

  assert.equal(probeCalls, 1)
  assert.deepEqual(events, [
    "report branch workflow",
    "operator probe:limit-buy-1",
  ])
  assert.equal(publishedReports[0].results.at(-1).operation, "operator order probe")
  assert.equal(publishedReports[0].results.at(-1).mutationOutcome, "REJECTED")
  assert.equal(publishedReports[0].results.at(-1).status, "passed")
  assert.equal(publishedReports[0].results.at(-1).error.exchangeCode, "10005")
  assert.equal(exitCode, 0)
})

test("probe-order mode requires a probe id and an operator callback", async () => {
  await assert.rejects(
    runWorkflow({
      mode: "probe-order",
      brokersRoot: "/repo/packages/brokers",
      repositoryRoot: "/repo",
      env,
      stdout,
    }),
    /probe id and operator probe runner/i,
  )
})


test("probe-order mode uses only its dedicated preflight, even if generic diagnostics would fail", async () => {
  const events = []
  const publishedReports = []
  const exitCode = await runWorkflow({
    mode: "probe-order",
    probeId: "market-buy-1",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => {
      throw new Error("generic diagnostics should not run in focused probe mode")
    },
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
    runOperatorProbe: async ({ probeId }) => {
      events.push(`operator probe:${probeId}`)
      return {
        ok: false,
        mutationOutcome: "REJECTED",
        errors: [Object.assign(new Error("exchange rejected"), {
          code: "BITUNIX_REST_EXCHANGE_REJECTED",
          exchangeCode: "10005",
          status: 200,
          kind: "exchange",
        })],
      }
    },
  })

  assert.equal(events.includes("operator probe:market-buy-1"), true)
  assert.equal(events.includes("unexpected generic diagnostics"), false)
  assert.equal(publishedReports[0].results.length, 1)
  assert.equal(publishedReports[0].results[0].operation, "operator order probe")
  assert.equal(publishedReports[0].results[0].error.exchangeCode, "10005")
  assert.equal(exitCode, 0)
})



function createOrderScanBroker({ calls, order }) {
  return ({ logger, providerOptions }) => {
    assert.equal(providerOptions.allowLiveOrderMutations, false)
    return {
      connect: async () => calls.push("connect"),
      getOpenOrders: async () => {
        calls.push("getOpenOrders")
        logger.debug({
          event: "pending.orders.received",
          orderCount: 1,
        })
        return {
          ok: true,
          data: [order],
          errors: [],
        }
      },
      getOrder: async ({ symbol, orderId }) => {
        calls.push(`getOrder:${symbol}:${orderId}`)
        return {
          ok: false,
          data: null,
          errors: [Object.assign(new Error("detail failed"), {
            code: "E_DETAIL",
          })],
        }
      },
      disconnect: async () => calls.push("disconnect"),
    }
  }
}

test("healthcheck captures full open-orders result and every detail response", async () => {
  const events = []
  const publishedReports = []
  const calls = []
  const order = {
    id: "2124329325141426176",
    symbol: "HYPEUSDT",
    status: "OPEN",
  }
  const exitCode = await runWorkflow({
    mode: "publish",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    brokerFactory: createOrderScanBroker({
      calls,
      order,
    }),
    runDiagnostics: async () => createDiagnosticReport(),
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
  })
  assert.deepEqual(calls, [
    "connect",
    "getOpenOrders",
    "getOrder:HYPEUSDT:2124329325141426176",
    "disconnect",
  ])
  const [report] = publishedReports
  const open = report.results.find((entry) => entry.operation === "Broker API getOpenOrders")
  const detail = report.results.find((entry) => entry.operation === "Broker API getOrder")
  assert.equal(open.status, "passed")
  assert.equal(open.response.data[0].id, order.id)
  assert.equal(detail.status, "failed")
  assert.equal(detail.request.arguments[0].orderId, order.id)
  assert.equal(detail.errors[0].code, "E_DETAIL")
  assert.ok(report.events.some((event) => event.event === "pending.orders.received"))
  assert.equal(exitCode, 1)
})

test("healthcheck records failed getOpenOrders response and skips detail reads", async () => {
  const events = []
  const publishedReports = []
  const calls = []
  const exitCode = await runWorkflow({
    mode: "publish",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    brokerFactory: () => ({
      connect: async () => {},
      getOpenOrders: async () => ({
        ok: false,
        data: [{
          id: "123",
          symbol: "HYPEUSDT",
        }],
        errors: [Object.assign(new Error("pending failed"), {
          code: "E_PENDING",
        })],
      }),
      getOrder: async () => calls.push("getOrder"),
      disconnect: async () => {},
    }),
    runDiagnostics: async () => createDiagnosticReport(),
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
  })
  assert.deepEqual(calls, [])
  const [report] = publishedReports
  const open = report.results.find((entry) => entry.operation === "Broker API getOpenOrders")
  assert.equal(open.status, "failed")
  assert.equal(open.response.data[0].id, "123")
  assert.equal(open.errors[0].code, "E_PENDING")
  assert.equal(exitCode, 1)
})

test("focused order-read health gate requires every discovered order detail to succeed", () => {
  const openOrders = {
    operation: "Broker API getOpenOrders",
    status: "passed",
    response: {
      ok: true,
      data: [
        {\n          id: "order-1",\n          symbol: "HYPEUSDT",\n        },
        {\n          id: "order-2",\n          symbol: "BTCUSDT",\n        },
      ],
    },
  }
  const detail = (orderId, status) => ({
    operation: "Broker API getOrder",
    status,
    request: { arguments: [{ orderId }] },
  })

  const healthy = evaluateOrderReadHealthCheck({
    report: {
      results: [openOrders, detail({ orderId: "order-1", status: "passed" }), detail({ orderId: "order-2", status: "passed" })],
    },
  })
  assert.equal(healthy.healthy, true)
  assert.deepEqual(healthy.missingRequiredOperations, [])

  const failedDetail = evaluateOrderReadHealthCheck({
    report: {
      results: [openOrders, detail({ orderId: "order-1", status: "passed" }), detail({ orderId: "order-2", status: "failed" })],
    },
  })
  assert.equal(failedDetail.healthy, false)
  assert.deepEqual(failedDetail.missingRequiredOperations, [
    "Broker API getOrder for every discovered order",
  ])

  const missingDetail = evaluateOrderReadHealthCheck({
    report: {
      results: [openOrders, detail("order-1", "passed")],
    },
  })
  assert.equal(missingDetail.healthy, false, "the gate must detect an order whose detail read was skipped")
})

test("focused order-read health gate accepts an explicit empty open-order list", () => {
  const result = evaluateOrderReadHealthCheck({
    report: {
      results: [{
        operation: "Broker API getOpenOrders",
        status: "passed",
        response: {
          ok: true,
          data: [],
        },
      }],
    },
  })
  assert.equal(result.healthy, true)
})

test("default publish healthcheck skips broad diagnostics but still runs order reads", async () => {
  const events = []
  const publishedReports = []
  let broadDiagnosticCalls = 0
  const exitCode = await runWorkflow({
    mode: "publish",
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => {
      broadDiagnosticCalls += 1
      throw new Error("broad diagnostics must be opt-in")
    },
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
  })

  assert.equal(broadDiagnosticCalls, 0)
  assert.equal(exitCode, 0)
  assert.equal(publishedReports[0].healthCheck.scope, "bitunix-order-read")
  assert.equal(publishedReports[0].healthCheck.healthy, true)
  assert.equal(
    publishedReports[0].results.some((entry) => entry.operation === "Broker API getOpenOrders"),
    true,
  )
})

test("full-diagnostics healthcheck keeps the existing broad diagnostic suite available", async () => {
  const events = []
  const publishedReports = []
  let broadDiagnosticCalls = 0
  const exitCode = await runWorkflow({
    mode: "publish",
    includeGeneralDiagnostics: true,
    brokersRoot: "/repo/packages/brokers",
    repositoryRoot: "/repo",
    env,
    stdout,
    runDiagnostics: async () => {
      broadDiagnosticCalls += 1
      return createDiagnosticReport()
    },
    publishDiagnostics: createPublisher({
      events,
      publishedReports,
    }),
  })

  assert.equal(broadDiagnosticCalls, 1)
  assert.equal(exitCode, 0)
  assert.equal(publishedReports[0].healthCheck.scope, "operator-order-preflight")
})
