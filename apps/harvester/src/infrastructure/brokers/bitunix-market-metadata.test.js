import assert from "node:assert/strict"
import test from "node:test"

import {
  Market,
  Money,
  Quantity,
  TradingRules,
  TRADING_RULE_CONSTRAINT_TYPES,
  TRADING_RULE_STATUSES,
} from "@coinzilla/entities"

import { createBitunixMarketMetadata } from "./bitunix-market-metadata.js"

const symbolFilters = Object.freeze({
  symbol: "BTCUSDT",
  base: "BTC",
  quote: "USDT",
  isOpen: "1",
  minPrice: "0.01",
  minVolume: "0.001",
  basePrecision: "8",
  quotePrecision: "2",
  precisions: ["0.01", "0.001"],
  maxAmount: "500000",
  maxLimitOrderAmount: "1500000",
  maxMarketOrderAmount: "2000000",
})

function createMetadata({ overrides = {} } = {}) {
  return createBitunixMarketMetadata({
    symbolFilters: {
      ...symbolFilters,
      ...overrides,
    },
  })
}

function getConstraint({ tradingRules, type }) {
  const constraint = tradingRules.constraints.find(
    ({ type: constraintType }) => constraintType === type,
  )
  assert.ok(constraint, `Missing canonical constraint ${type}`)
  return constraint
}

test("maps Bitunix minimum volume and trading value into canonical constraints", () => {
  const metadata = createMetadata()

  assert.ok(metadata.market instanceof Market, "market must be a canonical Market")
  assert.ok(metadata.tradingRules instanceof TradingRules, "rules must be canonical TradingRules")
  assert.equal(metadata.market.venue, "bitunix", "market venue must identify Bitunix")
  assert.equal(metadata.market.symbol, "BTCUSDT", "market symbol must be normalized")
  assert.equal(metadata.market.baseAsset.code, "BTC", "base asset must come from pair metadata")
  assert.equal(metadata.market.quoteAsset.code, "USDT", "quote asset must come from pair metadata")

  const minQuantity = getConstraint({
    tradingRules: metadata.tradingRules,
    type: TRADING_RULE_CONSTRAINT_TYPES.MIN_QUANTITY,
  })
  assert.equal(minQuantity.status, TRADING_RULE_STATUSES.SUPPORTED, "minVolume must be supported")
  assert.ok(minQuantity.value instanceof Quantity, "minVolume must use base-asset Quantity")
  assert.equal(minQuantity.value.amount, "0.001", "minVolume must remain an exact decimal string")
  assert.equal(minQuantity.value.asset.code, "BTC", "minVolume must use the base asset")

  const minNotional = getConstraint({
    tradingRules: metadata.tradingRules,
    type: TRADING_RULE_CONSTRAINT_TYPES.MIN_NOTIONAL,
  })
  assert.equal(minNotional.status, TRADING_RULE_STATUSES.SUPPORTED, "minPrice must be supported")
  assert.ok(minNotional.value instanceof Money, "minPrice must use quote-asset Money")
  assert.equal(minNotional.value.amount, "0.01", "minPrice must remain an exact decimal string")
  assert.equal(minNotional.value.asset.code, "USDT", "minPrice must use the quote asset")
})

test("does not derive price or quantity increments from precision metadata", () => {
  const metadata = createMetadata()

  for (const type of [
    TRADING_RULE_CONSTRAINT_TYPES.PRICE_INCREMENT,
    TRADING_RULE_CONSTRAINT_TYPES.QUANTITY_INCREMENT,
  ]) {
    const constraint = getConstraint({
      tradingRules: metadata.tradingRules,
      type,
    })
    assert.equal(
      constraint.status,
      TRADING_RULE_STATUSES.UNKNOWN,
      `${type} must remain unknown until Bitunix documents its increment semantics`,
    )
  }
})

test("advertises only documented order types for an explicitly open market", () => {
  const metadata = createMetadata()

  assert.deepEqual(
    metadata.supportedOrderTypes,
    ["LIMIT", "MARKET"],
    "open Bitunix Spot markets support only the documented LIMIT and MARKET types",
  )
  assert.equal(
    metadata.supportedOrderTypes.includes("LIMIT_MAKER"),
    false,
    "Bitunix Spot metadata must not invent LIMIT_MAKER support",
  )
})

test("accepts the numeric open flag used by the reference model", () => {
  const metadata = createMetadata({
    overrides: {
      isOpen: 1,
    },
  })

  assert.deepEqual(metadata.supportedOrderTypes, ["LIMIT", "MARKET"])
})

test("does not advertise order types for closed or unknown markets", () => {
  const closed = createMetadata({
    overrides: {
      isOpen: "0",
    },
  })
  assert.deepEqual(closed.supportedOrderTypes, [], "closed markets must not advertise order types")

  const unknown = createMetadata({
    overrides: {
      isOpen: undefined,
    },
  })
  assert.deepEqual(unknown.supportedOrderTypes, [], "unknown market status must fail closed")
  assert.ok(
    unknown.unvalidatedConstraints.some(({ type }) => type === "MARKET_TRADING_STATUS"),
    "unknown market status must remain visible in diagnostics",
  )
})

test("keeps absent optional minimum constraints unknown", () => {
  const metadata = createMetadata({
    overrides: {
      minPrice: undefined,
      minVolume: undefined,
    },
  })

  assert.equal(
    getConstraint({
      tradingRules: metadata.tradingRules,
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_NOTIONAL,
    }).status,
    TRADING_RULE_STATUSES.UNKNOWN,
    "missing minPrice must not be guessed as zero or unsupported",
  )
  assert.equal(
    getConstraint({
      tradingRules: metadata.tradingRules,
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_QUANTITY,
    }).status,
    TRADING_RULE_STATUSES.UNKNOWN,
    "missing minVolume must not be guessed as zero or unsupported",
  )
})

test("preserves explicit zero minimum constraints without inventing a positive minimum", () => {
  const metadata = createMetadata({
    overrides: {
      minPrice: "0",
      minVolume: "0",
    },
  })

  assert.equal(
    getConstraint({
      tradingRules: metadata.tradingRules,
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_NOTIONAL,
    }).value.amount,
    "0",
    "explicit zero minPrice must remain zero",
  )
  assert.equal(
    getConstraint({
      tradingRules: metadata.tradingRules,
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_QUANTITY,
    }).value.amount,
    "0",
    "explicit zero minVolume must remain zero",
  )
})

test("rejects malformed or negative minimum trading constraints", () => {
  assert.throws(
    () => createMetadata({ overrides: { minPrice: "not-a-decimal" } }),
    /minPrice/i,
    "malformed minPrice must fail metadata conversion",
  )
  assert.throws(
    () => createMetadata({ overrides: { minVolume: "-0.1" } }),
    /non-negative/i,
    "negative minVolume must fail metadata conversion",
  )
})

test("rejects incomplete or inconsistent market identity", () => {
  assert.throws(
    () => createMetadata({ overrides: { symbol: "ETHUSDT" } }),
    /match base and quote/i,
    "symbol must match its base and quote assets",
  )
  assert.throws(
    () => createMetadata({ overrides: { base: "" } }),
    /base/i,
    "base asset must be present",
  )
})

test("keeps precision and undocumented maximum metadata explicitly unvalidated", () => {
  const metadata = createMetadata()
  const unvalidatedTypes = metadata.unvalidatedConstraints.map(({ type }) => type)

  assert.ok(
    unvalidatedTypes.includes("PAIR_PRECISION_METADATA"),
    "basePrecision, quotePrecision and precisions must remain diagnostic metadata",
  )
  assert.ok(
    unvalidatedTypes.includes("DEPTH_PRECISION"),
    "depth precision semantics must remain unresolved",
  )
  assert.ok(
    unvalidatedTypes.includes("UNDOCUMENTED_MAX_AMOUNT_METADATA"),
    "reference-only max amount fields must not be promoted into supported rules",
  )
  assert.equal(
    getConstraint({
      tradingRules: metadata.tradingRules,
      type: TRADING_RULE_CONSTRAINT_TYPES.MAX_QUANTITY,
    }).status,
    TRADING_RULE_STATUSES.UNKNOWN,
    "undocumented maximum fields must not become a supported maximum quantity",
  )
})
