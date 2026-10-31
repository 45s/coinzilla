import assert from "node:assert/strict"
import test from "node:test"

import {
  buildBinanceSignaturePayload,
  createSignedBinanceParams,
  signBinanceParams,
} from "./signature.js"

const apiKey = "vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A"
const apiSecret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"

test("HMAC signature matches the official Binance ASCII signing vector", () => {
  const params = {
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    timeInForce: "GTC",
    quantity: "0.01000000",
    price: "52000.00",
    recvWindow: 100,
    timestamp: 1645423376532,
    apiKey,
  }

  assert.equal(
    buildBinanceSignaturePayload(params),
    "apiKey=vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A&price=52000.00&quantity=0.01000000&recvWindow=100&side=SELL&symbol=BTCUSDT&timeInForce=GTC&timestamp=1645423376532&type=LIMIT",
  )
  assert.equal(
    signBinanceParams(params, apiSecret),
    "aa1b5712c094bc4e57c05a1a5c1fd8d88dcd628338ea863fec7b88e59fe2db24",
  )
})

test("HMAC signature matches the official Binance UTF-8 signing vector", () => {
  const params = {
    symbol: "１２３４５６",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
    quantity: "1.00000000",
    price: "0.10000000",
    recvWindow: 5000,
    timestamp: 1645423376532,
    apiKey,
  }

  assert.equal(
    signBinanceParams(params, apiSecret),
    "b33892ae8e687c939f4468c6268ddd4c40ac1af18ad19a064864c47bae0752cd",
  )
})

test("signature payload ignores an existing signature and sorts keys deterministically", () => {
  assert.equal(
    buildBinanceSignaturePayload({
      z: "last",
      signature: "ignored",
      a: "first",
      flag: true,
      count: 2,
    }),
    "a=first&count=2&flag=true&z=last",
  )
})

test("signed params add credentials and timing fields before signing", () => {
  const params = createSignedBinanceParams(
    { symbol: "BTCUSDT", omitZeroBalances: true },
    { apiKey, apiSecret, timestamp: 123456, recvWindow: 5000 },
  )

  assert.deepEqual(params, {
    symbol: "BTCUSDT",
    omitZeroBalances: true,
    apiKey,
    timestamp: 123456,
    recvWindow: 5000,
    signature: signBinanceParams({
      symbol: "BTCUSDT",
      omitZeroBalances: true,
      apiKey,
      timestamp: 123456,
      recvWindow: 5000,
    }, apiSecret),
  })
})

test("signing rejects unsupported parameter values instead of coercing them", () => {
  assert.throws(() => buildBinanceSignaturePayload({ nested: { unsafe: true } }), /must be a string/)
  assert.throws(() => buildBinanceSignaturePayload({ missing: null }), /must be a string/)
  assert.throws(() => signBinanceParams({}, ""), /API secret is required/)
  assert.throws(() => createSignedBinanceParams({}, { apiKey, apiSecret, timestamp: -1 }), /timestamp/)
  assert.throws(() => createSignedBinanceParams({}, { apiKey, apiSecret, timestamp: 1, recvWindow: 60_001 }), /recvWindow/)
})

test("signed params accept Binance recvWindow precision up to three decimals", () => {
  const params = createSignedBinanceParams(
    {},
    { apiKey, apiSecret, timestamp: 123456, recvWindow: 6000.346 },
  )
  assert.equal(params.recvWindow, 6000.346)
  assert.match(params.signature, /^[a-f0-9]{64}$/)
})

test("signed params reject recvWindow precision beyond three decimals", () => {
  assert.throws(
    () => createSignedBinanceParams(
      {},
      { apiKey, apiSecret, timestamp: 123456, recvWindow: 6000.3461 },
    ),
    /recvWindow/,
  )
})
