import assert from "node:assert/strict"
import test from "node:test"
import { runExistingHypeOrderVerification, EXISTING_HYPE_ORDER } from "./verify-existing-hype-order.js"

const existingOrder = {
  id: "2124329325141426176",
  symbol: "HYPEUSDT",
  status: "OPEN",
  side: "BUY",
  type: "LIMIT",
  originalPrice: "30",
  originalQuantity: "0.366",
  executedQuantity: "0",
  remainingQuantity: "0.366",
  createdAt: "2026-11-22T02:28:00Z",
  updatedAt: "2026-11-22T02:28:00Z",
}

function createOutput() {
  const output = []
  return {
    output,
    stream: {
      write: (value) => output.push(value),
    },
  }
}

test("read-only HYPE verification fetches one symbol and matches the exact 64-bit string order ID", async () => {
  const calls = []
  const stdout = createOutput()
  const stderr = createOutput()
  const result = await runExistingHypeOrderVerification({
    env: {
      BITUNIX_API_KEY: "test-key",
      BITUNIX_API_SECRET: "test-secret",
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    brokerFactory: () => ({
      getOpenOrders: async (input) => {
        calls.push(input)
        return {
          ok: true,
          data: [{
            ...existingOrder,
            id: "2124329325141426177",
          }, existingOrder],
        }
      },
      createOrder: () => assert.fail("verification must never place an order"),
      cancelOrder: () => assert.fail("verification must never cancel an order"),
    }),
  })

  assert.equal(result, 0)
  assert.deepEqual(calls, [{ symbol: "HYPEUSDT" }])
  assert.equal(EXISTING_HYPE_ORDER.orderId, "2124329325141426176")
  assert.match(stdout.output.join(""), /Exact existing HYPEUSDT order FOUND/)
  assert.match(stdout.output.join(""), /Order ID: 2124329325141426176/)
  assert.match(stdout.output.join(""), /Remaining quantity: 0\.366/)
  assert.match(stdout.output.join(""), /No order mutation was attempted/)
  assert.deepEqual(stderr.output, [])
})

test("read-only HYPE verification reports an exact-ID miss without mutation", async () => {
  const stdout = createOutput()
  const stderr = createOutput()
  let mutationCalls = 0
  const result = await runExistingHypeOrderVerification({
    env: {
      BITUNIX_API_KEY: "test-key",
      BITUNIX_API_SECRET: "test-secret",
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    brokerFactory: () => ({
      getOpenOrders: async () => ({
        ok: true,
        data: [{
          ...existingOrder,
          id: "another-order",
        }],
      }),
      createOrder: () => { mutationCalls += 1 },
      cancelOrder: () => { mutationCalls += 1 },
    }),
  })

  assert.equal(result, 2)
  assert.match(stdout.output.join(""), /Exact order NOT FOUND: 2124329325141426176/)
  assert.equal(mutationCalls, 0)
  assert.deepEqual(stderr.output, [])
})
