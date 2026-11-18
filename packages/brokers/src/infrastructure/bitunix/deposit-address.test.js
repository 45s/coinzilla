import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

const DEPOSIT_ADDRESS_PATH = "/api/spot/v1/deposit/address"
const REQUEST = {
  coin: "USDT",
  network: "Tron (TRC-20)",
}

function createBroker({ response, failure } = {}) {
  const calls = []
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => ({
        async request(input) {
          calls.push(input)
          if (failure) {
            throw failure
          }
          return { data: response }
        },
      }),
    },
  })
  return {
    broker,
    calls,
  }
}

function createAddress(overrides = {}) {
  return {
    coin: REQUEST.coin,
    network: REQUEST.network,
    address: "TPKhSAEy84qvpomF5wF7h5ih1WmbmupXor",
    memo: null,
    ...overrides,
  }
}

test("Bitunix Spot broker retrieves every requested-network deposit address without changing account state", async () => {
  const addresses = [
    createAddress(),
    createAddress({
      address: "TAnotherAddress",
      memo: "deposit-tag",
    }),
  ]
  const { broker, calls } = createBroker({ response: addresses })

  const result = await broker.getDepositAddress(REQUEST)

  assert.equal(result.ok, true, "a documented deposit-address response must produce a successful result")
  assert.deepEqual(calls, [{
    method: "POST",
    path: DEPOSIT_ADDRESS_PATH,
    body: REQUEST,
    authenticated: true,
    stateChanging: false,
  }], "the lookup must send one signed, read-only POST with only coin and network")
  assert.deepEqual(result.data, addresses, "all returned addresses and memo values must remain exact")
  assert.ok(Object.isFrozen(result.data), "the returned address list must be immutable")
  assert.ok(result.data.every((address) => Object.isFrozen(address)), "every returned address record must be immutable")
})

test("Bitunix Spot broker rejects missing or invalid deposit-address inputs before network I/O", async () => {
  const invalidInputs = [
    undefined,
    null,
    [],
    {},
    {
      coin: "",
      network: REQUEST.network,
    },
    {
      coin: " ",
      network: REQUEST.network,
    },
    {
      coin: REQUEST.coin,
    },
    {
      coin: REQUEST.coin,
      network: "",
    },
    {
      coin: REQUEST.coin,
      network: " ",
    },
    {
      coin: REQUEST.coin,
      network: 12,
    },
  ]
  const { broker, calls } = createBroker({ response: [] })
  const results = []

  for (const input of invalidInputs) {
    results.push(await broker.getDepositAddress(input))
  }

  assert.ok(results.every((result) => result.ok === false), "invalid inputs must return unsuccessful results")
  assert.equal(calls.length, 0, "invalid coin/network inputs must be rejected before REST I/O")
})

test("Bitunix Spot broker rejects missing, malformed, or mismatched deposit-address response rows", async () => {
  const malformedResponses = [
    undefined,
    null,
    {},
    [null],
    [createAddress({ coin: "BTC" })],
    [createAddress({ network: "Ethereum" })],
    [createAddress({ address: "" })],
    [createAddress({ address: " " })],
    [createAddress({ memo: 12 })],
  ]
  const results = []

  for (const response of malformedResponses) {
    const { broker } = createBroker({ response })
    results.push(await broker.getDepositAddress(REQUEST))
  }

  assert.ok(results.every((result) => result.ok === false), "malformed or mismatched address data must fail closed")
  assert.ok(results.every((result) => result.errors?.length > 0), "each rejected response must expose a validation error")
})

test("Bitunix Spot broker accepts an explicit empty deposit-address list", async () => {
  const { broker, calls } = createBroker({ response: [] })

  const result = await broker.getDepositAddress(REQUEST)

  assert.equal(result.ok, true, "an explicit empty array is a valid empty address list")
  assert.deepEqual(result.data, [], "an empty response must not be replaced with a fabricated address")
  assert.equal(calls.length, 1, "an empty list still represents one successful read request")
})

test("Bitunix Spot broker reports transport failures without retrying or exposing address data", async () => {
  const failure = new Error("socket closed")
  const { broker, calls } = createBroker({ failure })

  const result = await broker.getDepositAddress(REQUEST)

  assert.equal(result.ok, false, "transport failures must remain unsuccessful results")
  assert.equal(calls.length, 1, "the read request must not be retried automatically")
  assert.doesNotMatch(result.errors[0].message, /TPKhSA|deposit-tag/i, "errors must not include returned address or memo data")
})
