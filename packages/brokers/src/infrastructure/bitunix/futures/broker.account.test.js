import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { Balance } from "@coinzilla/entities"
import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-account-test-key",
  apiSecret: "bitunix-futures-account-test-secret",
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

test("Bitunix Futures account reads sign the request and preserve exact available and locked balances", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        now: () => 1_700_000_000_000,
        nonceFactory: () => "nonce-futures-account",
        fetchFn: async (url, options) => {
          requests.push({ url, options })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data: [{
                marginCoin: "USDT",
                available: "1.200000000000000001",
                frozen: "0.1",
                margin: "0.2",
                transfer: "1.2",
                positionMode: "HEDGE",
                crossUnrealizedPNL: "0",
                isolationUnrealizedPNL: "0",
                bonus: "100",
              }],
            }),
          }
        },
      },
    },
  })

  const result = await broker.getBalances({ marginCoin: "USDT" })

  assert.equal(result.ok, true, "a valid Futures account response must produce a successful balance result")
  assert.equal(requests.length, 1, "the account query must be dispatched exactly once")
  assert.equal(requests[0].url, "https://fapi.bitunix.com/api/v1/futures/account?marginCoin=USDT", "the account query must target the documented Futures endpoint and margin coin")
  assert.equal(requests[0].options.method, "GET", "account reads must use GET")
  assert.equal(requests[0].options.headers["api-key"], credentials.apiKey, "private Futures requests must identify the API key")
  assert.equal(requests[0].options.headers.nonce, "nonce-futures-account", "the signed request must use the injected nonce")
  assert.equal(requests[0].options.headers.timestamp, "1700000000000", "the signed request must use the injected millisecond timestamp")
  const digest = sha256(`nonce-futures-account1700000000000${credentials.apiKey}marginCoinUSDT`)
  assert.equal(requests[0].options.headers.sign, sha256(`${digest}${credentials.apiSecret}`), "Futures REST signatures must follow the official double-SHA256 query canonicalization")
  assert.equal(result.data.length, 1, "the requested USDT margin account must produce one canonical balance")
  assert.ok(result.data[0] instanceof Balance, "account balances must use the shared Balance entity")
  assert.equal(result.data[0].free.amount, "1.200000000000000001", "available balance must retain its exact decimal string")
  assert.equal(result.data[0].locked.amount, "0.3", "order-frozen and position-margin amounts must be added exactly")
  assert.equal(result.data[0].total.amount, "1.500000000000000001", "total balance must exclude promotional bonus and preserve exact arithmetic")
})
