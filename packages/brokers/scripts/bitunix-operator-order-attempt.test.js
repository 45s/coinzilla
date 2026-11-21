import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createBitunixOperatorOrderPreflight } from "./bitunix-hypeusdt-order-preflight.js"
import {
  assertBitunixOperatorInteractiveTerminal,
  createOneShotMarker,
  runBitunixOperatorOrderAttempt,
} from "./bitunix-operator-order-attempt.js"

function createValidBitunixOperatorPreflightInput({ overrides = {} } = {}) {
  const market = {
    symbol: "HYPEUSDT",
    baseAsset: {
      code: "HYPE",
    },
    quoteAsset: {
      code: "USDT",
    },
  }
  const symbolFilters = {
    symbol: "HYPEUSDT",
    base: "HYPE",
    quote: "USDT",
    isOpen: "1",
    minVolume: "0.001",
    minPrice: "10",
  }
  const usdtBalance = {
    free: {
      amount: "1.2500",
      asset: {
        code: "USDT",
      },
    },
    locked: {
      amount: "0.5000",
      asset: {
        code: "USDT",
      },
    },
  }
  return {
    marketResult: {
      ok: true,
      data: [market],
    },
    filtersResult: {
      ok: true,
      data: symbolFilters,
    },
    balancesResult: {
      ok: true,
      data: [usdtBalance],
    },
    openOrdersResult: {
      ok: true,
      data: [],
    },
    ...overrides,
  }
}

function createMockBitunixReadBroker({ events, input }) {
  return {
    async connect() {
      events.push("read.connect")
    },
    async getExchangeMarkets() {
      events.push("read.markets")
      return input.marketResult
    },
    async getSymbolFilters() {
      events.push("read.filters")
      return input.filtersResult
    },
    async getBalances() {
      events.push("read.balances")
      return input.balancesResult
    },
    async getOpenOrders() {
      events.push("read.openOrders")
      return input.openOrdersResult
    },
    async disconnect() {
      events.push("read.disconnect")
    },
  }
}

function createMockBitunixOrderBroker({ events, orderResult, orderDisconnectError }) {
  return {
    async connect() {
      events.push("order.connect")
    },
    async createOrder(order) {
      events.push({
        operation: "createOrder",
        order,
      })
      return orderResult
    },
    async disconnect() {
      events.push("order.disconnect")
      if (orderDisconnectError) {
        throw orderDisconnectError
      }
    },
  }
}

function createBitunixOperatorAttemptDependencies({
  overrides = {},
  confirmation = true,
  markerError,
  orderResult = {
    ok: true,
    data: {
      id: "order-123",
    },
    mutationOutcome: "CONFIRMED",
  },
  orderDisconnectError,
} = {}) {
  const events = []
  const input = createValidBitunixOperatorPreflightInput({
    overrides,
  })
  const readBroker = createMockBitunixReadBroker({
    events,
    input,
  })
  const orderBroker = createMockBitunixOrderBroker({
    events,
    orderResult,
    orderDisconnectError,
  })
  const run = () => runBitunixOperatorOrderAttempt({
    readBroker,
    createOrderBroker() {
      events.push("order.construct")
      return orderBroker
    },
    async confirm(confirmationInput) {
      events.push({
        operation: "confirm",
        confirmationInput,
      })
      return confirmation
    },
    async createMarker() {
      events.push("marker")
      if (markerError) {
        throw markerError
      }
    },
    writeLine(message) {
      events.push({
        operation: "output",
        message,
      })
    },
  })
  return {
    events,
    run,
  }
}

test("Bitunix operator CLI requires an interactive input and output terminal", () => {
  assert.throws(
    () => assertBitunixOperatorInteractiveTerminal({
      stdin: {
        isTTY: false,
      },
      stdout: {
        isTTY: true,
      },
    }),
    /interactive terminal/i,
  )
  assert.doesNotThrow(() => assertBitunixOperatorInteractiveTerminal({
    stdin: {
      isTTY: true,
    },
    stdout: {
      isTTY: true,
    },
  }))
})

test("Bitunix operator CLI refuses non-interactive execution before credentials or network", () => {
  const scriptPath = fileURLToPath(new URL("./bitunix-hypeusdt-order-attempt.js", import.meta.url))
  const env = {
    ...process.env,
  }
  delete env.BITUNIX_API_KEY
  delete env.BITUNIX_API_SECRET
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env,
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /interactive terminal/i)
  assert.equal(result.stdout, "")
})

test("Bitunix operator marker is exclusive, private, and contains no account balances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bitunix-operator-order-"))
  const markerPath = join(directory, "attempt.json")
  const preflight = createBitunixOperatorOrderPreflight(createValidBitunixOperatorPreflightInput())

  try {
    await assert.rejects(
      createOneShotMarker({
        markerPath,
        preflight: {
          order: {
            ...preflight.order,
            price: "1",
          },
        },
      }),
      /exact fixed HYPEUSDT order intent/i,
    )
    await createOneShotMarker({
      markerPath,
      preflight,
      now: () => 1795219200000,
    })
    const [contents, metadata] = await Promise.all([
      readFile(markerPath, "utf8"),
      stat(markerPath),
    ])
    const marker = JSON.parse(contents)

    if (process.platform !== "win32") {
      assert.equal(metadata.mode & 0o777, 0o600)
    }
    assert.deepEqual(marker.order, preflight.order)
    assert.equal(marker.status, "DISPATCH_STARTED")
    assert.equal(Object.hasOwn(marker, "freeQuoteBalance"), false)
    await assert.rejects(
      createOneShotMarker({
        markerPath,
        preflight,
      }),
      {
        code: "EEXIST",
      },
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("Bitunix operator attempt confirms before creating a mutation-enabled broker", async () => {
  const { events, run } = createBitunixOperatorAttemptDependencies()
  const result = await run()

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  const confirmation = events.find((event) => event.operation === "confirm").confirmationInput
  assert.deepEqual(confirmation.order, {
    symbol: "HYPEUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "30",
    quantity: "0.4",
    notional: "12",
  }, "the final approval prompt must identify the exact fixed order being submitted")
  assert.equal(Object.hasOwn(confirmation, "confirmationPhrase"), false, "operator approval must not require manually typing a long confirmation phrase")
  assert.ok(events.indexOf("read.disconnect") < events.findIndex((event) => event.operation === "confirm"))
  assert.ok(events.findIndex((event) => event.operation === "confirm") < events.indexOf("order.construct"))
  assert.ok(events.indexOf("order.connect") < events.indexOf("marker"))
  assert.ok(events.indexOf("marker") < events.findIndex((event) => event.operation === "createOrder"))
  assert.deepEqual(
    events.find((event) => event.operation === "createOrder").order,
    {
      symbol: "HYPEUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.4",
      price: "30",
    },
  )
})

test("Bitunix operator attempt stops without a marker or mutation when confirmation is declined", async () => {
  const { events, run } = createBitunixOperatorAttemptDependencies({
    confirmation: false,
  })
  const result = await run()

  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(events.includes("marker"), false)
  assert.equal(events.includes("order.construct"), false)
})

test("Bitunix operator attempt stops before mutation when the one-shot marker cannot be created", async () => {
  const { events, run } = createBitunixOperatorAttemptDependencies({
    markerError: Object.assign(new Error("marker already exists"), {
      code: "EEXIST",
    }),
  })

  await assert.rejects(run(), /marker already exists/)
  assert.equal(events.includes("order.construct"), true)
  assert.equal(events.some((event) => event.operation === "createOrder"), false)
})

test("Bitunix operator attempt validates the mutation Broker before creating its marker", async () => {
  const events = []
  const readBroker = createMockBitunixReadBroker({
    events,
    input: createValidBitunixOperatorPreflightInput(),
  })

  await assert.rejects(
    runBitunixOperatorOrderAttempt({
      readBroker,
      createOrderBroker: () => ({
        async connect() {},
        async disconnect() {},
      }),
      async confirm() {
        return true
      },
      async createMarker() {
        events.push("marker")
      },
      writeLine() {},
    }),
    /mutation Broker.*createOrder/i,
  )
  assert.equal(events.includes("marker"), false)
})

test("Bitunix operator attempt never retries an unknown placement outcome", async () => {
  const unknownResult = {
    ok: false,
    mutationOutcome: "OUTCOME_UNKNOWN",
    errors: [new Error("acknowledgement lost")],
  }
  const { events, run } = createBitunixOperatorAttemptDependencies({
    orderResult: unknownResult,
  })
  const result = await run()

  assert.equal(result, unknownResult)
  assert.equal(events.filter((event) => event.operation === "createOrder").length, 1)
  assert.equal(events.includes("marker"), true)
  assert.equal(events.includes("order.disconnect"), true)
})

test("Bitunix operator attempt preserves the broker result if cleanup fails after dispatch", async () => {
  const orderResult = {
    ok: true,
    data: {
      id: "order-123",
    },
    mutationOutcome: "CONFIRMED",
  }
  const { run } = createBitunixOperatorAttemptDependencies({
    orderResult,
    orderDisconnectError: new Error("disconnect failed"),
  })

  const result = await run()

  assert.equal(result, orderResult)
})

test("Bitunix operator attempt does not ask for confirmation after a failed preflight read", async () => {
  const { events, run } = createBitunixOperatorAttemptDependencies({
    overrides: {
      balancesResult: {
        ok: false,
        errors: [new Error("account read failed")],
      },
    },
  })

  await assert.rejects(run(), /account balances failed/)
  assert.equal(events.some((event) => event.operation === "confirm"), false)
  assert.equal(events.includes("order.construct"), false)
})
