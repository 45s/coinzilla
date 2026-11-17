import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

const MATCHING_ORDER_PATH = "/api/spot/v1/order/deal/list"

function createBroker({ response = null } = {}) {
  const calls = []
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => ({
        async request(input) {
          calls.push(input)
          if (response instanceof Error) {
            throw response
          }
          return { data: response }
        },
      }),
    },
  })
  return {
    broker,
    calls,
  }
}

function createMatchingOrder(overrides = {}) {
  return {
    volume: "0.12345678901234567890",
    price: "45000.12345678901234567890",
    fee: "0.00000000000000000001",
    feeCoin: "BTC",
    role: "1",
    ctime: "2026-11-17T20:00:00Z",
    id: "matching-order-123",
    ...overrides,
  }
}

test("Bitunix Spot broker retrieves raw matching-order details without canonical fill mapping", async () => {
  const matchingOrder = createMatchingOrder()
  const { broker, calls } = createBroker({ response: matchingOrder })

  assert.equal(typeof broker.getMatchingOrderDetails, "function", "Bitunix Spot broker must expose the documented per-order matching-detail lookup")
  const result = await broker.getMatchingOrderDetails({
    orderId: "order-123",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true, "a valid matching-order detail must produce a successful broker result")
  assert.deepEqual(calls[0], {
    method: "POST",
    path: MATCHING_ORDER_PATH,
    body: {
      orderId: "order-123",
      symbol: "BTCUSDT",
    },
    authenticated: true,
    stateChanging: false,
  }, "matching-order details must use one signed read-only POST")
  assert.deepEqual(result.data, matchingOrder, "exchange-native fields must be returned unchanged")
  assert.ok(Object.isFrozen(result.data), "the matching-order detail must be immutable")
  assert.equal(Object.hasOwn(result.data, "orderId"), false, "the broker must not synthesize an exchange response orderId")
  assert.equal(Object.hasOwn(result.data, "execId"), false, "the broker must not invent a canonical execution identity")
})

test("Bitunix Spot broker preserves a null matching-order result", async () => {
  const { broker, calls } = createBroker({ response: null })

  const result = await broker.getMatchingOrderDetails({
    orderId: "order-123",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true, "an explicit null data field means no matching-order record")
  assert.equal(result.data, null, "null matching-order data must remain null")
  assert.equal(calls.length, 1, "a null matching-order result must still represent one successful read")
})

test("Bitunix Spot broker rejects invalid matching-order request inputs before I/O", async () => {
  const invalidInputs = [
    {},
    { orderId: "", symbol: "BTCUSDT" },
    { orderId: "order-123", symbol: "" },
    { orderId: " ", symbol: "BTCUSDT" },
    { orderId: "order-123", symbol: " " },
    { orderId: 123, symbol: "BTCUSDT" },
    { orderId: "order-123", symbol: 123 },
  ]
  const { broker, calls } = createBroker()

  const results = await Promise.all(invalidInputs.map((input) => broker.getMatchingOrderDetails(input)))

  assert.ok(results.every((result) => result.ok === false), "invalid order identity inputs must return an unsuccessful result")
  assert.equal(calls.length, 0, "invalid matching-order inputs must be rejected before REST I/O")
})

test("Bitunix Spot broker rejects malformed matching-order responses", async () => {
  const malformedResponses = [
    undefined,
    [],
    [createMatchingOrder()],
    {},
    { ...createMatchingOrder(), volume: "not-a-decimal" },
    { ...createMatchingOrder(), price: "not-a-decimal" },
    { ...createMatchingOrder(), fee: "not-a-decimal" },
    { ...createMatchingOrder(), feeCoin: "" },
    { ...createMatchingOrder(), role: "" },
    { ...createMatchingOrder(), ctime: "" },
    { ...createMatchingOrder(), id: "" },
  ]
  const results = await Promise.all(malformedResponses.map(async (response) => {
    const { broker } = createBroker({ response })
    return broker.getMatchingOrderDetails({
      orderId: "order-123",
      symbol: "BTCUSDT",
    })
  }))

  assert.ok(results.every((result) => result.ok === false), "missing, array, incomplete and malformed matching-order data must fail closed")
  assert.ok(results.every((result) => Array.isArray(result.errors) && result.errors.length > 0), "each malformed matching-order response must expose a validation error")
})

test("Bitunix Spot broker preserves unfamiliar matching-order role values", async () => {
  const matchingOrder = createMatchingOrder({
    role: "future-role",
  })
  const { broker } = createBroker({ response: matchingOrder })

  const result = await broker.getMatchingOrderDetails({
    orderId: "order-123",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true, "unknown exchange role values must not invalidate otherwise valid data")
  assert.equal(result.data.role, "future-role", "unknown role strings must remain unchanged")
})

test("Bitunix Spot broker makes one matching-order request and does not retry transport failures", async () => {
  const { broker, calls } = createBroker({
    response: new Error("network unavailable"),
  })

  const result = await broker.getMatchingOrderDetails({
    orderId: "order-123",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, false, "a transport failure must remain an unsuccessful read result")
  assert.equal(calls.length, 1, "matching-order transport failures must not trigger another request")
})
