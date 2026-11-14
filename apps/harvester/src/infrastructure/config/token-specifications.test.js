import test from "node:test"
import assert from "node:assert/strict"
import {
  createMarketSpecification,
  mergeTokenSpecifications,
  resolvePairSpecifications,
} from "./token-specifications.js"

const metadata = (overrides = {}) => ({
  symbol: "LINKUSDT",
  baseAsset: "LINK",
  quoteAsset: "USDT",
  tickSize: "0.00100000",
  stepSize: "0.01000000",
  ...overrides,
})

test("derives market precision from the actual exchange increments", () => {
  const specification = createMarketSpecification({ metadata: metadata() })
  assert.deepEqual(specification, {
    baseAsset: "LINK",
    market: {
      quoteAsset: "USDT",
      pricePrecision: 3,
      quantityPrecision: 2,
    },
  }, "The market metadata must derive precision from PRICE_FILTER.tickSize and LOT_SIZE.stepSize.")
})

test("groups quote markets under one base-token entry without sharing pair-specific precision", () => {
  const first = mergeTokenSpecifications({
    tokenSpecifications: {},
    metadata: metadata(),
  })
  const combined = mergeTokenSpecifications({
    tokenSpecifications: first,
    metadata: metadata({
      symbol: "LINKFDUSD",
      quoteAsset: "FDUSD",
      tickSize: "0.01",
      stepSize: "0.001",
    }),
  })

  assert.deepEqual(Object.keys(combined), ["LINK"], "Multiple quote markets for one base asset must share one top-level token entry.")
  assert.deepEqual(combined.LINK.markets.LINKUSDT, {
    quoteAsset: "USDT",
    pricePrecision: 3,
    quantityPrecision: 2,
  }, "The first market's precision must remain unchanged.")
  assert.deepEqual(combined.LINK.markets.LINKFDUSD, {
    quoteAsset: "FDUSD",
    pricePrecision: 2,
    quantityPrecision: 3,
  }, "Each quote market must retain its own exchange-derived precision.")
})

test("updates an existing market specification without changing other tokens or markets", () => {
  const existing = {
    LINK: {
      baseAsset: "LINK",
      markets: {
        LINKUSDT: { quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 },
        LINKFDUSD: { quoteAsset: "FDUSD", pricePrecision: 3, quantityPrecision: 2 },
      },
    },
    POL: {
      baseAsset: "POL",
      markets: {
        POLUSDT: { quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1 },
      },
    },
  }
  const updated = mergeTokenSpecifications({
    tokenSpecifications: existing,
    metadata: metadata({ symbol: "LINKUSDT", tickSize: "0.0001" }),
  })

  assert.equal(updated.LINK.markets.LINKUSDT.pricePrecision, 4, "Refreshing a market must update its exchange-derived precision.")
  assert.deepEqual(updated.LINK.markets.LINKFDUSD, existing.LINK.markets.LINKFDUSD, "Refreshing one market must preserve sibling quote markets.")
  assert.deepEqual(updated.POL, existing.POL, "Refreshing one token must preserve every other token.")
  assert.equal(existing.LINK.markets.LINKUSDT.pricePrecision, 3, "Merging metadata must not mutate the caller's registry.")
})

test("resolves configured pairs from exact registry market keys", () => {
  const pairs = {
    LINKUSDT: { enabled: true, investment: 100 },
    LINKFDUSD: { enabled: false, investment: 200 },
  }
  const tokenSpecifications = mergeTokenSpecifications({
    tokenSpecifications: mergeTokenSpecifications({
      tokenSpecifications: {},
      metadata: metadata(),
    }),
    metadata: metadata({ symbol: "LINKFDUSD", quoteAsset: "FDUSD", tickSize: "0.01", stepSize: "0.001" }),
  })
  const resolved = resolvePairSpecifications({ pairs, tokenSpecifications })

  assert.deepEqual(resolved.LINKUSDT, {
    enabled: true,
    investment: 100,
    pricePrecision: 3,
    quantityPrecision: 2,
  }, "Runtime config must receive the exact precision belonging to LINKUSDT.")
  assert.deepEqual(resolved.LINKFDUSD, {
    enabled: false,
    investment: 200,
    pricePrecision: 2,
    quantityPrecision: 3,
  }, "Runtime config must receive the exact precision belonging to LINKFDUSD.")
  assert.equal(Object.hasOwn(pairs.LINKUSDT, "pricePrecision"), false, "Resolution must not mutate the operator-owned pair config.")
})

test("fails closed for missing markets, malformed token metadata, and duplicate market ownership", () => {
  assert.throws(
    () => resolvePairSpecifications({ pairs: { POLUSDT: {} }, tokenSpecifications: {} }),
    /missing token specification.*POLUSDT/i,
    "A configured market without metadata must block configuration loading.",
  )
  assert.throws(
    () => resolvePairSpecifications({
      pairs: { LINKUSDT: {} },
      tokenSpecifications: { LINK: { baseAsset: "POL", markets: {} } },
    }),
    /baseAsset/i,
    "A token registry key must match its declared base asset.",
  )
  assert.throws(
    () => resolvePairSpecifications({
      pairs: { LINKUSDT: {} },
      tokenSpecifications: {
        LINK: { baseAsset: "LINK", markets: { LINKUSDT: { quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 } } },
        LINK2: { baseAsset: "LINK2", markets: { LINKUSDT: { quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 } } },
      },
    }),
    /multiple token entries/i,
    "One market symbol must not be claimed by multiple base-token entries.",
  )
})

test("rejects manually configured precision values instead of allowing stale duplicates", () => {
  const tokenSpecifications = mergeTokenSpecifications({ tokenSpecifications: {}, metadata: metadata() })
  assert.throws(
    () => resolvePairSpecifications({
      pairs: { LINKUSDT: { pricePrecision: 5 } },
      tokenSpecifications,
    }),
    /must not define pricePrecision or quantityPrecision/i,
    "Precision must have one authoritative source: the token specification registry.",
  )
})
