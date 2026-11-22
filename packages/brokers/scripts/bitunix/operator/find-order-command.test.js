import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runFindBitunixSpotOrder } from "./find-order-command.js"

const ORDER_ID = "2124329325141426176"
const CREDENTIALS = {
  BITUNIX_API_KEY: "test-api-key",
  BITUNIX_API_SECRET: "test-api-secret",
}

function createOutput() {
  const lines = []
  return {
    stream: { write: (line) => lines.push(line) },
    text: () => lines.join(""),
  }
}

test("read-only scan enumerates every active symbol, fetches every order detail, and saves all results", async () => {
  const stdout = createOutput()
  const stderr = createOutput()
  const reportDirectory = await mkdtemp(join(tmpdir(), "bitunix-order-scan-"))
  const calls = []
  const broker = {
    connect: async () => calls.push("connect"),
    getExchangeMarkets: async () => ({
      ok: true,
      data: [
        { symbol: "BTCUSDT" },
        { symbol: "HYPEUSDT" },
        { symbol: "ETHUSDT" },
        { symbol: "HYPEUSDT" },
      ],
    }),
    getOpenOrders: async ({ symbol }) => {
      calls.push(`pending:${symbol}`)
      if (symbol === "ETHUSDT") {
        return { ok: false, errors: [Object.assign(new Error("synthetic pending failure"), { code: "E_PENDING" })] }
      }
      if (symbol === "BTCUSDT") {
        return { ok: true, data: [{
          id: "1001",
          symbol,
          status: "OPEN",
        }] }
      }
      return { ok: true, data: [{
        id: ORDER_ID,
        symbol,
        status: "OPEN",
        side: "BUY",
        type: "LIMIT",
        originalPrice: "30",
        originalQuantity: "0.366",
      }, {
        id: "1002",
        symbol,
        status: "OPEN",
      }] }
    },
    getOrder: async ({ symbol, orderId }) => {
      calls.push(`detail:${symbol}:${orderId}`)
      if (orderId === "1001") {
        return { ok: false, errors: [Object.assign(new Error("synthetic detail failure"), { code: "E_DETAIL" })] }
      }
      return { ok: true, data: { id: orderId, symbol, status: "OPEN" } }
    },
    disconnect: async () => calls.push("disconnect"),
  }

  try {
    const result = await runFindBitunixSpotOrder({
      env: CREDENTIALS,
      orderId: ORDER_ID,
      stdout: stdout.stream,
      stderr: stderr.stream,
      reportDirectory,
      brokerFactory: ({ credentials, logger }) => {
        assert.equal(credentials.apiKey, CREDENTIALS.BITUNIX_API_KEY)
        assert.equal(typeof logger.debug, "function")
        return broker
      },
    })

    assert.equal(result.found, true)
    assert.equal(result.exitCode, 1, "partial failures must be visible even when the target order is found")
    assert.equal(result.report.summary.marketCount, 4)
    assert.equal(result.report.summary.pendingOrderCount, 3)
    assert.equal(result.report.summary.detailReadCount, 3)
    assert.equal(result.report.summary.failedRequestCount, 2)
    assert.equal(result.report.summary.targetMatchCount, 1)
    assert.deepEqual(calls, [
      "connect",
      "pending:BTCUSDT",
      "detail:BTCUSDT:1001",
      "pending:HYPEUSDT",
      `detail:HYPEUSDT:${ORDER_ID}`,
      "detail:HYPEUSDT:1002",
      "pending:ETHUSDT",
      "disconnect",
    ])
    assert.match(stdout.text(), /getExchangeMarkets/)
    assert.match(stdout.text(), /getOpenOrders/)
    assert.match(stdout.text(), /getOrder/)
    assert.match(stdout.text(), /report.saved/)
    assert.equal(stderr.text(), "")

    const saved = JSON.parse(await readFile(result.reportPath, "utf8"))
    assert.equal(saved.summary.targetMatches[0].orderId, ORDER_ID)
    assert.equal(saved.stages.filter((stage) => stage.operation === "broker.getOrder").length, 3)
    assert.ok(saved.stages.some((stage) => stage.result?.errors?.[0]?.code === "E_DETAIL"))
    assert.ok(saved.stages.some((stage) => stage.symbol === "ETHUSDT" && stage.result?.errors?.[0]?.code === "E_PENDING"))
    assert.equal(JSON.stringify(saved).includes(CREDENTIALS.BITUNIX_API_SECRET), false)
  } finally {
    await rm(reportDirectory, { recursive: true, force: true })
  }
})

test("read-only scan visits every active symbol and returns not-found only after a clean complete scan", async () => {
  const stdout = createOutput()
  const reportDirectory = await mkdtemp(join(tmpdir(), "bitunix-order-scan-"))
  const scanned = []
  try {
    const result = await runFindBitunixSpotOrder({
      env: CREDENTIALS,
      orderId: ORDER_ID,
      stdout: stdout.stream,
      stderr: createOutput().stream,
      reportDirectory,
      brokerFactory: () => ({
        connect: async () => {},
        getExchangeMarkets: async () => ({
          ok: true,
          data: [{ symbol: "BTCUSDT" }, { symbol: "HYPEUSDT" }],
        }),
        getOpenOrders: async ({ symbol }) => {
          scanned.push(symbol)
          return { ok: true, data: [] }
        },
        disconnect: async () => {},
      }),
    })
    assert.equal(result.exitCode, 2)
    assert.equal(result.found, false)
    assert.deepEqual(scanned, ["BTCUSDT", "HYPEUSDT"])
    assert.equal(result.report.summary.targetMatchCount, 0)
    assert.ok(result.reportPath)
  } finally {
    await rm(reportDirectory, { recursive: true, force: true })
  }
})

test("read-only scan rejects numeric order IDs before creating a Broker", async () => {
  let brokerCreated = false
  await assert.rejects(
    runFindBitunixSpotOrder({
      env: CREDENTIALS,
      orderId: 2124329325141426176,
      brokerFactory: () => {
        brokerCreated = true
        throw new Error("must not create Broker")
      },
    }),
    /exact digit-string/,
  )
  assert.equal(brokerCreated, false)
})

test("read-only scan records thrown failures and still writes a report", async () => {
  const reportDirectory = await mkdtemp(join(tmpdir(), "bitunix-order-scan-"))
  try {
    const result = await runFindBitunixSpotOrder({
      env: CREDENTIALS,
      orderId: ORDER_ID,
      stdout: createOutput().stream,
      stderr: createOutput().stream,
      reportDirectory,
      brokerFactory: () => ({
        connect: async () => {},
        getExchangeMarkets: async () => { throw Object.assign(new Error("catalog offline"), { code: "E_CATALOG" }) },
        disconnect: async () => {},
      }),
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.found, false)
    assert.ok(result.report.fatalError)
    assert.ok(result.reportPath)
    const saved = JSON.parse(await readFile(result.reportPath, "utf8"))
    assert.equal(saved.stages[0].errors[0].code, "E_CATALOG")
  } finally {
    await rm(reportDirectory, { recursive: true, force: true })
  }
})
