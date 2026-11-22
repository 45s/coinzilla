import assert from "node:assert/strict"
import nodeTest from "node:test"

import {
  createMarketMetadataCache,
  MARKET_METADATA_FRESHNESS_MAX_AGE_MS,
} from "./create-market-metadata-cache.js"
import {
  MARKET_METADATA_REFRESH_ERROR_CODES,
  MarketMetadataRefreshError,
} from "./market-metadata-refresh-error.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-market-metadata-cache.test.js] ${name}`, ...testArgs)
}

function makeMetadata({ symbol = "DOGEUSDT", version = 0 } = {}) {
  return {
    market: {
      id: `binance:${symbol}`,
      symbol,
    },
    version,
  }
}

function makeCache({ getSymbolFilters, now } = {}) {
  return createMarketMetadataCache({
    getMarketMetadata: ({ symbol } = {}) => makeMetadata({ symbol }),
    getSymbolFilters,
    validateMarketMetadata: ({ marketMetadata }) => marketMetadata,
    now,
  })
}

test("refreshes on first use and reuses filters only until the 30-second freshness limit", async () => {
  let currentTime = 1000
  let refreshCount = 0
  const symbol = "DOGEUSDT"
  const cache = makeCache({
    now: () => currentTime,
    getSymbolFilters: async ({ symbol: requestedSymbol }) => ({
      ok: true,
      data: makeMetadata({
        symbol: requestedSymbol,
        version: ++refreshCount,
      }),
    }),
  })
  const metadata = cache.getCurrentMarketMetadata({ symbol })
  const first = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })

  assert.equal(first.ok, true, "The first metadata access must refresh exchange filters.")
  assert.equal(first.data.version, 1, "The first access must return the current exchange metadata.")
  assert.equal(MARKET_METADATA_FRESHNESS_MAX_AGE_MS, 30_000, "The cache freshness window must remain bounded to thirty seconds.")

  currentTime = 1000 + MARKET_METADATA_FRESHNESS_MAX_AGE_MS - 1
  const cached = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })
  assert.equal(cached.data.version, 1, "A fresh validated snapshot must be reused inside the freshness window.")
  assert.equal(refreshCount, 1, "A fresh cache hit must not trigger another exchange request.")

  currentTime = 1000 + MARKET_METADATA_FRESHNESS_MAX_AGE_MS
  const refreshed = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })
  assert.equal(refreshed.data.version, 2, "Expired metadata must be replaced by the refreshed exchange snapshot.")
  assert.equal(refreshCount, 2, "Expired metadata must cause exactly one new exchange request.")
})

test("keeps freshness per symbol and lets trailing-BUY refresh force a new snapshot", async () => {
  let refreshCount = 0
  const cache = makeCache({
    now: () => 1000,
    getSymbolFilters: async ({ symbol }) => ({
      ok: true,
      data: makeMetadata({
        symbol,
        version: ++refreshCount,
      }),
    }),
  })
  const dogeMetadata = cache.getCurrentMarketMetadata({ symbol: "DOGEUSDT" })
  const zroMetadata = cache.getCurrentMarketMetadata({ symbol: "ZROUSDT" })

  await cache.refreshMarketMetadata({
    symbol: "DOGEUSDT",
    pairConfig: {},
    metadata: dogeMetadata,
  })
  await cache.refreshMarketMetadata({
    symbol: "ZROUSDT",
    pairConfig: {},
    metadata: zroMetadata,
  })
  const forced = await cache.refreshMarketMetadata({
    symbol: "DOGEUSDT",
    pairConfig: {},
    metadata: dogeMetadata,
    force: true,
  })

  assert.equal(forced.ok, true, "A forced metadata refresh must succeed with valid exchange filters.")
  assert.equal(forced.data.version, 3, "A forced refresh must replace the previously cached snapshot.")
  assert.equal(refreshCount, 3, "A forced refresh must bypass the freshness cache.")
})

test("retains the last validated snapshot but reports failure when refresh is unavailable", async () => {
  let currentTime = 1000
  let unavailable = false
  const refreshError = new Error("exchange filters unavailable")
  const cache = makeCache({
    now: () => currentTime,
    getSymbolFilters: async ({ symbol }) => {
      if (unavailable) {
        return {
          ok: false,
          errors: [refreshError],
        }
      }
      return {
        ok: true,
        data: makeMetadata({
          symbol,
          version: 1,
        }),
      }
    },
  })
  const symbol = "DOGEUSDT"
  const metadata = cache.getCurrentMarketMetadata({ symbol })
  const first = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })
  unavailable = true
  currentTime += MARKET_METADATA_FRESHNESS_MAX_AGE_MS

  const failed = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })

  assert.equal(first.ok, true, "The initial exchange metadata snapshot must be accepted.")
  assert.equal(failed.ok, false, "A failed refresh must not be reported as a successful metadata read.")
  assert.ok(failed.errors[0] instanceof MarketMetadataRefreshError, "A refresh failure must use the typed market metadata error.")
  assert.equal(failed.errors[0].code, MARKET_METADATA_REFRESH_ERROR_CODES.EXCHANGE_FILTERS_UNAVAILABLE, "A refresh failure must expose its stable diagnostic code.")
  assert.equal(failed.errors[0].cause, refreshError, "A refresh failure must preserve the original exchange error as its cause.")
  assert.deepEqual(failed.errors[0].context, { symbol }, "A refresh failure must identify the affected market safely.")
  assert.equal(cache.getCurrentMarketMetadata({ symbol }).version, 1, "Failed refresh must not replace the previously validated cache entry.")
})

test("rejects a refreshed filter snapshot for a different market", async () => {
  const symbol = "DOGEUSDT"
  const cache = makeCache({
    now: () => 1000,
    getSymbolFilters: async () => ({
      ok: true,
      data: makeMetadata({
        symbol: "ZROUSDT",
        version: 2,
      }),
    }),
  })
  const metadata = cache.getCurrentMarketMetadata({ symbol })

  const result = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })

  assert.equal(result.ok, false, "Metadata for another market must be rejected.")
  assert.match(result.errors[0].message, /does not match the active market/, "The error must identify the market identity mismatch.")
  assert.equal(result.errors[0].code, MARKET_METADATA_REFRESH_ERROR_CODES.MARKET_IDENTITY_MISMATCH, "A wrong-market response must expose its stable diagnostic code.")
  assert.equal(cache.getCurrentMarketMetadata({ symbol }).version, 0, "A wrong-market response must not replace the startup metadata fallback.")
})

test("fails before exchange access when the injected clock is invalid", async () => {
  let refreshCount = 0
  const cache = makeCache({
    now: () => Number.NaN,
    getSymbolFilters: async () => {
      refreshCount += 1
      return {
        ok: true,
        data: makeMetadata({ version: 1 }),
      }
    },
  })
  const symbol = "DOGEUSDT"

  const result = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata: cache.getCurrentMarketMetadata({ symbol }),
  })

  assert.equal(result.ok, false, "An invalid clock must fail the refresh operation.")
  assert.match(result.errors[0].message, /clock must return/, "An invalid clock must be rejected before an exchange request.")
  assert.equal(refreshCount, 0, "An invalid clock must prevent exchange metadata retrieval.")
})


test("refreshes instead of reusing a cache entry when the clock moves backwards", async () => {
  let currentTime = 1000
  let refreshCount = 0
  const cache = makeCache({
    now: () => currentTime,
    getSymbolFilters: async ({ symbol }) => ({
      ok: true,
      data: makeMetadata({
        symbol,
        version: ++refreshCount,
      }),
    }),
  })
  const symbol = "DOGEUSDT"
  const metadata = cache.getCurrentMarketMetadata({ symbol })
  await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })
  currentTime = 999

  const refreshed = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })

  assert.equal(refreshed.ok, true, "A refresh after the freshness window must succeed.")
  assert.equal(refreshed.data.version, 2, "The refreshed snapshot must replace expired metadata.")
  assert.equal(refreshCount, 2, "The cache must perform one initial and one expired refresh.")
})
