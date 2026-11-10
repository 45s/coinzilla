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

test("does not subtract a BUY commitment already reflected in the exchange free-balance snapshot", () => {
  const alreadyLockedBuyCommitment = "100"
  const snapshotFreeQuoteBalance = "900"
  const result = allocateOrderCommitments({
    actions: [{ side: "BUY", price: "50", quantity: "1" }],
    quoteFreeBalance: snapshotFreeQuoteBalance,
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    activeBaseBalance: "0",
    activeBaseBalanceBaseline: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: alreadyLockedBuyCommitment,
    committedQuoteBalanceBaseline: alreadyLockedBuyCommitment,
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "An existing BUY reservation already represented by exchange locked balance must not make an otherwise fundable BUY fail allocation.")
  assert.deepEqual(result.data.executableActions, [{ side: "BUY", price: "50", quantity: "1" }], "The new BUY must be allocated from the actual 900 free quote units without subtracting the pre-snapshot 100-unit lock twice.")
  assert.equal(result.data.remainingQuoteBalance, "850", "After reserving the new 50-unit BUY, 850 quote units must remain; the existing 100-unit lock is already excluded from snapshot free balance.")
})

test("reserves only the post-snapshot change in a partially filled BUY commitment", () => {
  const commitmentAtSnapshot = "100"
  const remainingCommitmentAfterPartialFill = "60"
  const quoteSpentByPartialFill = "-40"
  const result = allocateOrderCommitments({
    actions: [{ side: "BUY", price: "10", quantity: "1" }],
    quoteFreeBalance: "900",
    baseFreeBalance: "0",
    quoteCashFlow: quoteSpentByPartialFill,
    activeBaseQuantity: "0",
    activeBaseBalance: "0",
    activeBaseBalanceBaseline: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: remainingCommitmentAfterPartialFill,
    committedQuoteBalanceBaseline: commitmentAtSnapshot,
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "A partial fill already represented by quote cash flow and the reduced locked commitment must not be charged again.")
  assert.deepEqual(result.data.executableActions, [{ side: "BUY", price: "10", quantity: "1" }], "The remaining account quote availability must include the offset between the 40-unit fill and 40-unit commitment reduction.")
  assert.equal(result.data.remainingQuoteBalance, "890", "After the new 10-unit BUY, quote availability must be 890 because the partial fill's cash-flow debit and released reservation offset exactly.")
})

test("does not count Portfolio base inventory twice when the exchange snapshot already reflects it", () => {
  const trackedActiveBaseAtSnapshot = "10"
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "1" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "10",
    activeBaseBalance: trackedActiveBaseAtSnapshot,
    activeBaseBalanceBaseline: trackedActiveBaseAtSnapshot,
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: "0",
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, false, "A zero exchange-free base balance must not be overridden by adding tracked Portfolio inventory that was already reflected in the account snapshot.")
  assert.match(result.errors[0].message, /available free base balance/, "The SELL must fail specifically at the account-wide free-base guard when the wallet has no free base.")
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
