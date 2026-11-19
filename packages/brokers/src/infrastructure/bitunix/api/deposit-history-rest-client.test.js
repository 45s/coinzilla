import assert from "node:assert/strict"
import test from "node:test"
import { BitunixRestClient } from "./rest-client.js"

test("Bitunix REST client preserves numeric deposit identifiers and amount tokens", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async text() {
        return '{"code":0,"msg":"success","data":[{"id":1909903708907155457,"coin":"USDT","amount":0.000000000000000001,"ctime":1744191503000}]}'
      },
    }),
  })

  const result = await client.request({
    method: "POST",
    path: "/api/spot/v1/deposit/page",
    body: { limit: 1 },
  })

  assert.equal(result.data[0].id, "1909903708907155457", "deposit IDs beyond Number.MAX_SAFE_INTEGER must remain exact strings")
  assert.equal(result.data[0].amount, "0.000000000000000001", "numeric deposit amount tokens must retain every decimal digit")
  assert.equal(result.data[0].ctime, 1744191503000, "safe deposit timestamps must retain their numeric representation")
})
