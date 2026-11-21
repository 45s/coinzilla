import assert from "node:assert/strict"
import nodeTest from "node:test"

import {
  createMarketMetadataCache,
  MARKET_METADATA_FRESHNESS_MAX_AGE_MS,
} from "./create-market-metadata-cache.js"

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

  assert.equal(first.ok, true)
  assert.equal(first.data.version, 1)
  assert.equal(MARKET_METADATA_FRESHNESS_MAX_AGE_MS, 30_000)

  currentTime = 1000 + MARKET_METADATA_FRESHNESS_MAX_AGE_MS - 1
  const cached = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })
  assert.equal(cached.data.version, 1)
  assert.equal(refreshCount, 1)

  currentTime = 1000 + MARKET_METADATA_FRESHNESS_MAX_AGE_MS
  const refreshed = await cache.refreshMarketMetadata({
    symbol,
    pairConfig: {},
    metadata,
  })
  assert.equal(refreshed.data.version, 2)
  assert.equal(refreshCount, 2)
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

  assert.equal(forced.ok, true)
  assert.equal(forced.data.version, 3)
  assert.equal(refreshCount, 3)
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

  assert.equal(first.ok, true)
  assert.equal(failed.ok, false)
  assert.equal(failed.errors[0], refreshError)
  assert.equal(cache.getCurrentMarketMetadata({ symbol }).version, 1)
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

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /does not match the active market/)
  assert.equal(cache.getCurrentMarketMetadata({ symbol }).version, 0)
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

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /clock must return/)
  assert.equal(refreshCount, 0)
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

  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.data.version, 2)
  assert.equal(refreshCount, 2)
})
