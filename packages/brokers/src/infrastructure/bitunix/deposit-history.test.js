import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

const DEPOSIT_PATH = "/api/spot/v1/deposit/page"

function createBroker({ response = [] } = {}) {
  const calls = []
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => ({
        async request(input) {
          calls.push(input)
          if (response instanceof Error) {
            throw response
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

function createDepositRecord(overrides = {}) {
  return {
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
    ...overrides,
  }
}

test("Bitunix Spot broker retrieves one filtered deposit page without losing record identity", async () => {
  const depositRecord = createDepositRecord()
  const { broker, calls } = createBroker({ response: [depositRecord] })

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
    path: DEPOSIT_PATH,
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

test("Bitunix Spot broker rejects invalid deposit filters before making a request", async () => {
  const invalidInputs = [
    { id: "" },
    { coin: " " },
    { type: "withdraw" },
    { transactionHash: "" },
    { transactionHash: "hash" },
    {
      type: "inside_transfer_in",
      transactionHash: "hash",
    },
    { startTime: Number.MAX_SAFE_INTEGER + 1 },
    {
      startTime: 20,
      endTime: 10,
    },
    { limit: 0 },
    { limit: 101 },
  ]
  const { broker, calls } = createBroker()

  const results = await Promise.all(invalidInputs.map((input) => broker.getDeposits(input)))

  assert.ok(results.every((result) => result.ok === false), "every malformed deposit filter must return an unsuccessful result")
  assert.equal(calls.length, 0, "invalid deposit filters must be rejected before the private REST endpoint is called")
})

test("Bitunix Spot broker rejects malformed deposit rows instead of returning partial history", async () => {
  const malformedResponses = [
    null,
    [null],
    [createDepositRecord({ id: Number.MAX_SAFE_INTEGER + 1 })],
    [createDepositRecord({ amount: "not-a-decimal" })],
    [createDepositRecord({ ctime: Number.MAX_SAFE_INTEGER + 1 })],
    [createDepositRecord({ network: 12 })],
    [createDepositRecord({ transactionHash: 12 })],
  ]
  const results = await Promise.all(malformedResponses.map(async (response) => {
    const { broker } = createBroker({ response })
    return broker.getDeposits()
  }))

  assert.ok(results.every((result) => result.ok === false), "malformed deposit envelopes and rows must fail closed")
  assert.ok(results.every((result) => Array.isArray(result.errors) && result.errors.length > 0), "each malformed deposit response must expose a useful validation error")
})

test("Bitunix Spot broker accepts an explicit empty deposit history", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.getDeposits()

  assert.equal(result.ok, true, "an explicit empty deposit array is a valid empty history response")
  assert.deepEqual(result.data, [], "an empty deposit response must remain empty rather than being synthesized")
  assert.equal(calls.length, 1, "an empty history result must still represent one successful read request")
})

test("Bitunix Spot broker preserves on-chain deposit fields and unfamiliar statuses", async () => {
  const onChainDeposit = createDepositRecord({
    transactionHash: "d829e32be84907a4dfb5bee5dcdaee6b637be287f8db52817860e7169003b92d",
    network: "Tron (TRC-20)",
    type: "deposit",
    fromAddress: "TB73gtW1hsTxxA9XUYKLSJKTSHw6Jk53eH",
    toAddress: "TPKhSAEy84qvpomF5wF7h5ih1WmbmupXor",
    amount: "1000.00000000",
    status: "future_status",
  })
  const { broker, calls } = createBroker({ response: [onChainDeposit] })

  const result = await broker.getDeposits({
    type: "deposit",
    transactionHash: onChainDeposit.transactionHash,
  })

  assert.equal(result.ok, true, "a documented on-chain deposit record must be accepted")
  assert.deepEqual(calls[0].body, {
    type: "deposit",
    transactionHash: onChainDeposit.transactionHash,
  }, "transactionHash must be sent only with the explicit on-chain deposit type")
  assert.equal(result.data[0].transactionHash, onChainDeposit.transactionHash, "on-chain transaction hashes must remain unchanged")
  assert.equal(result.data[0].network, "Tron (TRC-20)", "on-chain network names must remain unchanged")
  assert.equal(result.data[0].status, "future_status", "unfamiliar deposit statuses must remain visible without guessed normalization")
})

test("Bitunix Spot broker normalizes the single-object deposit response documented by the schema", async () => {
  const depositRecord = createDepositRecord()
  const { broker } = createBroker({ response: depositRecord })

  const result = await broker.getDeposits()

  assert.equal(result.ok, true, "the documented single-object deposit data shape must be supported")
  assert.deepEqual(result.data, [depositRecord], "a single deposit record must be returned as a one-record immutable collection")
})

test("Bitunix Spot broker preserves safe numeric IDs and string timestamps when optional fields are absent", async () => {
  const depositRecord = createDepositRecord({
    id: 487067,
    ctime: "1744191503000",
  })
  delete depositRecord.transactionHash
  delete depositRecord.network
  const { broker } = createBroker({ response: [depositRecord] })

  const result = await broker.getDeposits()

  assert.equal(result.ok, true, "safe numeric IDs and integer-string timestamps must remain supported")
  assert.deepEqual(result.data[0], {
    id: "487067",
    coin: "USDT",
    type: "inside_transfer_in",
    fromAddress: "989541187",
    toAddress: "681979174",
    amount: "10.00000000",
    status: "pending",
    ctime: "1744191503000",
  }, "absent optional network and transactionHash fields must remain absent")
})
