import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

const WITHDRAWAL_PATH = "/api/spot/v1/withdraw_transfer/page"

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

function createWithdrawalRecord(overrides = {}) {
  return {
    id: "1909877667383767042",
    outBizId: "123456789",
    type: "withdraw",
    coin: "TRX",
    amount: "19.00000000000000000000",
    status: "pending",
    ctime: 1744185294000,
    network: "Tron (TRC-20)",
    address: "TJmW5D1p1LnMdTMmxuY1VELHht7v5HV7rU",
    transactionHash: "0x1234567890abcdef",
    feeCoin: null,
    fee: null,
    memo: null,
    toType: null,
    toUid: null,
    toPhoneCountryCode: null,
    toPhoneNumber: null,
    toEmail: null,
    remark: null,
    ...overrides,
  }
}

test("Bitunix Spot broker retrieves one filtered withdrawal-history page", async () => {
  const withdrawal = createWithdrawalRecord()
  const { broker, calls } = createBroker({ response: [withdrawal] })

  assert.equal(typeof broker.getWithdrawalHistory, "function", "Bitunix Spot broker must expose the documented read-only withdrawal-history method")
  const result = await broker.getWithdrawalHistory({
    id: withdrawal.id,
    outBizId: withdrawal.outBizId,
    coin: "TRX",
    type: "withdraw",
    transactionHash: withdrawal.transactionHash,
    startTime: 1744185200000,
    endTime: 1744185300000,
    remark: "manual review",
    limit: 10,
  })

  assert.equal(result.ok, true, "a valid withdrawal-history response must produce a successful broker result")
  assert.deepEqual(calls[0], {
    method: "POST",
    path: WITHDRAWAL_PATH,
    body: {
      id: withdrawal.id,
      outBizId: withdrawal.outBizId,
      coin: "TRX",
      type: "withdraw",
      transactionHash: withdrawal.transactionHash,
      startTime: 1744185200000,
      endTime: 1744185300000,
      remark: "manual review",
      limit: 10,
    },
  }, "withdrawal history must send only validated filters in one signed read-only POST")
  assert.equal(result.data[0].amount, "19.00000000000000000000", "withdrawal amount precision must remain exact")
  assert.equal(result.data[0].toAddress, withdrawal.address, "the example's address field must be exposed through the documented toAddress alias")
  assert.equal(result.data[0].address, withdrawal.address, "the original exchange address field must remain available")
  assert.ok(Object.isFrozen(result.data), "the returned withdrawal collection must be immutable")
  assert.ok(Object.isFrozen(result.data[0]), "each returned withdrawal record must be immutable")
})

test("Bitunix Spot broker supports the schema's object response and preserves internal-transfer recipient data", async () => {
  const transfer = createWithdrawalRecord({
    id: "1909921053381820417",
    type: "inside_transfer_out",
    network: null,
    address: undefined,
    transactionHash: undefined,
    toAddress: undefined,
    toType: "email",
    toUid: "681979174",
    toPhoneCountryCode: null,
    toPhoneNumber: null,
    toEmail: "recipient@example.test",
    remark: "internal treasury transfer",
    status: "future_status",
  })
  const { broker } = createBroker({ response: transfer })

  const result = await broker.getWithdrawalHistory({
    type: "inside_transfer_out",
  })

  assert.equal(result.ok, true, "the official single-object data shape must be supported")
  assert.equal(result.data.length, 1, "a single withdrawal record must normalize to one immutable array item")
  assert.equal(result.data[0].toUid, "681979174", "internal-transfer recipient UIDs must remain exact strings")
  assert.equal(result.data[0].toEmail, "recipient@example.test", "recipient email must remain an opaque caller-visible value")
  assert.equal(result.data[0].remark, "internal treasury transfer", "internal-transfer remarks must remain unchanged")
  assert.equal(result.data[0].status, "future_status", "unfamiliar withdrawal statuses must remain visible without guessed normalization")
  assert.equal(Object.hasOwn(result.data[0], "address"), false, "an absent raw address must remain absent")
})

test("Bitunix Spot broker rejects invalid withdrawal-history filters before making a request", async () => {
  const invalidInputs = [
    { id: "" },
    { outBizId: " " },
    { coin: "" },
    { transactionHash: "" },
    { transactionHash: "hash" },
    {
      type: "inside_transfer_out",
      transactionHash: "hash",
    },
    { type: "transfer" },
    { remark: "" },
    { startTime: Number.MAX_SAFE_INTEGER + 1 },
    {
      startTime: 20,
      endTime: 10,
    },
    { limit: 0 },
    { limit: 101 },
  ]
  const { broker, calls } = createBroker()

  const results = await Promise.all(invalidInputs.map((input) => broker.getWithdrawalHistory(input)))

  assert.ok(results.every((result) => result.ok === false), "every malformed withdrawal-history filter must return an unsuccessful result")
  assert.equal(calls.length, 0, "invalid withdrawal-history filters must be rejected before the private REST endpoint is called")
})

test("Bitunix Spot broker rejects malformed withdrawal rows without returning partial history", async () => {
  const malformedResponses = [
    null,
    [null],
    [createWithdrawalRecord({ id: Number.MAX_SAFE_INTEGER + 1 })],
    [createWithdrawalRecord({ amount: "not-a-decimal" })],
    [createWithdrawalRecord({ fee: "not-a-decimal" })],
    [createWithdrawalRecord({ ctime: Number.MAX_SAFE_INTEGER + 1 })],
    [createWithdrawalRecord({ network: 12 })],
    [createWithdrawalRecord({ feeCoin: 12 })],
    [createWithdrawalRecord({ toEmail: 12 })],
    [createWithdrawalRecord({ toUid: Number.MAX_SAFE_INTEGER + 1 })],
    [createWithdrawalRecord({ status: "" })],
    [createWithdrawalRecord({ address: "address-a", toAddress: "address-b" })],
  ]
  const results = await Promise.all(malformedResponses.map(async (response) => {
    const { broker } = createBroker({ response })
    return broker.getWithdrawalHistory()
  }))

  assert.ok(results.every((result) => result.ok === false), "malformed withdrawal envelopes and rows must fail closed")
  assert.ok(results.every((result) => Array.isArray(result.errors) && result.errors.length > 0), "each malformed withdrawal response must expose a useful validation error")
})

test("Bitunix Spot broker accepts an explicit empty withdrawal history", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.getWithdrawalHistory()

  assert.equal(result.ok, true, "an explicit empty withdrawal array is a valid empty history response")
  assert.deepEqual(result.data, [], "an empty withdrawal response must remain empty rather than being synthesized")
  assert.equal(calls.length, 1, "an empty history result must still represent one successful read request")
})

test("Bitunix Spot broker makes one withdrawal-history request and does not retry transport failures", async () => {
  const { broker, calls } = createBroker({
    response: new Error("network unavailable"),
  })

  const result = await broker.getWithdrawalHistory()

  assert.equal(result.ok, false, "a transport failure must remain an unsuccessful read result")
  assert.equal(calls.length, 1, "withdrawal-history transport failures must not trigger a second request")
})
