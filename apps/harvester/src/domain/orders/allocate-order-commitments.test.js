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
    baseFreeBalance: "0",
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
