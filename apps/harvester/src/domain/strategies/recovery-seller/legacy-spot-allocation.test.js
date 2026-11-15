import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { StrategyId } from "../strategy-ids.js"
import {
  calculateVerifiedLegacySpotAllocation,
  LegacySpotAllocationError,
  LEGACY_SPOT_ALLOCATION_ERROR_CODES,
} from "./legacy-spot-allocation.js"

const btcAsset = new Asset({
  id: "asset:BTC",
  code: "BTC",
})
const usdtAsset = new Asset({
  id: "asset:USDT",
  code: "USDT",
})
const fdusdAsset = new Asset({
  id: "asset:FDUSD",
  code: "FDUSD",
})
const btcUsdtMarket = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: btcAsset,
  quoteAsset: usdtAsset,
})
const btcFdusdMarket = new Market({
  venue: "binance",
  symbol: "BTCFDUSD",
  baseAsset: btcAsset,
  quoteAsset: fdusdAsset,
})

function createBalance({ asset, free, locked = "0" }) {
  return new Balance({
    free: new Quantity({
      amount: free,
      asset,
    }),
    locked: new Quantity({
      amount: locked,
      asset,
    }),
  })
}

function createBuyFill({ market, tradeId, quantity, quoteQuantity }) {
  return new Fill({
    tradeId,
    brokerOrderId: `broker-${tradeId}`,
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createPortfolio({ acquisitions = [] } = {}) {
  let portfolio = new Portfolio()
  for (const acquisition of acquisitions) {
    const { portfolio: nextPortfolio } = portfolio.applyFill({
      fill: acquisition.fill,
      positionId: acquisition.positionId,
      strategyId: acquisition.strategyId,
    })
    portfolio = nextPortfolio
  }
  return portfolio
}

test("tracks only Spot base quantity left after every Portfolio Position for the asset", () => {
  const portfolio = createPortfolio({
    acquisitions: [
      {
        fill: createBuyFill({
          market: btcUsdtMarket,
          tradeId: "cg-btc-usdt",
          quantity: "2",
          quoteQuantity: "200",
        }),
        positionId: "position:cg:btcusdt",
        strategyId: StrategyId.COIN_GRABBER,
      },
      {
        fill: createBuyFill({
          market: btcFdusdMarket,
          tradeId: "rs-btc-fdusd",
          quantity: "3",
          quoteQuantity: "300",
        }),
        positionId: "position:rs:btcfdusd",
        strategyId: StrategyId.RECOVERY_SELLER,
      },
    ],
  })

  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [
      createBalance({
        asset: btcAsset,
        free: "5",
        locked: "0.5",
      }),
    ],
    portfolio,
    legacyPositions: [
      {
        market: btcUsdtMarket,
        originalQuantity: "40",
        remainingQuantity: "40",
      },
      {
        market: btcFdusdMarket,
        originalQuantity: "10",
        remainingQuantity: "10",
      },
    ],
  })

  assert.deepEqual(
    allocations,
    [{
      assetId: btcAsset.id,
      amount: "0.5",
    }],
    "The allocation must subtract all five Portfolio BTC across both markets and strategies from the 5.5 BTC Spot total, then cap the remaining 0.5 BTC by authorized legacy quantity.",
  )
})

test("returns immutable allocation arrays and records", () => {
  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [
      createBalance({
        asset: btcAsset,
        free: "0.5",
      }),
    ],
    portfolio: new Portfolio(),
    legacyPositions: [{
      market: btcUsdtMarket,
      originalQuantity: "1",
      remainingQuantity: "0.5",
    }],
  })

  assert.equal(
    Object.isFrozen(allocations),
    true,
    "The account snapshot source must not expose a mutable allocation collection.",
  )
  assert.equal(
    Object.isFrozen(allocations[0]),
    true,
    "Each verified asset allocation must be immutable after it is calculated.",
  )
  assert.throws(
    () => {
      allocations[0].amount = "99"
    },
    TypeError,
    "A caller must not be able to mutate verified legacy Spot custody after the calculation.",
  )
})

test("caps verified Spot allocation at the remaining authorized legacy quantity", () => {
  const portfolio = createPortfolio({
    acquisitions: [{
      fill: createBuyFill({
        market: btcUsdtMarket,
        tradeId: "portfolio-btc",
        quantity: "2",
        quoteQuantity: "200",
      }),
      positionId: "position:cg:btc",
      strategyId: StrategyId.COIN_GRABBER,
    }],
  })

  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [
      createBalance({
        asset: btcAsset,
        free: "10",
      }),
    ],
    portfolio,
    legacyPositions: [{
      market: btcUsdtMarket,
      originalQuantity: "0.25",
      remainingQuantity: "0.25",
    }],
  })

  assert.deepEqual(
    allocations,
    [{
      assetId: btcAsset.id,
      amount: "0.25",
    }],
    "An account may hold more untracked Spot BTC than the operator authorized; only the 0.25 remaining legacy BTC may be tracked for RS.",
  )
})

test("aggregates authorized legacy quantities sharing one base asset without double-counting Spot custody", () => {
  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [
      createBalance({
        asset: btcAsset,
        free: "0.3",
        locked: "0.2",
      }),
    ],
    portfolio: new Portfolio(),
    legacyPositions: [
      {
        market: btcUsdtMarket,
        originalQuantity: "0.3",
        remainingQuantity: "0.3",
      },
      {
        market: btcFdusdMarket,
        originalQuantity: "0.4",
        remainingQuantity: "0.4",
      },
    ],
  })

  assert.deepEqual(
    allocations,
    [{
      assetId: btcAsset.id,
      amount: "0.5",
    }],
    "Two authorized legacy positions sharing BTC must aggregate against the same 0.5 BTC account custody instead of each claiming it independently.",
  )
})

test("fails closed when the authoritative account snapshot omits an authorized legacy base asset", () => {
  assert.throws(
    () => calculateVerifiedLegacySpotAllocation({
      balances: [
        createBalance({
          asset: usdtAsset,
          free: "1000",
        }),
      ],
      portfolio: new Portfolio(),
      legacyPositions: [{
        market: btcUsdtMarket,
        originalQuantity: "0.01",
        remainingQuantity: "0.01",
      }],
    }),
    (error) => error instanceof LegacySpotAllocationError &&
      error.code === LEGACY_SPOT_ALLOCATION_ERROR_CODES.BALANCE_MISSING &&
      error.context.assetId === btcAsset.id,
    "A missing authoritative BTC balance must never be interpreted as proof of legacy Spot custody.",
  )
})

test("fails closed when account Spot custody cannot cover aggregate Portfolio base quantity", () => {
  const portfolio = createPortfolio({
    acquisitions: [{
      fill: createBuyFill({
        market: btcUsdtMarket,
        tradeId: "portfolio-custody-shortfall",
        quantity: "5",
        quoteQuantity: "500",
      }),
      positionId: "position:cg:btc-shortfall",
      strategyId: StrategyId.COIN_GRABBER,
    }],
  })

  assert.throws(
    () => calculateVerifiedLegacySpotAllocation({
      balances: [
        createBalance({
          asset: btcAsset,
          free: "4.99",
        }),
      ],
      portfolio,
      legacyPositions: [{
        market: btcUsdtMarket,
        originalQuantity: "0.01",
        remainingQuantity: "0.01",
      }],
    }),
    (error) => error instanceof LegacySpotAllocationError &&
      error.code === LEGACY_SPOT_ALLOCATION_ERROR_CODES.PORTFOLIO_CUSTODY_SHORTFALL &&
      error.context.portfolioBaseQuantity === "5" &&
      error.context.accountTotalQuantity === "4.99",
    "The legacy source must not allocate any quantity while authoritative Spot custody is already short of the shared Portfolio's five BTC.",
  )
})


test("rejects remaining legacy quantity above the original operator authorization", () => {
  assert.throws(
    () => calculateVerifiedLegacySpotAllocation({
      balances: [
        createBalance({
          asset: btcAsset,
          free: "10",
        }),
      ],
      portfolio: new Portfolio(),
      legacyPositions: [{
        market: btcUsdtMarket,
        originalQuantity: "1",
        remainingQuantity: "1.01",
      }],
    }),
    RangeError,
    "A stale or corrupted remaining quantity must never increase the operator's original legacy authorization.",
  )
})

test("does not infer a legacy allocation from wallet balances without an authorized remaining position", () => {
  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [
      createBalance({
        asset: btcAsset,
        free: "50",
      }),
    ],
    portfolio: new Portfolio(),
    legacyPositions: [],
  })

  assert.deepEqual(
    allocations,
    [],
    "A wallet balance alone must never create RS legacy authorization or tracked Spot inventory.",
  )
})

test("does not require a Spot balance after the authorized legacy quantity reaches zero", () => {
  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [],
    portfolio: new Portfolio(),
    legacyPositions: [{
      market: btcUsdtMarket,
      originalQuantity: "50",
      remainingQuantity: "0",
    }],
  })

  assert.deepEqual(
    allocations,
    [],
    "An exhausted legacy position contributes no additional tracked Spot quantity and must not make unrelated account snapshots fail.",
  )
})
