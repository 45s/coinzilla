import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"
import { BrokerUnsupportedOperationError } from "../../broker/errors/broker-unsupported-operation-error.js"

const WITHDRAW_PATH = "/api/spot/v1/withdraw"
const CANCEL_WITHDRAW_PATH = "/api/spot/v1/withdraw/cancel"
const INTERNAL_TRANSFER_PATH = "/api/spot/v1/inside_transfer"
const CANCEL_INTERNAL_TRANSFER_PATH = "/api/spot/v1/inside_transfer/cancel"
const FUNDS_TRANSFER_PATH = "/api/spot/v1/funds_transfer"

function createBroker({ responses = {}, allowLiveFundsMutations = false } = {}) {
  const calls = []
  const restClient = {
    async request(input = {}) {
      const { method, path, ...options } = input
      calls.push({
        method,
        path,
        options,
      })
      if (responses[path] instanceof Error) {
        throw responses[path]
      }
      return {
        data: responses[path],
      }
    },
  }
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    allowLiveOrderMutations: false,
    allowLiveFundsMutations,
    dependencies: {
      restClientFactory: () => restClient,
    },
  })
  return {
    broker,
    calls,
  }
}

const VALID_WITHDRAWAL = {
  coin: "USDT",
  network: "Tron (TRC-20)",
  address: "TJmW5D1p1LnMdTMmxuY1VELHht7v5HV7rU",
  amount: "1.25000000",
}

test("Bitunix Spot funds mutations are explicitly gated and never sent by default", async () => {
  const { broker, calls } = createBroker()
  const operations = [
    ["withdraw", VALID_WITHDRAWAL],
    ["cancelWithdrawal", { withdrawId: "1909879608889339906" }],
    ["transferInternally", {
      coin: "USDT",
      amount: "10.00000000",
      toType: "uid",
      toUid: "681979174",
    }],
    ["cancelInternalTransfer", { insideTransferId: "1909921053381820417" }],
    ["transferFunds", {
      type: "spot_futures",
      coin: "USDT",
      amount: "10.00000000",
    }],
  ]

  for (const [method, input] of operations) {
    const result = await broker[method](input)

    assert.equal(result.ok, false, `${method} must remain disabled until funds mutation opt-in`)
    assert.equal(result.mutationOutcome, "NOT_SENT", `${method} must report that no request was sent`)
    assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
  }
  assert.equal(calls.length, 0, "default funds safety gates must prevent all REST requests")
})

test("Bitunix Spot withdrawal sends exact signed state-changing payload and normalizes ID", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: "1909879608889339906",
    },
  })

  const result = await broker.withdraw({
    ...VALID_WITHDRAWAL,
    memo: "memo-123",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED", "a successful exchange acknowledgement confirms request submission")
  assert.deepEqual(result.data, {
    withdrawId: "1909879608889339906",
    requestAccepted: true,
  })
  assert.deepEqual(calls, [{
    method: "POST",
    path: WITHDRAW_PATH,
    options: {
      body: {
        ...VALID_WITHDRAWAL,
        memo: "memo-123",
      },
      authenticated: true,
      stateChanging: true,
    },
  }])
})

test("Bitunix Spot withdrawal accepts the documented object-shaped ID response", async () => {
  const { broker } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: {
        withdrawId: "1909879608889339906",
      },
    },
  })

  const result = await broker.withdraw(VALID_WITHDRAWAL)

  assert.equal(result.ok, true)
  assert.equal(result.data.withdrawId, "1909879608889339906")
})

test("Bitunix Spot withdrawal cancellation reports request acceptance, not final settlement", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [CANCEL_WITHDRAW_PATH]: null,
    },
  })

  const result = await broker.cancelWithdrawal({
    withdrawId: "1909879608889339906",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(result.data, {
    withdrawId: "1909879608889339906",
    requestAccepted: true,
  })
  assert.deepEqual(calls[0], {
    method: "POST",
    path: CANCEL_WITHDRAW_PATH,
    options: {
      body: {
        withdrawId: "1909879608889339906",
      },
      authenticated: true,
      stateChanging: true,
    },
  })
})

test("Bitunix Spot funds transfer supports both documented account directions", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [FUNDS_TRANSFER_PATH]: "1909902180506972162",
    },
  })

  const toFutures = await broker.transferFunds({
    type: "spot_futures",
    coin: "USDT",
    amount: "100.01000000",
  })
  const toSpot = await broker.transferFunds({
    type: "futures_spot",
    coin: "USDT",
    amount: "20.50000000",
  })

  assert.equal(toFutures.ok, true)
  assert.equal(toFutures.data.transferId, "1909902180506972162")
  assert.equal(toSpot.ok, true)
  assert.equal(toSpot.data.transferId, "1909902180506972162")
  assert.deepEqual(calls.map(({ method, path, options }) => ({ method, path, body: options.body })), [
    {
      method: "POST",
      path: FUNDS_TRANSFER_PATH,
      body: {
        type: "spot_futures",
        coin: "USDT",
        amount: "100.01000000",
      },
    },
    {
      method: "POST",
      path: FUNDS_TRANSFER_PATH,
      body: {
        type: "futures_spot",
        coin: "USDT",
        amount: "20.50000000",
      },
    },
  ])
  assert.ok(calls.every(({ options }) => options.authenticated === true && options.stateChanging === true))
})

test("Bitunix Spot internal transfer supports UID, phone and email recipients", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [INTERNAL_TRANSFER_PATH]: "1909921053381820417",
    },
  })

  const byUid = await broker.transferInternally({
    coin: "USDT",
    amount: "10.00000000",
    toType: "uid",
    toUid: "681979174",
    outBizId: "coinzilla-uid-1",
  })
  const byPhone = await broker.transferInternally({
    coin: "USDT",
    amount: "11.00000000",
    toType: "phone",
    toPhoneCountryCode: "+1",
    toPhoneNumber: "5550100",
  })
  const byEmail = await broker.transferInternally({
    coin: "USDT",
    amount: "12.00000000",
    toType: "email",
    toEmail: "recipient@example.com",
    remark: "rebalance",
  })

  assert.equal(byUid.ok, true)
  assert.equal(byPhone.ok, true)
  assert.equal(byEmail.ok, true)
  assert.deepEqual(calls.map(({ options }) => options.body), [
    {
      coin: "USDT",
      amount: "10.00000000",
      toType: "uid",
      toUid: 681979174,
      outBizId: "coinzilla-uid-1",
    },
    {
      coin: "USDT",
      amount: "11.00000000",
      toType: "phone",
      toPhoneCountryCode: "+1",
      toPhoneNumber: "5550100",
    },
    {
      coin: "USDT",
      amount: "12.00000000",
      toType: "email",
      toEmail: "recipient@example.com",
      remark: "rebalance",
    },
  ])
  assert.ok(calls.every(({ options }) => options.authenticated === true && options.stateChanging === true))
})

test("Bitunix Spot internal transfer cancellation reports request acceptance only", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [CANCEL_INTERNAL_TRANSFER_PATH]: null,
    },
  })

  const result = await broker.cancelInternalTransfer({
    insideTransferId: "1909921053381820417",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(result.data, {
    insideTransferId: "1909921053381820417",
    requestAccepted: true,
  })
  assert.deepEqual(calls[0].options.body, {
    insideTransferId: "1909921053381820417",
  })
})

test("Bitunix Spot funds mutation validation rejects invalid values before network I/O", async () => {
  const invalidOperations = [
    [
      "withdraw",
      {
        ...VALID_WITHDRAWAL,
        amount: "0",
      },
    ],
    [
      "withdraw",
      {
        ...VALID_WITHDRAWAL,
        amount: 1,
      },
    ],
    [
      "withdraw",
      {
        ...VALID_WITHDRAWAL,
        amount: "NaN",
      },
    ],
    [
      "withdraw",
      {
        ...VALID_WITHDRAWAL,
        network: "",
      },
    ],
    [
      "withdraw",
      {
        ...VALID_WITHDRAWAL,
        address: " ",
      },
    ],
    [
      "withdraw",
      {
        ...VALID_WITHDRAWAL,
        memo: 123,
      },
    ],
    [
      "cancelWithdrawal",
      {
        withdrawId: 123,
      },
    ],
    [
      "transferFunds",
      {
        type: "invalid",
        coin: "USDT",
        amount: "1",
      },
    ],
    [
      "transferFunds",
      {
        type: "spot_futures",
        coin: "USDT",
        amount: "-1",
      },
    ],
    [
      "transferInternally",
      {
        coin: "USDT",
        amount: "1",
        toType: "uid",
        toUid: "9007199254740992",
      },
    ],
    [
      "transferInternally",
      {
        coin: "USDT",
        amount: "1",
        toType: "uid",
        toUid: "abc",
      },
    ],
    [
      "transferInternally",
      {
        coin: "USDT",
        amount: "1",
        toType: "phone",
        toPhoneCountryCode: "+1",
      },
    ],
    [
      "transferInternally",
      {
        coin: "USDT",
        amount: "1",
        toType: "email",
        toEmail: " ",
      },
    ],
    [
      "transferInternally",
      {
        coin: "USDT",
        amount: "1",
        toType: "email",
        toEmail: "a@b.c",
        outBizId: "x".repeat(33),
      },
    ],
    [
      "cancelInternalTransfer",
      {
        insideTransferId: "",
      },
    ],
  ]

  for (const [method, input] of invalidOperations) {
    const { broker, calls } = createBroker({
      allowLiveFundsMutations: true,
    })
    const result = await broker[method](input)

    assert.equal(result.ok, false, `${method} must reject invalid input`)
    assert.equal(result.mutationOutcome, "NOT_SENT", "invalid funds requests must never be dispatched")
    assert.equal(calls.length, 0, "invalid funds requests must be rejected before network I/O")
  }
})

test("Bitunix Spot funds mutations preserve ambiguous transport outcomes without retries", async () => {
  const transportFailure = new Error("withdraw transport lost after dispatch")
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: transportFailure,
    },
  })

  const result = await broker.withdraw(VALID_WITHDRAWAL)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.errors[0], transportFailure)
  assert.equal(calls.length, 1, "ambiguous funds mutations must never be retried automatically")
})

test("Bitunix Spot funds mutations classify exchange rejections without retrying", async () => {
  const exchangeFailure = new Error("withdraw rejected")
  exchangeFailure.kind = "exchange"
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: exchangeFailure,
    },
  })

  const result = await broker.withdraw(VALID_WITHDRAWAL)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.equal(calls.length, 1)
})

test("Bitunix Spot funds mutations classify malformed success IDs as outcome unknown", async () => {
  const { broker, calls } = createBroker({
    allowLiveFundsMutations: true,
    responses: {
      [WITHDRAW_PATH]: {},
    },
  })

  const result = await broker.withdraw(VALID_WITHDRAWAL)

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(calls.length, 1)
})
