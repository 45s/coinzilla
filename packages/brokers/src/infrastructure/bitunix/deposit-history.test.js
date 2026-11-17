import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

test("Bitunix Spot broker retrieves one filtered deposit page without losing record identity", async () => {
  const calls = []
  const depositRecord = {
    id: "1909903708907155457",
    transactionHash: null,
    coin: "USDT",
    network: null,
    type: "inside_transfer_in",
    fromAddress: "989541187",
    toAddress: "681979174",
    amount: "10.00000000",
    status: "pending",
    ctime: 1744191503000,
  }
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => ({
        async request(input) {
          calls.push(input)
          return { data: [depositRecord] }
        },
      }),
    },
  })

  assert.equal(typeof broker.getDeposits, "function", "Bitunix Spot broker must expose its documented read-only deposit-history method")
  const result = await broker.getDeposits({
    coin: "USDT",
    type: "inside_transfer_in",
    startTime: 1744191400000,
    endTime: 1744191600000,
    limit: 10,
  })

  assert.equal(result.ok, true, "a valid deposit-record response must produce a successful broker result")
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/spot/v1/deposit/page",
    body: {
      coin: "USDT",
      type: "inside_transfer_in",
      startTime: 1744191400000,
      endTime: 1744191600000,
      limit: 10,
    },
  }, "deposit history must send only the documented filters in one signed read-only POST")
  assert.deepEqual(result.data, [depositRecord], "deposit history must preserve exact record fields and the full broker identifier")
  assert.ok(Object.isFrozen(result.data), "the returned deposit collection must be immutable")
  assert.ok(Object.isFrozen(result.data[0]), "each returned deposit record must be immutable")
})
