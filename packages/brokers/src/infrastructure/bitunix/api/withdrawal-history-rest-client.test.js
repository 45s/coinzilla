import assert from "node:assert/strict"
import test from "node:test"
import { BitunixRestClient } from "./rest-client.js"

test("Bitunix REST client preserves numeric withdrawal IDs, UIDs, amounts and fees", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async text() {
        return '{"code":0,"msg":"success","data":[{"id":1909877667383767042,"outBizId":"123456789","type":"withdraw","coin":"TRX","amount":19.00000000000000000000,"status":"pending","ctime":1744185294000,"network":"Tron (TRC-20)","address":"TJmW5D1p1LnMdTMmxuY1VELHht7v5HV7rU","transactionHash":null,"feeCoin":"TRX","fee":0.00000000000000000001,"memo":null,"toType":"uid","toUid":681979174,"toPhoneCountryCode":null,"toPhoneNumber":null,"toEmail":null,"remark":null}]}'
      },
    }),
  })

  const result = await client.request({
    method: "POST",
    path: "/api/spot/v1/withdraw_transfer/page",
    body: { limit: 1 },
  })

  assert.equal(result.data[0].id, "1909877667383767042", "withdrawal IDs must remain exact strings")
  assert.equal(result.data[0].toUid, "681979174", "recipient UIDs must remain exact strings")
  assert.equal(result.data[0].amount, "19.00000000000000000000", "withdrawal amount tokens must retain every decimal digit")
  assert.equal(result.data[0].fee, "0.00000000000000000001", "withdrawal fee tokens must retain every decimal digit")
  assert.equal(result.data[0].ctime, 1744185294000, "safe withdrawal timestamps must retain their numeric representation")
})
