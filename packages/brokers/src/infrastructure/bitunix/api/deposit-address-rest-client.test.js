import assert from "node:assert/strict"
import test from "node:test"
import { BitunixRestClient } from "./rest-client.js"

test("Bitunix REST client signs the deposit-address POST and unwraps all returned addresses", async () => {
  let captured
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    fetchFn: async (...args) => {
      const [url, options] = args
      captured = {
        url,
        options,
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: "0",
            msg: "success",
            data: [{
              coin: "USDT",
              network: "Tron (TRC-20)",
              address: "TPKhSAEy84qvpomF5wF7h5ih1WmbmupXor",
              memo: null,
            }],
          }
        },
      }
    },
  })

  const result = await client.request({
    method: "POST",
    path: "/api/spot/v1/deposit/address",
    body: {
      coin: "USDT",
      network: "Tron (TRC-20)",
    },
    authenticated: true,
    stateChanging: false,
  })

  assert.equal(captured.url, "https://openapi.bitunix.com/api/spot/v1/deposit/address")
  assert.equal(captured.options.method, "POST")
  assert.deepEqual(JSON.parse(captured.options.body), {
    coin: "USDT",
    network: "Tron (TRC-20)",
  })
  assert.equal(captured.options.headers["api-key"], "api-key")
  assert.equal(captured.options.headers.timestamp, "1700000000000")
  assert.ok(captured.options.headers.sign, "the private lookup must include a REST signature")
  assert.deepEqual(result.data, [{
    coin: "USDT",
    network: "Tron (TRC-20)",
    address: "TPKhSAEy84qvpomF5wF7h5ih1WmbmupXor",
    memo: null,
  }])
})
