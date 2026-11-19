import assert from "node:assert/strict"
import test from "node:test"

import { BitunixRestClient } from "../api/rest-client.js"

async function request({ path, body, language, authenticated = false, queryParams }) {
  let capturedRequest
  const client = new BitunixRestClient({
    apiKey: authenticated ? "api-key" : undefined,
    apiSecret: authenticated ? "api-secret" : undefined,
    baseUrl: "https://fapi.bitunix.com",
    language,
    fetchFn: async (url, options) => {
      capturedRequest = { url, options }
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    },
  })
  const response = await client.request({
    method: "GET",
    path,
    queryParams,
    authenticated,
  })

  return {
    capturedRequest,
    response,
  }
}

test("Futures REST parsing preserves decimal tokens and signed int64 funding timestamps", async () => {
  const { response } = await request({
    path: "/api/v1/futures/market/funding_rate",
    body: '{"code":0,"data":[{"symbol":"BTCUSDT","markPrice":60000.000000000001,"fundingRate":0.000500000000000001,"nextFundingTime":9223372036854775807}],"msg":"Success"}',
    language: "en-US",
  })

  assert.equal(response.data[0].markPrice, "60000.000000000001")
  assert.equal(response.data[0].fundingRate, "0.000500000000000001")
  assert.equal(response.data[0].nextFundingTime, "9223372036854775807")
})

test("Futures REST parsing preserves exact numeric values inside depth price/quantity arrays", async () => {
  const { response } = await request({
    path: "/api/v1/futures/market/depth",
    body: '{"code":0,"data":{"asks":[[60000.000000000001,0.000000000000000001]],"bids":[[59999.999999999999,0.000000000000000002]]},"msg":"Success"}',
    language: "en-US",
  })

  assert.equal(response.data.asks[0][0], "60000.000000000001")
  assert.equal(response.data.asks[0][1], "0.000000000000000001")
  assert.equal(response.data.bids[0][0], "59999.999999999999")
  assert.equal(response.data.bids[0][1], "0.000000000000000002")
})

test("Futures REST requests include the documented language header", async () => {
  const { capturedRequest } = await request({
    path: "/api/v1/futures/account",
    body: '{"code":0,"data":[],"msg":"Success"}',
    language: "en-US",
    authenticated: true,
    queryParams: { marginCoin: "USDT" },
  })

  const headers = new Headers(capturedRequest.options.headers)

  assert.equal(headers.get("language"), "en-US")
  assert.equal(capturedRequest.url, "https://fapi.bitunix.com/api/v1/futures/account?marginCoin=USDT")
})
