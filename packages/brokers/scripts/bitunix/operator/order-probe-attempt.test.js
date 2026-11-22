import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createCaptureRestClientFactory,
  createProbeMarker,
  runBitunixOrderProbeAttempt,
} from "./order-probe-attempt.js"

function createMarketResult() {
  return {
    ok: true,
    data: [{
      symbol: "HYPEUSDT",
      baseAsset: { code: "HYPE" },
      quoteAsset: { code: "USDT" },
    }],
  }
}

function createFiltersResult() {
  return {
    ok: true,
    data: {
      symbol: "HYPEUSDT",
      base: "HYPE",
      quote: "USDT",
      isOpen: "1",
      minVolume: "0.1",
      minPrice: "10",
    },
  }
}

function createDefaultBalances() {
  return [
    {
      free: {
        amount: "0.01",
        asset: { code: "HYPE" },
      },
      locked: {
        amount: "0",
        asset: { code: "HYPE" },
      },
    },
    {
      free: {
        amount: "0.01",
        asset: { code: "USDT" },
      },
      locked: {
        amount: "0",
        asset: { code: "USDT" },
      },
    },
  ]
}

function createReadBroker({ events, balances = null, openOrders = [] }) {
  return {
    async connect() {
      events.push("read.connect")
    },
    async getExchangeMarkets() {
      events.push("read.markets")
      return createMarketResult()
    },
    async getSymbolFilters() {
      events.push("read.filters")
      return createFiltersResult()
    },
    async getBalances() {
      events.push("read.balances")
      return {
        ok: true,
        data: balances ?? createDefaultBalances(),
      }
    },
    async getOpenOrders() {
      events.push("read.openOrders")
      return {
        ok: true,
        data: openOrders,
      }
    },
    async disconnect() {
      events.push("read.disconnect")
    },
  }
}

function createMutationBroker({ events, result }) {
  return {
    async connect() {
      events.push("mutation.connect")
    },
    async createOrder(input) {
      events.push({
        operation: "createOrder",
        input,
      })
      return result
    },
    async disconnect() {
      events.push("mutation.disconnect")
    },
  }
}

function createAttemptCallbacks({
  events,
  capture,
  markerPath,
  mutationBroker,
  confirmation,
  matrixGuard,
}) {
  return {
    createOrderBroker({ capture: providedCapture }) {
      assert.equal(providedCapture, capture)
      events.push("mutation.construct")
      return mutationBroker
    },
    async assertMatrixCanContinue() {
      events.push("matrix.check")
      await matrixGuard?.()
    },
    async confirm({ preflight }) {
      events.push({
        operation: "confirm",
        probeId: preflight.probe.id,
      })
      return confirmation
    },
    async createMarker({ preflight }) {
      return createProbeMarker({
        markerPath,
        preflight,
      })
    },
    writeLine(message) {
      events.push({
        operation: "output",
        message,
      })
    },
  }
}

function createDependencies({
  directory,
  result,
  confirmation = true,
  balances,
  openOrders,
  matrixGuard,
} = {}) {
  const events = []
  const capture = {}
  const readBroker = createReadBroker({
    events,
    balances,
    openOrders,
  })
  const mutationBroker = createMutationBroker({
    events,
    result: result ?? {
      ok: false,
      mutationOutcome: "REJECTED",
      errors: [Object.assign(new Error("Insufficient balance"), {
        code: "BITUNIX_REST_EXCHANGE_REJECTED",
        exchangeCode: "10005",
        status: 200,
        kind: "exchange",
      })],
    },
  })
  const markerPath = join(directory, "probe.json")
  const callbacks = createAttemptCallbacks({
    events,
    capture,
    markerPath,
    mutationBroker,
    confirmation,
    matrixGuard,
  })
  return {
    events,
    capture,
    markerPath,
    run: (probeId = "limit-buy-1") => runBitunixOrderProbeAttempt({
      probeId,
      readBroker,
      ...callbacks,
      capture,
    }),
  }
}

test("Bitunix order probe dispatches one reviewed createOrder request after fresh preflight and confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-"))
  try {
    const { events, run, markerPath } = createDependencies({
      directory,
    })
    const result = await run("limit-sell-2")
    const marker = JSON.parse(await readFile(markerPath, "utf8"))
    const createOrderEvent = events.find((event) => event.operation === "createOrder")

    assert.equal(result.mutationOutcome, "REJECTED")
    assert.deepEqual(createOrderEvent.input, {
      symbol: "HYPEUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: "2",
      price: "30",
    })
    assert.ok(events.indexOf("read.disconnect") < events.findIndex((event) => event.operation === "confirm"))
    assert.ok(events.findIndex((event) => event.operation === "confirm") < events.indexOf("mutation.construct"))
    assert.ok(events.indexOf("mutation.connect") < events.findIndex((event) => event.operation === "createOrder"))
    assert.equal(events.filter((event) => event.operation === "createOrder").length, 1)
    assert.equal(marker.status, "REJECTED")
    assert.equal(marker.brokerResult.mutationOutcome, "REJECTED")
    assert.equal(marker.brokerResult.errors[0].exchangeCode, "10005")
    assert.equal(marker.probe.id, "limit-sell-2")
    assert.equal(events.includes("mutation.disconnect"), true)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe persists confirmed placement and failed reconciliation separately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-reconciliation-"))
  try {
    const resultFixture = {
      ok: false,
      mutationOutcome: "CONFIRMED",
      data: {
        orderId: "2124329325141426176",
        symbol: "HYPEUSDT",
        side: 2,
        type: 1,
        volume: "0.366",
        price: "30",
        placeStatus: 1,
        placeCode: 0,
        placeMsg: "成功",
      },
      reconciliation: {
        status: "UNAVAILABLE",
        source: "PLACEMENT_ACKNOWLEDGEMENT",
        endpoint: "/api/spot/v1/order/detail",
        error: {
          code: "BITUNIX_REST_EXCHANGE_REJECTED",
          exchangeCode: "100005",
          kind: "exchange",
          status: 200,
        },
      },
      errors: [Object.assign(new Error("result.api.parameter.sign.illegal"), {
        code: "BITUNIX_REST_EXCHANGE_REJECTED",
        exchangeCode: "100005",
        status: 200,
        kind: "exchange",
      })],
    }
    const { events, run, markerPath } = createDependencies({
      directory,
      result: resultFixture,
      balances: [
        {
          free: { amount: "0.01", asset: { code: "HYPE" } },
          locked: { amount: "0", asset: { code: "HYPE" } },
        },
        {
          free: { amount: "11.3", asset: { code: "USDT" } },
          locked: { amount: "0", asset: { code: "USDT" } },
        },
      ],
    })
    const result = await run("limit-buy-11-usdt")
    const marker = JSON.parse(await readFile(markerPath, "utf8"))
    const output = events.filter((event) => event.operation === "output").map((event) => event.message).join("\n")

    assert.equal(result.ok, false, "an un-reconciled acknowledgement is not a normalized Order result")
    assert.equal(result.mutationOutcome, "CONFIRMED", "the marker must retain the accepted exchange mutation outcome")
    assert.equal(marker.status, "CONFIRMED", "the one-shot marker must never invite a duplicate placement")
    assert.equal(marker.brokerResult.data.orderId, "2124329325141426176", "the accepted order ID must be preserved as a string")
    assert.deepEqual(marker.brokerResult.reconciliation, resultFixture.reconciliation, "the reconciliation state and error metadata must be persisted")
    assert.equal(marker.brokerResult.errors[0].exchangeCode, "100005", "the failed detail lookup must remain in the evidence")
    assert.match(output, /placement confirmed; reconciliation unavailable/i, "operator output must not mislabel the accepted placement as rejected")
    assert.match(output, /Reconciliation: UNAVAILABLE \(PLACEMENT_ACKNOWLEDGEMENT\)/i)
    assert.equal(events.filter((event) => event.operation === "createOrder").length, 1, "the operator path must dispatch exactly one mutation")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe decline creates no marker and constructs no mutation Broker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-decline-"))
  try {
    const { events, run, markerPath } = createDependencies({
      directory,
      confirmation: false,
    })
    const result = await run()

    assert.equal(result.mutationOutcome, "NOT_SENT")
    assert.equal(events.includes("mutation.construct"), false)
    assert.equal(events.some((event) => event.operation === "createOrder"), false)
    await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe marker is exclusive and private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-marker-"))
  const markerPath = join(directory, "probe.json")
  const preflight = {
    probe: {
      id: "limit-buy-1",
      symbol: "HYPEUSDT",
    },
    wireRequest: {
      symbol: "HYPEUSDT",
      side: 2,
      type: 1,
      volume: "1",
      price: "30",
    },
  }
  try {
    await createProbeMarker({
      markerPath,
      preflight,
    })
    const [contents, metadata] = await Promise.all([
      readFile(markerPath, "utf8"),
      stat(markerPath),
    ])
    assert.equal(JSON.parse(contents).status, "DISPATCH_STARTED")
    if (process.platform !== "win32") {
      assert.equal(metadata.mode & 0o777, 0o600)
    }
    await assert.rejects(
      createProbeMarker({
        markerPath,
        preflight,
      }),
      { code: "EEXIST" },
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe refuses missing balance evidence before confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-preflight-"))
  try {
    const { events, run } = createDependencies({
      directory,
      balances: [{
        free: {
              amount: "0",
              asset: { code: "USDT" },
            },
        locked: {
              amount: "0",
              asset: { code: "USDT" },
            },
      }],
    })
    await assert.rejects(run("market-buy-1"), /explicit HYPE balance row/i)
    assert.equal(events.some((event) => event.operation === "confirm"), false)
    assert.equal(events.includes("mutation.construct"), false)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe refuses an existing HYPEUSDT open order before confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-open-orders-"))
  try {
    const { events, run } = createDependencies({
      directory,
      openOrders: [{ orderId: "existing-order" }],
    })
    await assert.rejects(run(), /existing open orders/i)
    assert.equal(events.some((event) => event.operation === "confirm"), false)
    assert.equal(events.includes("mutation.construct"), false)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe stops with the explicit unknown outcome and does not retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-unknown-"))
  try {
    const unknownResult = {
      ok: false,
      mutationOutcome: "OUTCOME_UNKNOWN",
      errors: [new Error("response lost")],
    }
    const { events, run } = createDependencies({
      directory,
      result: unknownResult,
    })
    const result = await run()

    assert.equal(result, unknownResult)
    assert.equal(events.filter((event) => event.operation === "createOrder").length, 1)
    const marker = JSON.parse(await readFile(join(directory, "probe.json"), "utf8"))
    assert.equal(marker.status, "OUTCOME_UNKNOWN")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

function createPlacementResponse() {
  return new Response(JSON.stringify({
    code: 0,
    msg: "success",
    data: {
      orderId: "probe-order-1",
      symbol: "HYPEUSDT",
      side: 2,
      type: 1,
      volume: "1",
      price: "30",
      placeStatus: "1",
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function createTestRestClient({ capture, fetchFn }) {
  const factory = createCaptureRestClientFactory({
    capture,
    fetchFn,
  })
  return factory({
    apiKey: "test-key",
    apiSecret: "test-secret",
    baseUrl: "https://openapi.bitunix.com",
    requestTimeout: 1000,
  })
}

test("Bitunix probe capture records the placement request and raw response, never auth headers", async () => {
  let receivedOptions
  const capture = {}
  const client = createTestRestClient({
    capture,
    fetchFn: async (...args) => {
      const [url, options] = args
      receivedOptions = options
      assert.equal(new URL(url).pathname, "/api/spot/v1/order/place_order")
      return createPlacementResponse()
    },
  })
  await client.request({
    method: "POST",
    path: "/api/spot/v1/order/place_order",
    body: {
      symbol: "HYPEUSDT",
      side: 2,
      type: 1,
      volume: "1",
      price: "30",
    },
    authenticated: true,
    stateChanging: true,
  })

  assert.equal(capture.request.path, "/api/spot/v1/order/place_order")
  assert.deepEqual(JSON.parse(capture.request.body), {
    symbol: "HYPEUSDT",
    side: 2,
    type: 1,
    volume: "1",
    price: "30",
  })
  assert.equal(capture.response.httpStatus, 200)
  assert.match(capture.response.body, /probe-order-1/)
  assert.equal(Object.hasOwn(capture, "headers"), false)
  assert.equal(receivedOptions.headers["api-key"], "test-key")
  assert.equal(receivedOptions.headers.sign !== undefined, true)
})

test("Bitunix order probe classifies preflight failure as NOT_SENT", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-not-sent-"))
  try {
    const { events, run } = createDependencies({
      directory,
      balances: [{
        free: {
              amount: "0",
              asset: { code: "USDT" },
            },
        locked: {
              amount: "0",
              asset: { code: "USDT" },
            },
      }],
    })
    await assert.rejects(
      run("market-buy-1"),
      (error) => error.mutationOutcome === "NOT_SENT" &&
        /explicit HYPE balance row/i.test(error.message),
    )
    assert.equal(events.some((event) => event.operation === "confirm"), false)
    assert.equal(events.includes("mutation.construct"), false)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix order probe classifies an existing one-shot marker as NOT_SENT", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-marker-exists-"))
  try {
    const { run, markerPath, events } = createDependencies({
      directory,
    })
    await createProbeMarker({
      markerPath,
      preflight: {
        probe: { id: "limit-buy-1" },
        wireRequest: {
          symbol: "HYPEUSDT",
          side: 2,
          type: 1,
          volume: "1",
          price: "30",
        },
      },
    })
    await writeFile(markerPath, JSON.stringify({
      status: "REJECTED",
    }))
    await assert.rejects(
      run(),
      (error) => error.mutationOutcome === "NOT_SENT" && error.code === "EEXIST",
    )
    assert.equal(events.some((event) => event.operation === "createOrder"), false)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})


function createOrderDetailFetch() {
  return async (url) => {
    const path = new URL(url).pathname
    const data = path.endsWith("/order/detail")
      ? {
        orderId: "probe-order-1",
        userId: "private-user-id",
        symbol: "HYPEUSDT",
      }
      : {
        orderId: "probe-order-1",
        symbol: "HYPEUSDT",
        side: 2,
        type: 1,
        volume: "1",
        price: "30",
        placeStatus: "1",
      }
    return new Response(JSON.stringify({
      code: 0,
      msg: "success",
      data,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
}

test("Bitunix probe capture records sanitized order-detail follow-up responses", async () => {
  const capture = {}
  const client = createTestRestClient({
    capture,
    fetchFn: createOrderDetailFetch(),
  })
  await client.request({
    method: "POST",
    path: "/api/spot/v1/order/place_order",
    body: {
      symbol: "HYPEUSDT",
      side: 2,
      type: 1,
      volume: "1",
      price: "30",
    },
    authenticated: true,
    stateChanging: true,
  })
  await client.request({
    method: "GET",
    path: "/api/spot/v1/order/detail",
    queryParams: { orderId: "probe-order-1" },
    authenticated: true,
    stateChanging: false,
  })

  assert.equal(capture.requests.length, 2)
  assert.equal(capture.followUpResponses.length, 1)
  assert.equal(capture.followUpResponses[0].body.data.userId, "[REDACTED]")
  assert.equal(JSON.stringify(capture).includes("private-user-id"), false)
  assert.equal(Object.hasOwn(capture.requests[1], "body"), false)
  assert.equal(capture.requests[1].query.orderId, "probe-order-1")
})

test("Bitunix order probe blocks before reads when an earlier probe has an unknown outcome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-order-probe-matrix-stop-"))
  try {
    const { events, run } = createDependencies({
      directory,
      matrixGuard: async () => {
        throw new Error("prior probe outcome unknown")
      },
    })
    const error = await run().catch((caught) => caught)

    assert.equal(error.mutationOutcome, "NOT_SENT")
    assert.match(error.message, /prior probe outcome unknown/i)
    assert.equal(events.includes("read.connect"), false)
    assert.equal(events.includes("mutation.construct"), false)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
