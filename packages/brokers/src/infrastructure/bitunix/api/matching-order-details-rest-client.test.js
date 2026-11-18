import assert from "node:assert/strict"
import test from "node:test"
import { BitunixRestClient } from "./rest-client.js"

test("Bitunix REST client preserves numeric matching-order IDs and decimal tokens", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async text() {
        return '{"code":0,"msg":"success","data":{"volume":0.12345678901234567890,"price":45000.12345678901234567890,"fee":0.00000000000000000001,"feeCoin":"BTC","role":2,"ctime":"2026-11-17T20:00:00Z","id":1909877667383767042}}'
      },
    }),
  })

  const result = await client.request({
    method: "POST",
    path: "/api/spot/v1/order/deal/list",
    body: {
      orderId: "order-123",
      symbol: "BTCUSDT",
    },
  })

  assert.equal(result.data.id, "1909877667383767042", "matching-order IDs must remain exact strings")
  assert.equal(result.data.volume, "0.12345678901234567890", "raw volume text must retain every decimal digit")
  assert.equal(result.data.price, "45000.12345678901234567890", "price text must retain every decimal digit")
  assert.equal(result.data.fee, "0.00000000000000000001", "fee text must retain every decimal digit")
  assert.equal(result.data.role, "2", "numeric role tokens must remain raw strings")
  assert.equal(result.data.ctime, "2026-11-17T20:00:00Z", "the ISO-8601 fill time must remain unchanged")
})
