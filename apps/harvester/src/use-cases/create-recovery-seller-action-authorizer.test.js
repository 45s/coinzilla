import assert from "node:assert/strict"
import test from "node:test"
import { allocateOrderCommitments } from "../domain/orders/allocate-order-commitments.js"
import { createRecoverySellerActionAuthorizer } from "./create-recovery-seller-action-authorizer.js"

const symbol = "ZROUSDT"
const action = Object.freeze({
  side: "BUY",
  quantity: "1",
  price: "10",
  positionId: "rs-position-1",
})
const snapshot = Object.freeze({
  planInput: Object.freeze({
    recoveryQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    recoveryCostBasis: "0",
  }),
  cumulativeNetSellProceeds: "0",
})
const input = Object.freeze({
  symbol,
  marketMetadata: Object.freeze({
    market: Object.freeze({
      id: symbol,
      baseAsset: Object.freeze({ id: "ZRO" }),
      quoteAsset: Object.freeze({ id: "USDT" }),
    }),
  }),
})

function createAuthorizer({ quoteBalance = "100", accountSnapshot } = {}) {
  let latchCount = 0
  const state = {
    registry: {
      getActiveOrders: () => [],
      getOwnership: () => undefined,
    },
  }
  const portfolio = {
    positions: [],
    getPosition: () => undefined,
  }
  const currentSnapshot = accountSnapshot === undefined ? {
    balances: [],
    getFreeBalance: ({ assetId }) => ({
      amount: assetId === "USDT" ? quoteBalance : "0",
    }),
    getPortfolioBaseQuantityBaseline: () => "0",
    getAdditionalTrackedBaseQuantityBaseline: () => "0",
    getQuoteCashFlowBaseline: () => "0",
    getCommittedQuoteBalanceBaseline: () => "0",
    getCommittedBaseBalanceBaseline: () => "0",
  } : accountSnapshot
  const recoverySellerStopWorkflow = {
    latch: async () => {
      latchCount += 1
      return {
        ok: true,
        data: { durable: true },
      }
    },
  }
  const authorize = createRecoverySellerActionAuthorizer({
    state,
    recoverySellerPairs: {
      [symbol]: {
        investment: 100,
      },
    },
    recoverySellerStopWorkflow,
    getPortfolio: () => portfolio,
    getAccountSnapshot: () => currentSnapshot,
    getAdditionalTrackedBaseQuantity: () => [],
    getAdditionalTrackedQuoteCashFlow: () => [],
    allocateOrderCommitments,
  })
  return {
    authorize: () => authorize({
      action,
      snapshot,
      input,
    }),
    getLatchCount: () => latchCount,
  }
}

test("authorizes an RS BUY only after account-wide quote and pair commitments are allocated", async () => {
  const runtime = createAuthorizer()
  const result = await runtime.authorize()

  assert.equal(result.ok, true, "A fully funded RS action must receive an allocation authorization.")
  assert.equal(result.data.allowed, true, "The action must be executable after exact account allocation.")
  assert.equal(runtime.getLatchCount(), 0, "A valid allocation must not latch STOP.")
})

test("defers an RS BUY when the shared account has insufficient quote without latching STOP", async () => {
  const runtime = createAuthorizer({ quoteBalance: "0" })
  const result = await runtime.authorize()

  assert.equal(result.ok, true, "Insufficient quote is a normal deferred allocation, not an accounting error.")
  assert.equal(result.data.skipped, true, "The action must be withheld when account quote is unavailable.")
  assert.equal(result.data.reason, "INSUFFICIENT_QUOTE_BALANCE", "The allocator's precise deferral reason must be retained.")
  assert.equal(runtime.getLatchCount(), 0, "A normal budget deferral must not latch STOP.")
})

test("latches durable STOP when the account snapshot is missing", async () => {
  const runtime = createAuthorizer({ accountSnapshot: null })
  const result = await runtime.authorize()

  assert.equal(result.ok, false, "A missing account snapshot must fail the allocation request.")
  assert.equal(runtime.getLatchCount(), 1, "A missing account snapshot must latch durable STOP.")
})
