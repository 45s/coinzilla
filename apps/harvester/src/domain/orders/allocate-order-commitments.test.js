import test from "node:test"
import assert from "node:assert/strict"
import { allocateOrderCommitments } from "./allocate-order-commitments.js"

test("allocates BUY actions sequentially against remaining pair investment", () => {
  const first = { side: "BUY", price: "60", quantity: "10" }
  const second = { side: "BUY", price: "60", quantity: "10" }
  const result = allocateOrderCommitments({
    actions: [first, second],
    quoteFreeBalance: "2000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.executableActions, [first])
  assert.deepEqual(result.data.deferredActions, [{ action: second, reason: "PAIR_INVESTMENT_LIMIT" }])
  assert.equal(result.data.remainingInvestment, "400")
})

test("rejects SELL batches that collectively exceed Harvester-owned active inventory", () => {
  const result = allocateOrderCommitments({
    actions: [
      { side: "SELL", quantity: "0.6" },
      { side: "SELL", quantity: "0.6" },
    ],
    quoteFreeBalance: "1000",
    baseFreeBalance: "10",
    quoteCashFlow: "0",
    activeBaseQuantity: "1",
    outstandingRecoveryAmount: "100",
    committedQuote: "0",
    committedBase: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Harvester-owned active inventory/)
})

test("accounts for existing active-order commitments before allocating new BUY and SELL actions", () => {
  const result = allocateOrderCommitments({
    actions: [
      { side: "BUY", price: "10", quantity: "5" },
      { side: "SELL", quantity: "0.4" },
    ],
    quoteFreeBalance: "100",
    baseFreeBalance: "0",
    quoteCashFlow: "-10",
    activeBaseQuantity: "1",
    outstandingRecoveryAmount: "20",
    committedQuote: "30",
    committedBase: "0.2",
    investmentLimit: "100",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.executableActions, [
    { side: "BUY", price: "10", quantity: "5" },
    { side: "SELL", quantity: "0.4" },
  ])
  assert.equal(result.data.remainingQuoteBalance, "10")
  assert.equal(result.data.remainingBaseBalance, "0.4")
  assert.equal(result.data.remainingActiveBase, "0.4")
  assert.equal(result.data.remainingInvestment, "0")
})

test("defers BUY actions when existing commitments exhaust free quote balance", () => {
  const result = allocateOrderCommitments({
    actions: [{ side: "BUY", price: "60", quantity: "10" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "500",
    committedBase: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.executableActions, [])
  assert.equal(result.data.deferredActions[0].reason, "INSUFFICIENT_QUOTE_BALANCE")
})

test("rejects SELL quantities that exceed exchange-available base after existing reservations", () => {
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "0.6" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "1",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: "0.5",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /available free base balance/)
})

test("subtracts shared quote-asset reservations without charging another pair's investment limit", () => {
  const result = allocateOrderCommitments({
    actions: [{ side: "BUY", price: "50", quantity: "1" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    activeBaseBalance: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "900",
    committedBase: "0",
    committedBaseBalance: "0",
    investmentLimit: "100",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.executableActions, [{ side: "BUY", price: "50", quantity: "1" }])
  assert.equal(result.data.remainingQuoteBalance, "50")
  assert.equal(result.data.remainingInvestment, "50")
})

test("subtracts shared base-asset reservations from account availability independently of pair inventory", () => {
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "0.5" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "1",
    activeBaseBalance: "2",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedBase: "0.1",
    committedBaseBalance: "1.8",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /available free base balance/)
})

test("returns structured failures for invalid action sides and negative balance inputs", () => {
  const common = {
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: "0",
    investmentLimit: "1000",
  }
  const invalidSide = allocateOrderCommitments({
    ...common,
    actions: [{ side: "HOLD", quantity: "1" }],
  })
  const negativeBalance = allocateOrderCommitments({
    ...common,
    baseFreeBalance: "-1",
    actions: [],
  })

  assert.equal(invalidSide.ok, false)
  assert.match(invalidSide.errors[0].message, /side must be BUY or SELL/)
  assert.equal(negativeBalance.ok, false)
  assert.match(negativeBalance.errors[0].message, /must be non-negative/)
})

test("rejects malformed commitment inputs without throwing", () => {
  const common = {
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: "0",
    investmentLimit: "1000",
  }
  const invalidCases = [
    { actions: null },
    { actions: [null] },
    { actions: [{ side: "BUY", price: "10", quantity: "0" }] },
    { actions: [{ side: "BUY", price: "0", quantity: "1" }] },
    { actions: [{ side: "BUY", price: "10", quantity: "1" }], quoteCashFlow: "not-a-decimal" },
    { actions: [], activeBaseBalance: "-1" },
    { actions: [], committedQuoteBalance: "-1" },
    { actions: [], committedBaseBalance: "-1" },
  ]

  for (const invalidCase of invalidCases) {
    const result = allocateOrderCommitments({ ...common, actions: [], ...invalidCase })
    assert.equal(result.ok, false)
    assert.ok(result.errors.length > 0)
  }
})
