import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-market-metadata-test-key",
  apiSecret: "bitunix-futures-market-metadata-test-secret",
}

const fundingRate = {
  symbol: "BTCUSDT",
  markPrice: "65000.1200",
  lastPrice: "65000.1100",
  indexPrice: "65001.0000",
  fundingRate: "-0.00025",
  nextFundingTime: "1770710400000",
  fundingInterval: 8,
  maxFundingRate: "0.3",
  minFundingRate: "-0.3",
}

function createFuturesResponse({ data }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

function createBroker({ responses = {} } = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...requestArgs) => {
          const [url, options] = requestArgs
          const requestPath = new URL(url).pathname
          requests.push({
            url: String(url),
            options,
          })
          return createFuturesResponse({
            data: responses[requestPath] ?? [],
          })
        },
      },
    },
  })
  return {
    broker,
    requests,
  }
}

test("Bitunix Futures exposes current and batch funding rates with exact decimals and millisecond timestamps", async () => {
  const single = createBroker({
    responses: {
      "/api/v1/futures/market/funding_rate": [fundingRate],
    },
  })
  const singleResult = await single.broker.getFuturesFundingRate({
    symbol: "btcusdt",
  })

  assert.equal(singleResult.ok, true, "the documented single-symbol funding endpoint must return a valid rate")
  assert.deepEqual(singleResult.data, {
    ...fundingRate,
    symbol: "BTCUSDT",
    nextFundingTime: 1_770_710_400_000,
  }, "funding decimals must remain exact and the exchange millisecond timestamp must be normalized")
  assert.equal(single.requests.length, 1)
  assert.equal(new URL(single.requests[0].url).pathname, "/api/v1/futures/market/funding_rate")
  assert.equal(new URL(single.requests[0].url).searchParams.get("symbol"), "BTCUSDT")
  assert.equal(Object.hasOwn(single.requests[0].options.headers, "api-key"), false, "public funding reads must not sign requests")

  const batch = createBroker({
    responses: {
      "/api/v1/futures/market/funding_rate/batch": [
        fundingRate,
        {
          ...fundingRate,
          symbol: "ETHUSDT",
          markPrice: "3500.10",
          lastPrice: "3500.20",
          indexPrice: "3500.15",
        },
      ],
    },
  })
  const batchResult = await batch.broker.getFuturesFundingRates()

  assert.equal(batchResult.ok, true, "the documented batch funding endpoint must return all validated symbols")
  assert.equal(batchResult.data.length, 2)
  assert.deepEqual(batchResult.data.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"])
  assert.equal(new URL(batch.requests[0].url).pathname, "/api/v1/futures/market/funding_rate/batch")
  assert.equal(Object.hasOwn(batch.requests[0].options.headers, "api-key"), false)
})

test("Bitunix Futures funding history validates the time window and preserves exact funding values", async () => {
  const { broker, requests } = createBroker({
    responses: {
      "/api/v1/futures/market/get_funding_rate_history": [{
        fundingRate: "-0.00001191",
        fundingTime: "1772449200000",
        markPrice: "66286.6000",
      }],
    },
  })
  const result = await broker.getFuturesFundingRateHistory({
    symbol: "btcusdt",
    startTime: 1_772_000_000_000,
    endTime: 1_772_500_000_000,
    limit: 200,
  })

  assert.equal(result.ok, true, "a valid bounded funding-history query must succeed")
  assert.deepEqual(result.data, [{
    fundingRate: "-0.00001191",
    fundingTime: 1_772_449_200_000,
    markPrice: "66286.6000",
  }])
  const requestUrl = new URL(requests[0].url)
  assert.equal(requestUrl.pathname, "/api/v1/futures/market/get_funding_rate_history")
  assert.equal(requestUrl.searchParams.get("symbol"), "BTCUSDT")
  assert.equal(requestUrl.searchParams.get("startTime"), "1772000000000")
  assert.equal(requestUrl.searchParams.get("endTime"), "1772500000000")
  assert.equal(requestUrl.searchParams.get("limit"), "200")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), false)
})

test("Bitunix Futures position tiers preserve exact notional boundaries and maintenance rates", async () => {
  const { broker, requests } = createBroker({
    responses: {
      "/api/v1/futures/position/get_position_tiers": [
        {
          symbol: "BTCUSDT",
          level: 1,
          startValue: "0",
          endValue: "50000.0000",
          leverage: 125,
          maintenanceMarginRate: "0.004",
        },
        {
          symbol: "BTCUSDT",
          level: 2,
          startValue: "50000.0000",
          endValue: "200000.0000",
          leverage: 100,
          maintenanceMarginRate: "0.005",
        },
      ],
    },
  })
  const result = await broker.getFuturesPositionTiers({
    symbol: "btcusdt",
  })

  assert.equal(result.ok, true, "valid position tiers must be returned")
  assert.deepEqual(result.data.map((tier) => ({
    symbol: tier.symbol,
    level: tier.level,
    startValue: tier.startValue,
    endValue: tier.endValue,
    leverage: tier.leverage,
    maintenanceMarginRate: tier.maintenanceMarginRate,
  })), [
    {
      symbol: "BTCUSDT",
      level: 1,
      startValue: "0",
      endValue: "50000.0000",
      leverage: 125,
      maintenanceMarginRate: "0.004",
    },
    {
      symbol: "BTCUSDT",
      level: 2,
      startValue: "50000.0000",
      endValue: "200000.0000",
      leverage: 100,
      maintenanceMarginRate: "0.005",
    },
  ])
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/futures/position/get_position_tiers")
  assert.equal(new URL(requests[0].url).searchParams.get("symbol"), "BTCUSDT")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), false)
})

test("Bitunix Futures trading settings retain account symbol leverage and margin mode distinctions", async () => {
  const { broker, requests } = createBroker({
    responses: {
      "/api/v1/futures/account/trading_settings": [
        {
          symbol: "BTCUSDT",
          marginCoin: "USDT",
          marginMode: "CROSS",
          leverage: 20,
          longLeverage: 25,
          shortLeverage: 15,
        },
        {
          symbol: "ETHUSDT",
          marginCoin: "USDT",
          marginMode: "ISOLATION",
          leverage: 10,
          longLeverage: 10,
          shortLeverage: 10,
        },
      ],
    },
  })
  const result = await broker.getFuturesTradingSettings({
    symbols: ["btcusdt", "ETHUSDT"],
  })

  assert.equal(result.ok, true, "authenticated per-symbol Futures settings must be returned")
  assert.deepEqual(result.data, [
    {
      symbol: "BTCUSDT",
      marginCoin: "USDT",
      marginMode: "CROSS",
      leverage: 20,
      longLeverage: 25,
      shortLeverage: 15,
    },
    {
      symbol: "ETHUSDT",
      marginCoin: "USDT",
      marginMode: "ISOLATION",
      leverage: 10,
      longLeverage: 10,
      shortLeverage: 10,
    },
  ], "hedge-mode long/short leverage must not be collapsed into the legacy leverage field")
  const requestUrl = new URL(requests[0].url)
  assert.equal(requestUrl.pathname, "/api/v1/futures/account/trading_settings")
  assert.equal(requestUrl.searchParams.get("symbols"), "BTCUSDT,ETHUSDT")
  assert.equal(requests[0].options.method, "GET")
  assert.equal(requests[0].options.headers["api-key"], credentials.apiKey, "trading settings are an authenticated account read")
})

test("Bitunix Futures market metadata reads reject invalid filters and malformed exchange rows before returning data", async () => {
  const invalidWindow = createBroker()
  const invalidWindowResult = await invalidWindow.broker.getFuturesFundingRateHistory({
    symbol: "BTCUSDT",
    startTime: 2_000,
    endTime: 1_000,
  })
  assert.equal(invalidWindowResult.ok, false)
  assert.equal(invalidWindow.requests.length, 0, "invalid time windows must fail before a request")

  const invalidLimit = createBroker()
  const invalidLimitResult = await invalidLimit.broker.getFuturesFundingRateHistory({
    symbol: "BTCUSDT",
    limit: 201,
  })
  assert.equal(invalidLimitResult.ok, false)
  assert.equal(invalidLimit.requests.length, 0, "funding history must enforce the documented 200-row maximum")

  const invalidSettings = createBroker()
  const invalidSettingsResult = await invalidSettings.broker.getFuturesTradingSettings({
    symbols: Array.from({ length: 51 }, (_, index) => `COIN${index}USDT`),
  })
  assert.equal(invalidSettingsResult.ok, false)
  assert.equal(invalidSettings.requests.length, 0, "trading settings must enforce the documented 50-symbol maximum")

  const malformedTiers = createBroker({
    responses: {
      "/api/v1/futures/position/get_position_tiers": [{
        symbol: "BTCUSDT",
        level: 1,
        startValue: "0",
        endValue: "50000",
        leverage: 125,
      }],
    },
  })
  const malformedTiersResult = await malformedTiers.broker.getFuturesPositionTiers({
    symbol: "BTCUSDT",
  })
  assert.equal(malformedTiersResult.ok, false, "missing maintenance-margin metadata must not be silently defaulted")
})
