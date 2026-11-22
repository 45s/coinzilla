import assert from "node:assert/strict"
import test from "node:test"
import { runFindBitunixSpotOrder } from "./find-order-command.js"

const ORDER_ID = "2124329325141426176"
const CREDENTIALS = {
  BITUNIX_API_KEY: "test-api-key",
  BITUNIX_API_SECRET: "test-api-secret",
}

function createOutput() {
  const lines = []
  return {
    lines,
    stream: {
      write: (line) => lines.push(line),
    },
    text: () => lines.join(""),
  }
}

test("read-only HYPE order lookup finds the exact 19-digit string ID", async () => {
  const stdout = createOutput()
  const stderr = createOutput()
  const calls = []
  const order = {
    id: ORDER_ID,
    symbol: "HYPEUSDT",
    status: "OPEN",
    side: "BUY",
    type: "LIMIT",
    originalPrice: "30",
    originalQuantity: "0.366",
    executedQuantity: "0",
    remainingQuantity: "0.366",
  }
  const result = await runFindBitunixSpotOrder({
    env: CREDENTIALS,
    orderId: ORDER_ID,
    stdout: stdout.stream,
    stderr: stderr.stream,
    brokerFactory: ({ credentials, allowLiveOrderMutations }) => {
      assert.equal(credentials.apiKey, CREDENTIALS.BITUNIX_API_KEY)
      assert.equal(allowLiveOrderMutations, false)
      return {
        connect: async () => calls.push("connect"),
        getOpenOrders: async (input) => {
          calls.push({ operation: "getOpenOrders", input })
          return { ok: true, data: [order] }
        },
        disconnect: async () => calls.push("disconnect"),
      }
    },
  })

  assert.equal(result.exitCode, 0)
  assert.equal(result.found, true)
  assert.equal(result.order.id, ORDER_ID)
  assert.deepEqual(calls, [
    "connect",
    { operation: "getOpenOrders", input: { symbol: "HYPEUSDT" } },
    "disconnect",
  ])
  assert.match(stdout.text(), /FOUND: HYPEUSDT order 2124329325141426176/)
  assert.match(stdout.text(), /Status: OPEN/)
  assert.match(stdout.text(), /No order mutation was performed/)
  assert.equal(stderr.text(), "")
})

test("read-only HYPE order lookup does not infer absence from an empty pending list", async () => {
  const stdout = createOutput()
  const stderr = createOutput()
  const result = await runFindBitunixSpotOrder({
    env: CREDENTIALS,
    orderId: ORDER_ID,
    stdout: stdout.stream,
    stderr: stderr.stream,
    brokerFactory: () => ({
      connect: async () => {},
      getOpenOrders: async () => ({ ok: true, data: [] }),
      disconnect: async () => {},
    }),
  })

  assert.equal(result.exitCode, 2)
  assert.equal(result.found, false)
  assert.match(stdout.text(), /NOT FOUND in current HYPEUSDT pending orders/)
  assert.match(stdout.text(), /not proof that the order does not exist/)
  assert.equal(stderr.text(), "")
})

test("read-only HYPE order lookup requires an exact digit-string ID before connecting", async () => {
  let brokerCreated = false
  const result = await runFindBitunixSpotOrder({
    env: CREDENTIALS,
    orderId: 2124329325141426176,
    brokerFactory: () => {
      brokerCreated = true
      throw new Error("broker must not be created for a numeric order ID")
    },
  }).catch((error) => error)

  assert.ok(result instanceof TypeError)
  assert.match(result.message, /exact digit-string/)
  assert.equal(brokerCreated, false)
})
