import assert from "node:assert/strict"
import test from "node:test"
import { validateExecutionFillAppliedFact } from "./validate-operational-state-execution-facts.js"

const MARKET_ID = "binance:BTCUSDT"
const FILL_ID = `${MARKET_ID}:trade-1`

function makeExecutionFill(overrides = {}) {
  return {
    factType: "EXECUTION_FILL_APPLIED",
    factId: `execution-fill-applied:${FILL_ID}`,
    canonicalData: {
      fillId: FILL_ID,
      tradeId: "trade-1",
      brokerOrderId: "broker-order-1",
      clientOrderId: null,
      marketId: MARKET_ID,
      venue: "binance",
      symbol: "BTCUSDT",
      baseAssetId: "binance:BTC",
      quoteAssetId: "binance:USDT",
      side: "BUY",
      price: "100.25",
      quantity: "0.5",
      quoteQuantity: "50.125",
      liquidityRole: "UNKNOWN",
      executedAt: null,
      commissionStatus: "UNKNOWN",
      commissions: [],
      ...overrides,
    },
  }
}

test("accepts canonical execution fills with absent or known client-order identity", () => {
  assert.doesNotThrow(
    () => validateExecutionFillAppliedFact(makeExecutionFill()),
    "A canonical execution fill without a known client order must retain exact market and trade identity.",
  )
  assert.doesNotThrow(
    () => validateExecutionFillAppliedFact(makeExecutionFill({
      clientOrderId: "client-order-1",
      side: "SELL",
      liquidityRole: "MAKER",
      executedAt: 1,
      commissionStatus: "COMPLETE",
      commissions: [],
    })),
    "A fill with a known client order, valid timestamp and maker liquidity must remain accepted.",
  )
  assert.doesNotThrow(
    () => validateExecutionFillAppliedFact(makeExecutionFill({
      liquidityRole: "TAKER",
      commissionStatus: "PARTIAL",
      commissions: [
        {
          amount: "0.001",
          assetId: "binance:BNB",
          assetCode: "BNB",
          quoteValue: {
            amount: "0.25",
            assetId: "binance:USDT",
            assetCode: "USDT",
          },
        },
      ],
    })),
    "A partially known commission must retain exact amount and quote-asset valuation evidence.",
  )
})

test("rejects execution fills with unsupported fields or inconsistent stable identities", () => {
  const valid = makeExecutionFill()
  const invalidCases = [
    ["unsupported field", { unsupported: true }, /unsupported fields/],
    ["same base and quote assets", { quoteAssetId: "binance:BTC" }, /identities must match/],
    ["non-lowercase venue", { venue: "Binance" }, /identities must match/],
    ["market and venue mismatch", { marketId: "kraken:BTCUSDT" }, /identities must match/],
    ["fill and trade mismatch", { fillId: "binance:BTCUSDT:other-trade" }, /identities must match/],
    ["unsupported side", { side: "HOLD" }, /side must be BUY or SELL/],
    ["unsupported liquidity role", { liquidityRole: "UNKNOWN_ROLE" }, /liquidity role is unsupported/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    assert.throws(
      () => validateExecutionFillAppliedFact({
        ...valid,
        canonicalData: {
          ...valid.canonicalData,
          ...changes,
        },
      }),
      expectedError,
      `An execution fill must reject ${description}.`,
    )
  }
  assert.throws(
    () => validateExecutionFillAppliedFact({
      ...valid,
      factId: "execution-fill-applied:binance:btc-usdt:trade-1",
      canonicalData: {
        ...valid.canonicalData,
        symbol: "btc-usdt",
        marketId: "binance:btc-usdt",
        fillId: "binance:btc-usdt:trade-1",
      },
    }),
    /symbol must be canonical/,
    "An execution-fill symbol must be validated after its matching market and trade identity are established.",
  )
  assert.throws(
    () => validateExecutionFillAppliedFact({
      ...valid,
      factId: "wrong-id",
    }),
    /identities must match/,
    "The durable execution-fill fact ID must be derived from its canonical fill identity.",
  )
})

test("rejects non-positive or non-canonical execution amounts and invalid timestamps", () => {
  const valid = makeExecutionFill()
  const invalidCases = [
    ["zero price", { price: "0" }, /price and quantities must be positive/],
    ["negative quantity", { quantity: "-1" }, /price and quantities must be positive/],
    ["exponent quote quantity", { quoteQuantity: "5e1" }, /price and quantities must be positive/],
    ["negative execution timestamp", { executedAt: -1 }, /executedAt must be a non-negative safe integer/],
    ["fractional execution timestamp", { executedAt: 1.5 }, /executedAt must be a non-negative safe integer/],
    ["unsafe execution timestamp", { executedAt: Number.MAX_SAFE_INTEGER + 1 }, /executedAt must be a non-negative safe integer/],
    ["string execution timestamp", { executedAt: "1" }, /executedAt must be a non-negative safe integer/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    assert.throws(
      () => validateExecutionFillAppliedFact({
        ...valid,
        canonicalData: {
          ...valid.canonicalData,
          ...changes,
        },
      }),
      expectedError,
      `An execution fill must reject ${description}.`,
    )
  }
})

test("enforces commission completeness and the supported commission collection shape", () => {
  const valid = makeExecutionFill()
  const invalidCases = [
    ["unknown status with entries", {
      commissionStatus: "UNKNOWN",
      commissions: [
        {
          amount: "0",
          assetId: "binance:BNB",
          assetCode: "BNB",
          quoteValue: null,
        },
      ],
    }, /contradict commission completeness/],
    ["partial status without entries", {
      commissionStatus: "PARTIAL",
      commissions: [],
    }, /contradict commission completeness/],
    ["unsupported commission status", {
      commissionStatus: "MISSING",
    }, /commission status or collection is invalid/],
    ["non-array commissions", {
      commissions: null,
    }, /commission status or collection is invalid/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    assert.throws(
      () => validateExecutionFillAppliedFact({
        ...valid,
        canonicalData: {
          ...valid.canonicalData,
          ...changes,
        },
      }),
      expectedError,
      `An execution fill must reject ${description}.`,
    )
  }
})

const INVALID_COMMISSION_CASES = [
  [null, /unsupported fields/],
  [[], /unsupported fields/],
  [
    {
      amount: "0.1",
      assetId: "binance:BNB",
      assetCode: "BNB",
      unsupported: true,
    },
    /unsupported fields/,
  ],
  [
    {
      amount: "-0.1",
      assetId: "binance:BNB",
      assetCode: "BNB",
      quoteValue: null,
    },
    /non-negative exact decimal/,
  ],
  [
    {
      amount: "0.1",
      assetId: "",
      assetCode: "BNB",
      quoteValue: null,
    },
    /non-empty string/,
  ],
  [
    {
      amount: "0.1",
      assetId: "binance:BNB",
      assetCode: "",
      quoteValue: null,
    },
    /non-empty string/,
  ],
  [
    {
      amount: "0.1",
      assetId: "binance:BNB",
      assetCode: "BNB",
      quoteValue: {
        amount: "1",
        assetId: "binance:BTC",
        assetCode: "BTC",
      },
    },
    /canonical quote asset/,
  ],
  [
    {
      amount: "0.1",
      assetId: "binance:BNB",
      assetCode: "BNB",
      quoteValue: {
        amount: "1",
        assetId: "binance:USDT",
        assetCode: "",
      },
    },
    /non-empty string/,
  ],
]

test("accepts a canonical commission without quote conversion", () => {
  const valid = makeExecutionFill({
    commissionStatus: "COMPLETE",
    commissions: [
      {
        amount: "0.0001",
        assetId: "binance:BNB",
        assetCode: "BNB",
        quoteValue: null,
      },
    ],
  })

  assert.doesNotThrow(
    () => validateExecutionFillAppliedFact(valid),
    "A canonical commission without quote conversion must remain valid.",
  )
})

test("rejects malformed commission entries and non-canonical quote valuations", () => {
  for (const [commission, expectedError] of INVALID_COMMISSION_CASES) {
    assert.throws(
      () => validateExecutionFillAppliedFact(makeExecutionFill({
        commissionStatus: "COMPLETE",
        commissions: [commission],
      })),
      expectedError,
      `A malformed commission entry must be rejected: ${expectedError}.`,
    )
  }
})

test("leaves unrelated fact types to their owning validators", () => {
  assert.doesNotThrow(
    () => validateExecutionFillAppliedFact({
      factType: "PROCESS_STOPPED",
      factId: "process-stopped:session-1",
      canonicalData: {},
    }),
    "The execution-fill validator must not interpret unrelated durable fact families.",
  )
})
