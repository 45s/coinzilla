import assert from "node:assert/strict"
import test from "node:test"
import { allocateOrderCommitments } from "../domain/orders/allocate-order-commitments.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
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

function createAuthorizerState({ activeOrders } = {}) {
  const ownershipByClientOrderId = new Map(activeOrders.map((order) => [
    order.clientOrderId,
    { strategyId: order.strategyId ?? StrategyId.COIN_GRABBER },
  ]))
  return {
    registry: {
      getActiveOrders: () => activeOrders,
      getOwnership: ({ clientOrderId }) => ownershipByClientOrderId.get(clientOrderId),
    },
  }
}

function createDefaultAccountSnapshot({ quoteBalance, baseBalance } = {}) {
  return {
    balances: [],
    getFreeBalance: ({ assetId }) => ({
      amount: assetId === "USDT" ? quoteBalance : baseBalance,
    }),
    getPortfolioBaseQuantityBaseline: () => "0",
    getAdditionalTrackedBaseQuantityBaseline: () => "0",
    getQuoteCashFlowBaseline: () => "0",
    getCommittedQuoteBalanceBaseline: () => "0",
    getCommittedBaseBalanceBaseline: () => "0",
  }
}

function createAuthorizerStopWorkflow({ onLatch } = {}) {
  return {
    latch: async () => {
      onLatch()
      return {
        ok: true,
        data: { durable: true },
      }
    },
  }
}

function createAuthorizer({
  quoteBalance = "100",
  baseBalance = "0",
  accountSnapshot,
  activeOrders = [],
  actionOverride = action,
  snapshotOverride = snapshot,
  portfolioOverride,
} = {}) {
  let latchCount = 0
  const state = createAuthorizerState({ activeOrders })
  const portfolio = portfolioOverride ?? {
    positions: [],
    getPosition: () => undefined,
  }
  const currentSnapshot = accountSnapshot ?? createDefaultAccountSnapshot({
    quoteBalance,
    baseBalance,
  })
  const recoverySellerStopWorkflow = createAuthorizerStopWorkflow({
    onLatch: () => {
      latchCount += 1
    },
  })
  const authorize = createRecoverySellerActionAuthorizer({
    state,
    recoverySellerPairs: {
      [symbol]: { investment: 100 },
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
      action: actionOverride,
      snapshot: snapshotOverride,
      input,
    }),
    getLatchCount: () => latchCount,
  }
}


function makeActiveOrder({
  clientOrderId,
  symbol: orderSymbol = symbol,
  marketId = orderSymbol,
  baseAssetId = "ZRO",
  quoteAssetId = "USDT",
  side = "BUY",
  remainingQuantity = "9.1",
  limitPrice = "10",
} = {}) {
  return {
    clientOrderId,
    market: {
      id: marketId,
      symbol: orderSymbol,
      baseAsset: { id: baseAssetId },
      quoteAsset: { id: quoteAssetId },
    },
    side,
    remainingQuantity: { amount: remainingQuantity },
    limitPrice: { amount: limitPrice },
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


test("reserves same-market CG BUY commitments before authorizing an RS BUY", async () => {
  const conservativeOrder = makeActiveOrder({
    clientOrderId: "cg-same-market-buy",
    symbol,
    remainingQuantity: "9.1",
  })
  const runtime = createAuthorizer({
    activeOrders: [conservativeOrder],
  })
  const result = await runtime.authorize()

  assert.equal(result.ok, true, "A valid CG order must remain a normal account commitment during RS allocation.")
  assert.equal(result.data.skipped, true, "The RS BUY must defer when the same-market CG BUY leaves less than its required quote.")
  assert.equal(result.data.reason, "INSUFFICIENT_QUOTE_BALANCE", "The shared allocator must report the account-wide quote reservation as the deferral reason.")
  assert.equal(runtime.getLatchCount(), 0, "A valid same-market CG commitment must not be misclassified as an accounting STOP.")
})

test("reserves different-market CG BUY commitments sharing the same quote asset before authorizing an RS BUY", async () => {
  const conservativeOrder = makeActiveOrder({
    clientOrderId: "cg-doge-buy",
    symbol: "DOGEUSDT",
    marketId: "binance:DOGEUSDT",
    baseAssetId: "DOGE",
    quoteAssetId: "USDT",
    remainingQuantity: "9.1",
  })
  const runtime = createAuthorizer({
    activeOrders: [conservativeOrder],
  })
  const result = await runtime.authorize()

  assert.equal(result.ok, true, "A different-market CG order using the same USDT asset must remain a valid account commitment.")
  assert.equal(result.data.skipped, true, "The RS BUY must account for CG quote reservations across every market sharing USDT.")
  assert.equal(result.data.reason, "INSUFFICIENT_QUOTE_BALANCE", "The allocator must identify the shared quote-asset reservation as the deferral reason.")
  assert.equal(runtime.getLatchCount(), 0, "Cross-market quote contention is a normal deferral, not a global STOP.")
})

test("latches STOP rather than double-selling base reserved by a same-market CG order", async () => {
  const conservativeOrder = makeActiveOrder({
    clientOrderId: "cg-same-market-sell",
    symbol,
    side: "SELL",
    remainingQuantity: "0.6",
    limitPrice: "20",
  })
  const recoveryPortfolio = {
    positions: [{
      market: input.marketMetadata.market,
      totalBaseQuantity: { amount: "1" },
      quoteNetCashFlow: { amount: "0" },
    }],
    getPosition: () => ({
      baseQuantity: { amount: "1" },
      spent: { amount: "10" },
    }),
  }
  const runtime = createAuthorizer({
    baseBalance: "0",
    activeOrders: [conservativeOrder],
    actionOverride: {
      side: "SELL",
      quantity: "0.5",
      positionId: "rs-position-1",
    },
    snapshotOverride: {
      planInput: {
        recoveryQuantity: "1",
        verifiedUnreservedLegacyQuantity: "0",
        recoveryCostBasis: "10",
      },
      cumulativeNetSellProceeds: "0",
    },
    portfolioOverride: recoveryPortfolio,
  })
  const result = await runtime.authorize()

  assert.equal(result.ok, false, "An RS SELL that overlaps a CG-reserved base quantity must fail closed.")
  assert.equal(runtime.getLatchCount(), 1, "An attempted cross-strategy double-sell must latch durable account-wide STOP.")
})
