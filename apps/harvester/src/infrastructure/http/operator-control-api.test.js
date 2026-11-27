import assert from "node:assert/strict"
import { Readable } from "node:stream"
import test from "node:test"
import { handleOperatorControlRequest } from "./operator-control-api.js"

function createRequest({ method = "GET", body, origin } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  request.method = method
  request.headers = {
    ...(origin ? { origin } : {}),
    ...(method === "POST" ? { "content-type": "application/json" } : {}),
  }
  return request
}

function createResponse() {
  return {
    destroyed: false,
    writableEnded: false,
    status: undefined,
    body: undefined,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body
      this.writableEnded = true
    },
  }
}

test("operator read query delegates to the shared application facade with the local actor", async () => {
  let received
  const response = createResponse()
  const handled = await handleOperatorControlRequest({
    request: createRequest(),
    response,
    pathname: "/api/v1/trading/operator/status",
    operator: {
      async getStatus(input) {
        received = input
        return {
          ok: true,
          data: { runtimeState: "RUNNING" },
        }
      },
    },
  })
  assert.equal(handled, true)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    data: { runtimeState: "RUNNING" },
  })
  assert.deepEqual(received.actor, {
    id: "local-dashboard",
    roles: ["trading-operator"],
  })
})

test("operator pause command delegates the normalized market and request identity", async () => {
  let received
  const response = createResponse()
  await handleOperatorControlRequest({
    request: createRequest({
      method: "POST",
      origin: "http://127.0.0.1:4200",
      body: {
        command: "pause",
        symbol: "btcusdt",
        requestId: "dashboard-test-1",
      },
    }),
    response,
    pathname: "/api/v1/trading/operator/commands",
    operator: {
      async pauseMarket(input) {
        received = input
        return {
          ok: true,
          data: { paused: true },
        }
      },
    },
  })
  assert.equal(response.status, 200)
  assert.equal(received.symbol, "BTCUSDT")
  assert.equal(received.requestId, "dashboard-test-1")
  assert.equal(JSON.parse(response.body).data.paused, true)
})

test("operator writes reject non-Dashboard browser origins", async () => {
  const response = createResponse()
  await handleOperatorControlRequest({
    request: createRequest({
      method: "POST",
      origin: "https://example.com",
      body: { command: "pauseallbuys" },
    }),
    response,
    pathname: "/api/v1/trading/operator/commands",
    operator: {
      async pauseAllBuys() {
        throw new Error("must not execute")
      },
    },
  })
  assert.equal(response.status, 403)
})

test("unknown operator commands are rejected without invoking the facade", async () => {
  const response = createResponse()
  await handleOperatorControlRequest({
    request: createRequest({
      method: "POST",
      body: { command: "liquidate" },
    }),
    response,
    pathname: "/api/v1/trading/operator/commands",
    operator: {
      async pauseAllBuys() {
        throw new Error("must not execute")
      },
    },
  })
  assert.equal(response.status, 400)
  assert.equal(JSON.parse(response.body).error.code, "HARVESTER_OPERATOR_COMMAND_INVALID")
})

test("accepts confirmed operator commands from a Dashboard on a dynamic localhost port", async () => {
  let received = false
  const response = createResponse()
  await handleOperatorControlRequest({
    request: createRequest({
      method: "POST",
      origin: "http://localhost:4317",
      body: {
        command: "pauseallbuys",
        requestId: "dashboard-dynamic-port",
      },
    }),
    response,
    pathname: "/api/v1/trading/operator/commands",
    operator: {
      async pauseAllBuys() {
        received = true
        return {
          ok: true,
          data: { paused: true },
        }
      },
    },
  })
  assert.equal(response.status, 200, "A valid local Dashboard origin must be allowed to submit a confirmed command.")
  assert.equal(received, true, "The local command must reach the existing operator facade.")
})
