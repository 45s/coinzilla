import test from "node:test"
import assert from "node:assert/strict"
import { fetchBinanceSpotMetadata } from "./binance-client.js"

const createExchangeInfo = ({
  status = "TRADING",
  isSpotTradingAllowed = true,
  orderTypes = ["LIMIT", "LIMIT_MAKER"],
  filters,
} = {}) => ({
  exchangeFilters: [],
  symbols: [{
    symbol: "ADAFDUSD",
    status,
    baseAsset: "ADA",
    quoteAsset: "FDUSD",
    isSpotTradingAllowed,
    orderTypes,
    filters: filters ?? [
      { filterType: "PRICE_FILTER", minPrice: "0.00000000", maxPrice: "100000.00000000", tickSize: "0.00010000" },
      { filterType: "LOT_SIZE", minQty: "0.10000000", maxQty: "100000.00000000", stepSize: "0.10000000" },
      { filterType: "MIN_NOTIONAL", minNotional: "5.00000000" },
    ],
  }],
})

const createResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
})

test("fetches public Spot exchange filters and current ticker price without credentials", async () => {
  const requests = []
  const responses = [
    createResponse(createExchangeInfo()),
    createResponse({ symbol: "ADAFDUSD", price: "0.50000000" }),
  ]
  const metadata = await fetchBinanceSpotMetadata({
    symbol: "ADAFDUSD",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options })
      return responses.shift()
    },
  })

  assert.equal(requests.length, 2, "The client must fetch exchange filters and a current reference price.")
  assert.match(requests[0].url, /testnet\.binance\.vision\/api\/v3\/exchangeInfo\?symbol=ADAFDUSD/, "The default exchange-info request must use the Binance Spot TESTNET host and be symbol-scoped.")
  assert.match(requests[1].url, /testnet\.binance\.vision\/api\/v3\/ticker\/price\?symbol=ADAFDUSD/, "The default ticker request must use the Binance Spot TESTNET host and be symbol-scoped.")
  assert.deepEqual(requests.map(({ options }) => options.headers), [{ Accept: "application/json" }, { Accept: "application/json" }], "Public metadata requests must not include API keys or credentials.")
  assert.deepEqual(metadata, {
    symbol: "ADAFDUSD",
    baseAsset: "ADA",
    quoteAsset: "FDUSD",
    price: "0.50000000",
    tickSize: "0.00010000",
    maxPrice: "100000.00000000",
    stepSize: "0.10000000",
    minQuantity: "0.10000000",
    maxQuantity: "100000.00000000",
    minNotional: "5.00000000",
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    environment: "testnet",
  }, "The normalized metadata must preserve exact exchange decimal strings.")
})

test("uses the LIVE public API only when the operator selects live", async () => {
  const urls = []
  const responses = [
    createResponse(createExchangeInfo()),
    createResponse({ symbol: "ADAFDUSD", price: "0.50000000" }),
  ]
  const metadata = await fetchBinanceSpotMetadata({
    symbol: "ADAFDUSD",
    environment: "live",
    fetchImpl: async (url) => {
      urls.push(String(url))
      return responses.shift()
    },
  })
  assert.ok(urls.every((url) => url.startsWith("https://api.binance.com/")), "Live metadata must come from the Binance production public API host.")
  assert.equal(metadata.environment, "live", "The selected environment must remain attached to the metadata result.")
})

test("rejects an unsupported environment before making a network request", async () => {
  let requests = 0
  await assert.rejects(
    fetchBinanceSpotMetadata({
      symbol: "ADAFDUSD",
      environment: "paper",
      fetchImpl: async () => {
        requests += 1
        return createResponse(createExchangeInfo())
      },
    }),
    /environment.*testnet or live/i,
    "Unknown environment values must not silently fall back to production or TESTNET.",
  )
  assert.equal(requests, 0, "Invalid environment selection must fail before any Binance request.")
})

test("rejects an unknown symbol returned by Binance", async () => {
  await assert.rejects(
    fetchBinanceSpotMetadata({
      symbol: "ADAFDUSD",
      fetchImpl: async () => createResponse({ symbols: [] }),
    }),
    /not found/i,
    "An unknown symbol must not be used to generate a configuration.",
  )
})

test("rejects symbols that are not actively tradable on Spot", async () => {
  for (const body of [
    createExchangeInfo({ status: "BREAK" }),
    createExchangeInfo({ isSpotTradingAllowed: false }),
  ]) {
    await assert.rejects(
      fetchBinanceSpotMetadata({
        symbol: "ADAFDUSD",
        fetchImpl: async () => createResponse(body),
      }),
      /not.*(trading|spot)/i,
      "A non-trading or non-Spot symbol must be rejected.",
    )
  }
})

test("rejects symbols without the order types required by the configured commission policy", async () => {
  await assert.rejects(
    fetchBinanceSpotMetadata({
      symbol: "ADAFDUSD",
      fetchImpl: async () => createResponse(createExchangeInfo({ orderTypes: ["LIMIT"] })),
    }),
    /LIMIT_MAKER/i,
    "The symbol must support both supported Harvester limit order modes.",
  )
})

test("rejects missing, duplicate, malformed, and zero exchange filters", async () => {
  const valid = createExchangeInfo().symbols[0].filters
  const invalidFilters = [
    valid.filter((filter) => filter.filterType !== "PRICE_FILTER"),
    [...valid, valid[0]],
    [...valid, valid[2]],
    valid.map((filter) => filter.filterType === "LOT_SIZE" ? { ...filter, stepSize: "0" } : filter),
    valid.map((filter) => filter.filterType === "MIN_NOTIONAL" ? { ...filter, minNotional: "NaN" } : filter),
    [...valid, { filterType: "NOTIONAL", minNotional: "5", maxNotional: "NaN" }],
  ]

  for (const filters of invalidFilters) {
    await assert.rejects(
      fetchBinanceSpotMetadata({
        symbol: "ADAFDUSD",
        fetchImpl: async () => createResponse(createExchangeInfo({ filters })),
      }),
      /filter|increment|notional|decimal|positive/i,
      "Incomplete or malformed exchange filters must fail closed.",
    )
  }
})

test("uses the stricter minimum when Binance returns both MIN_NOTIONAL and NOTIONAL filters", async () => {
  const filters = [
    ...createExchangeInfo().symbols[0].filters,
    { filterType: "NOTIONAL", minNotional: "10.00000000", maxNotional: "50.00000000", applyMinToMarket: true, applyMaxToMarket: true },
  ]
  const [exchangeResponse] = [createResponse(createExchangeInfo({ filters }))]
  const responses = [exchangeResponse, createResponse({ symbol: "ADAFDUSD", price: "0.5" })]
  const metadata = await fetchBinanceSpotMetadata({
    symbol: "ADAFDUSD",
    fetchImpl: async () => responses.shift(),
  })
  assert.equal(metadata.minNotional, "10.00000000", "The stricter applicable minimum notional must be retained without losing the exchange decimal representation.")
})

test("reports Binance HTTP, malformed JSON, and network failures clearly", async () => {
  await assert.rejects(
    fetchBinanceSpotMetadata({ symbol: "ADAFDUSD", fetchImpl: async () => createResponse({}, { ok: false, status: 429 }) }),
    /429/,
    "HTTP failures must include the status code.",
  )
  await assert.rejects(
    fetchBinanceSpotMetadata({ symbol: "ADAFDUSD", fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON") } }) }),
    /invalid JSON/i,
    "Malformed JSON responses must be surfaced as metadata failures.",
  )
  await assert.rejects(
    fetchBinanceSpotMetadata({ symbol: "ADAFDUSD", fetchImpl: async () => { throw new Error("network down") } }),
    /network down/i,
    "Network failures must retain their original diagnostic.",
  )
})

test("rejects unvalidated active symbol and exchange filters but ignores filters exclusive to unsupported order types", async () => {
  const base = createExchangeInfo()
  await assert.rejects(
    fetchBinanceSpotMetadata({
      symbol: "ADAFDUSD",
      fetchImpl: async () => createResponse({
        ...base,
        symbols: [{ ...base.symbols[0], filters: [...base.symbols[0].filters, { filterType: "PERCENT_PRICE", multiplierUp: "1.2" }] }],
      }),
    }),
    /not validated.*PERCENT_PRICE/i,
    "A dynamic price-band filter must not be silently ignored by a generator that cannot validate it.",
  )
  await assert.rejects(
    fetchBinanceSpotMetadata({
      symbol: "ADAFDUSD",
      fetchImpl: async () => createResponse({
        ...base,
        exchangeFilters: [{ filterType: "EXCHANGE_MAX_NUM_ORDERS", maxNumOrders: 200 }],
      }),
    }),
    /not validated.*EXCHANGE_MAX_NUM_ORDERS/i,
    "An exchange-wide order constraint must be reported as unsupported.",
  )
  const responses = [
    createResponse({
      ...base,
      symbols: [{ ...base.symbols[0], filters: [...base.symbols[0].filters, { filterType: "MARKET_LOT_SIZE", minQty: "0", maxQty: "0", stepSize: "0" }] }],
    }),
    createResponse({ symbol: "ADAFDUSD", price: "0.5" }),
  ]
  const metadata = await fetchBinanceSpotMetadata({
    symbol: "ADAFDUSD",
    fetchImpl: async () => responses.shift(),
  })
  assert.equal(metadata.symbol, "ADAFDUSD", "Filters exclusive to unsupported MARKET orders must not block the current LIMIT/LIMIT_MAKER configuration.")
})

test("accepts omitted optional price and maximum-notional bounds without inventing values", async () => {
  const responses = [
    createResponse(createExchangeInfo({
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.0001" },
        { filterType: "LOT_SIZE", minQty: "0.1", maxQty: "100000", stepSize: "0.1" },
        { filterType: "NOTIONAL", minNotional: "5" },
      ],
    })),
    createResponse({ symbol: "ADAFDUSD", price: "0.5" }),
  ]
  const metadata = await fetchBinanceSpotMetadata({
    symbol: "ADAFDUSD",
    fetchImpl: async () => responses.shift(),
  })
  assert.equal(metadata.minPrice, undefined, "An omitted optional minimum price must remain absent.")
  assert.equal(metadata.maxPrice, undefined, "An omitted optional maximum price must remain absent.")
  assert.equal(metadata.maxNotional, undefined, "An omitted optional NOTIONAL maximum must remain absent.")
})

test("validates current reference price against active PRICE_FILTER bounds", async () => {
  for (const priceFilter of [
    { filterType: "PRICE_FILTER", minPrice: "1", maxPrice: "100", tickSize: "0.0001" },
    { filterType: "PRICE_FILTER", minPrice: "0", maxPrice: "0.1", tickSize: "0.0001" },
  ]) {
    const responses = [
      createResponse(createExchangeInfo({
        filters: [
          priceFilter,
          { filterType: "LOT_SIZE", minQty: "0.1", maxQty: "100000", stepSize: "0.1" },
          { filterType: "MIN_NOTIONAL", minNotional: "5" },
        ],
      })),
      createResponse({ symbol: "ADAFDUSD", price: "0.5" }),
    ]
    await assert.rejects(
      fetchBinanceSpotMetadata({ symbol: "ADAFDUSD", fetchImpl: async () => responses.shift() }),
      /ticker price is (below|above) PRICE_FILTER/i,
      "A reference price outside active Binance price bounds must not be used for order sizing.",
    )
  }
})

test("rejects a ticker response for a different symbol or invalid price", async () => {
  for (const ticker of [
    { symbol: "OTHER", price: "0.5" },
    { symbol: "ADAFDUSD", price: "0" },
    { symbol: "ADAFDUSD", price: "NaN" },
  ]) {
    let requestIndex = 0
    await assert.rejects(
      fetchBinanceSpotMetadata({
        symbol: "ADAFDUSD",
        fetchImpl: async () => {
          requestIndex += 1
          return requestIndex === 1
            ? createResponse(createExchangeInfo())
            : createResponse(ticker)
        },
      }),
      /ticker|price|symbol/i,
      "A malformed ticker price must not be used to calculate the configured order quantity.",
    )
  }
})
