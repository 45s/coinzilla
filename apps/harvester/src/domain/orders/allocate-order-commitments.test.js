import test from "node:test"
import assert from "node:assert/strict"
import { addDecimal } from "@coinzilla/utils"
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
    portfolioBaseBalance: "0",
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
    portfolioBaseBalance: "1",
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
    portfolioBaseBalance: "1",
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
    portfolioBaseBalance: "0",
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
    portfolioBaseBalance: "1",
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
    portfolioBaseBalance: "0",
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
    portfolioBaseBalance: "2",
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
    portfolioBaseBalance: "0",
    portfolioBaseBalanceBaseline: "0",
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
    portfolioBaseBalance: "0",
    portfolioBaseBalanceBaseline: "0",
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

test("releases a pre-snapshot BUY lock when the order is no longer active", () => {
  const commitmentAtSnapshot = "100"
  const result = allocateOrderCommitments({
    actions: [{ side: "BUY", price: "950", quantity: "1" }],
    quoteFreeBalance: "900",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    portfolioBaseBalance: "0",
    portfolioBaseBalanceBaseline: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: commitmentAtSnapshot,
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "A BUY reservation canceled after the snapshot must release the 100 quote units that were locked when the snapshot was captured.")
  assert.deepEqual(result.data.executableActions, [{ side: "BUY", price: "950", quantity: "1" }], "The released pre-snapshot reservation must restore 1,000 quote units for the new BUY allocation.")
  assert.equal(result.data.remainingQuoteBalance, "50", "The 950-unit replacement BUY must leave exactly 50 quote units after the old 100-unit lock is released.")
})

test("subtracts only a new BUY commitment created after the account snapshot", () => {
  const commitmentAtSnapshot = "100"
  const currentBuyCommitment = "150"
  const result = allocateOrderCommitments({
    actions: [{ side: "BUY", price: "850", quantity: "1" }],
    quoteFreeBalance: "900",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    portfolioBaseBalance: "0",
    portfolioBaseBalanceBaseline: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: currentBuyCommitment,
    committedQuoteBalanceBaseline: commitmentAtSnapshot,
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "A new 50-unit BUY reservation after the snapshot must reduce free quote by only 50, not by the full 150-unit current commitment.")
  assert.deepEqual(result.data.executableActions, [{ side: "BUY", price: "850", quantity: "1" }], "The new BUY must be accepted at exact equality with the 850 quote units remaining after the post-snapshot reservation.")
  assert.equal(result.data.remainingQuoteBalance, "0", "The exact 850-unit BUY must consume the remaining free quote budget after reserving only the 50-unit post-snapshot commitment delta.")
})

test("does not count Portfolio base inventory twice when the exchange snapshot already reflects it", () => {
  const trackedActiveBaseAtSnapshot = "10"
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "1" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "10",
    portfolioBaseBalance: trackedActiveBaseAtSnapshot,
    portfolioBaseBalanceBaseline: trackedActiveBaseAtSnapshot,
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

test("does not subtract a SELL lock already reflected in the account snapshot", () => {
  const sellCommitmentAtSnapshot = "100"
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "1" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "900",
    quoteCashFlow: "0",
    activeBaseQuantity: "100",
    portfolioBaseBalance: "100",
    portfolioBaseBalanceBaseline: "100",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: "0",
    committedBase: "0",
    committedBaseBalance: sellCommitmentAtSnapshot,
    committedBaseBalanceBaseline: sellCommitmentAtSnapshot,
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "A SELL commitment already represented by exchange locked base must not reduce free base a second time.")
  assert.deepEqual(result.data.executableActions, [{ side: "SELL", quantity: "1" }], "The account-wide free-base balance must remain at the exchange-reported 900 units after applying a zero commitment delta.")
  assert.equal(result.data.remainingBaseBalance, "899", "The new one-unit SELL must leave exactly 899 account-free base units.")
})

test("subtracts only a new SELL lock created after the account snapshot", () => {
  const currentSellCommitment = "100"
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "1" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "1000",
    quoteCashFlow: "0",
    activeBaseQuantity: "200",
    portfolioBaseBalance: "200",
    portfolioBaseBalanceBaseline: "200",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: "0",
    committedBase: "0",
    committedBaseBalance: currentSellCommitment,
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "A new 100-unit SELL lock after the snapshot must reduce exchange free base by exactly 100 units.")
  assert.equal(result.data.remainingBaseBalance, "899", "After the new one-unit SELL action, 899 base units must remain from 1,000 free less the 100-unit post-snapshot lock.")
})

test("offsets a partial SELL fill against the released SELL commitment", () => {
  const commitmentAtSnapshot = "100"
  const currentCommitment = "60"
  const activePositionAtSnapshot = "100"
  const currentActivePosition = "60"
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "1" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "900",
    quoteCashFlow: "40",
    activeBaseQuantity: "60",
    portfolioBaseBalance: currentActivePosition,
    portfolioBaseBalanceBaseline: activePositionAtSnapshot,
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: "0",
    committedBase: "0",
    committedBaseBalance: currentCommitment,
    committedBaseBalanceBaseline: commitmentAtSnapshot,
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "A 40-unit SELL fill must reduce Portfolio inventory and its outstanding lock by the same amount without changing exchange free base.")
  assert.equal(result.data.remainingBaseBalance, "899", "After one additional SELL action, account-free base must be 899 because the partial fill and released lock offset exactly.")
})

test("retained free allocation does not reduce account-wide free-base availability", () => {
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "5" }],
    quoteFreeBalance: "1000",
    baseFreeBalance: "10",
    quoteCashFlow: "0",
    activeBaseQuantity: "90",
    portfolioBaseBalance: "100",
    portfolioBaseBalanceBaseline: "100",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: "0",
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "1000",
  })

  assert.equal(result.ok, true, "Moving ten base units from active inventory to retained keepQuantity must not change the account-wide free balance already reported by the exchange.")
  assert.deepEqual(result.data.executableActions, [{ side: "SELL", quantity: "5" }], "The account still has ten free base units and the strategy still has ninety active units, so a five-unit SELL must be admissible.")
  assert.equal(result.data.remainingBaseBalance, "5", "After a five-unit SELL, exactly five account-free base units must remain.")
})


test("rejects pair active inventory greater than total Portfolio base inventory", () => {
  const result = allocateOrderCommitments({
    actions: [],
    quoteFreeBalance: "100",
    baseFreeBalance: "100",
    quoteCashFlow: "0",
    activeBaseQuantity: "2",
    portfolioBaseBalance: "1",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: "0",
    investmentLimit: "100",
  })

  assert.equal(result.ok, false, "Pair active inventory cannot exceed the account-wide total Portfolio inventory that includes this Position.")
  assert.match(result.errors[0].message, /activeBaseQuantity cannot exceed portfolioBaseBalance/, "The allocator must identify the impossible active-versus-total inventory relationship.")
})

test("rejects existing pair SELL commitments greater than active sellable inventory", () => {
  const result = allocateOrderCommitments({
    actions: [],
    quoteFreeBalance: "100",
    baseFreeBalance: "100",
    quoteCashFlow: "0",
    activeBaseQuantity: "1",
    portfolioBaseBalance: "2",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: "1.1",
    committedBaseBalance: "1.1",
    investmentLimit: "100",
  })

  assert.equal(result.ok, false, "Existing pair SELL reservations must be fully backed by active strategy inventory before any new allocation is considered.")
  assert.match(result.errors[0].message, /committedBase cannot exceed activeBaseQuantity/, "The allocator must identify an existing SELL overcommitment against pair-owned active inventory.")
})

test("rejects pair BUY commitments greater than the account-wide shared-quote commitments", () => {
  const result = allocateOrderCommitments({
    actions: [],
    quoteFreeBalance: "100",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    portfolioBaseBalance: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "101",
    committedQuoteBalance: "100",
    committedBase: "0",
    committedBaseBalance: "0",
    investmentLimit: "100",
  })

  assert.equal(result.ok, false, "The account-wide shared-quote commitment total must include every pair's current BUY commitments, including this pair.")
  assert.match(result.errors[0].message, /committedQuote cannot exceed committedQuoteBalance/, "The allocator must identify a pair BUY commitment that is absent from its account-wide aggregate.")
})

test("rejects pair SELL commitments greater than the account-wide shared-base commitments", () => {
  const result = allocateOrderCommitments({
    actions: [],
    quoteFreeBalance: "100",
    baseFreeBalance: "100",
    quoteCashFlow: "0",
    activeBaseQuantity: "5",
    portfolioBaseBalance: "10",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedBase: "4",
    committedBaseBalance: "3",
    investmentLimit: "100",
  })

  assert.equal(result.ok, false, "The account-wide shared-base commitment total must include every pair's current SELL commitments, including this pair.")
  assert.match(result.errors[0].message, /committedBase cannot exceed committedBaseBalance/, "The allocator must identify a pair SELL commitment that is absent from its account-wide aggregate.")
})

test("rejects aggregate SELL commitments greater than total Portfolio base inventory", () => {
  const result = allocateOrderCommitments({
    actions: [],
    quoteFreeBalance: "100",
    baseFreeBalance: "100",
    quoteCashFlow: "0",
    activeBaseQuantity: "1",
    portfolioBaseBalance: "2",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedBase: "0.5",
    committedBaseBalance: "2.1",
    investmentLimit: "100",
  })

  assert.equal(result.ok, false, "All Harvester-owned SELL commitments against a shared base asset must be backed by total Portfolio holdings across markets.")
  assert.match(result.errors[0].message, /committedBaseBalance cannot exceed portfolioBaseBalance/, "The allocator must identify account-wide SELL reservations that exceed tracked total base inventory.")
})


test("credits only net base from a partial BUY fill received after the account snapshot", () => {
  // A 0.4 base BUY fill less a 0.004 base commission leaves 0.396 tracked base.
  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "0.396" }],
    quoteFreeBalance: "100",
    baseFreeBalance: "0",
    quoteCashFlow: "-40",
    activeBaseQuantity: "0.396",
    portfolioBaseBalance: "0.396",
    portfolioBaseBalanceBaseline: "0",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedQuoteBalance: "0",
    committedQuoteBalanceBaseline: "0",
    committedBase: "0",
    committedBaseBalance: "0",
    committedBaseBalanceBaseline: "0",
    investmentLimit: "100",
  })

  assert.equal(result.ok, true, "The net base quantity added by a post-snapshot partial BUY fill must become available to the same pair's recovery SELL.")
  assert.deepEqual(result.data.executableActions, [{ side: "SELL", quantity: "0.396" }], "The recovery SELL may use exactly the 0.396 base units remaining after the 0.004 base commission.")
  assert.equal(result.data.remainingBaseBalance, "0", "The post-snapshot base credit must be applied exactly once and fully consumed by the SELL.")
  assert.equal(result.data.remainingActiveBase, "0", "The pair active inventory cap must reach zero after selling the complete net fill quantity.")
  assert.equal(result.data.remainingQuoteBalance, "60", "The 40-unit BUY quote cash flow must be applied once to the 100-unit snapshot free quote balance.")
})

test("returns structured failures for invalid action sides and negative balance inputs", () => {
  const common = {
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    portfolioBaseBalance: "0",
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

  assert.equal(invalidSide.ok, false, "An unsupported strategy side must be rejected before any allocation is produced.")
  assert.match(invalidSide.errors[0].message, /side must be BUY or SELL/, "The invalid-side failure must identify the supported action contract.")
  assert.equal(negativeBalance.ok, false, "Negative exchange free balances must fail closed.")
  assert.match(negativeBalance.errors[0].message, /must be non-negative/, "The negative-balance failure must identify the violated non-negative balance invariant.")
})

test("rejects malformed commitment inputs without throwing", () => {
  const common = {
    quoteFreeBalance: "1000",
    baseFreeBalance: "0",
    quoteCashFlow: "0",
    activeBaseQuantity: "0",
    portfolioBaseBalance: "0",
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
    { actions: [], portfolioBaseBalance: "-1" },
    { actions: [], portfolioBaseBalance: undefined },
    { actions: [], committedQuoteBalance: "-1" },
    { actions: [], committedBaseBalance: "-1" },
  ]

  for (const invalidCase of invalidCases) {
    const result = allocateOrderCommitments({ ...common, actions: [], ...invalidCase })
    assert.equal(result.ok, false, "Malformed or incomplete allocation inputs must return a structured failure.")
    assert.ok(result.errors.length > 0, "Every rejected allocation input must include a diagnostic error.")
  }
})


test("rejects a SELL that exceeds shared inventory after combined CG and RS reservations", () => {
  const coinGrabberReservedBase = "4"
  const recoverySellerReservedBase = "5"
  const sharedReservedBase = "9"
  assert.equal(
    addDecimal({ left: coinGrabberReservedBase, right: recoverySellerReservedBase }),
    sharedReservedBase,
    "The account-level commitment must be the sum of both strategy-owned SELL reservations.",
  )

  const result = allocateOrderCommitments({
    actions: [{ side: "SELL", quantity: "2" }],
    quoteFreeBalance: "100",
    baseFreeBalance: "10",
    quoteCashFlow: "0",
    activeBaseQuantity: "10",
    portfolioBaseBalance: "10",
    outstandingRecoveryAmount: "0",
    committedQuote: "0",
    committedBase: sharedReservedBase,
    committedBaseBalance: sharedReservedBase,
    investmentLimit: "1000",
  })

  assert.equal(result.ok, false, "The shared order allocator must reject a new SELL that would overcommit inventory reserved by CG and RS together.")
  assert.match(result.errors[0].message, /active inventory after commitments/, "The rejection must be caused by combined CG/RS reservations against shared active inventory.")
})
