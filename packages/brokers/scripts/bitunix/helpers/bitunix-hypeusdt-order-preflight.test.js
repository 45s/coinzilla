import assert from "node:assert/strict"
import test from "node:test"
import { createBitunixOperatorOrderPreflight } from "./bitunix-hypeusdt-order-preflight.js"

function createValidBitunixOperatorPreflightInput({ overrides = {} } = {}) {
  const market = {
    symbol: "HYPEUSDT",
    baseAsset: {
      code: "HYPE",
    },
    quoteAsset: {
      code: "USDT",
    },
  }
  const symbolFilters = {
    symbol: "HYPEUSDT",
    base: "HYPE",
    quote: "USDT",
    isOpen: "1",
    minVolume: "0.001",
    minPrice: "10",
  }
  const usdtBalance = {
    free: {
      amount: "1.2500",
      asset: {
        code: "USDT",
      },
    },
    locked: {
      amount: "0.5000",
      asset: {
        code: "USDT",
      },
    },
  }
  return {
    marketResult: {
      ok: true,
      data: [market],
    },
    filtersResult: {
      ok: true,
      data: symbolFilters,
    },
    balancesResult: {
      ok: true,
      data: [usdtBalance],
    },
    openOrdersResult: {
      ok: true,
      data: [],
    },
    ...overrides,
  }
}

test("Bitunix operator preflight fixes the exact HYPEUSDT BUY LIMIT intent", () => {
  const preflight = createBitunixOperatorOrderPreflight(createValidBitunixOperatorPreflightInput())

  assert.deepEqual(preflight.order, {
    symbol: "HYPEUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "30",
    quantity: "0.4",
    notional: "12",
  })
  assert.equal(preflight.minimumQuantity, "0.001")
  assert.equal(preflight.minimumNotional, "10")
  assert.equal(preflight.provisionalNotionalFloor, "11")
  assert.equal(preflight.freeQuoteBalance, "1.2500")
  assert.equal(preflight.lockedQuoteBalance, "0.5000")
  assert.equal(preflight.openOrderCount, 0)
})

test("Bitunix operator preflight rejects a market not returned as explicitly open", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.marketResult.data = []

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /HYPEUSDT.*explicitly open/i,
  )
})

test("Bitunix operator preflight rejects mismatched pair identity", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.filtersResult.data.base = "BTC"

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /base.*quote.*HYPEUSDT|HYPEUSDT.*base.*quote/i,
  )
})

test("Bitunix operator preflight rejects a market not explicitly marked open", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.filtersResult.data.isOpen = "unknown"

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /not explicitly open/i,
  )
})

test("Bitunix operator preflight requires documented minimum quantity and notional", () => {
  for (const field of ["minVolume", "minPrice"]) {
    const input = createValidBitunixOperatorPreflightInput()
    delete input.filtersResult.data[field]

    assert.throws(
      () => createBitunixOperatorOrderPreflight(input),
      new RegExp(field, "i"),
      `missing ${field} must stop the operator attempt`,
    )
  }
})

test("Bitunix operator preflight rejects invalid or negative market minima", () => {
  for (const value of ["", "unknown", "-0.1"]) {
    const input = createValidBitunixOperatorPreflightInput()
    input.filtersResult.data.minVolume = value

    assert.throws(
      () => createBitunixOperatorOrderPreflight(input),
      /minVolume/i,
      `invalid minVolume ${JSON.stringify(value)} must fail closed`,
    )
  }
})

test("Bitunix operator preflight rejects an order below the documented minimum quantity", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.filtersResult.data.minVolume = "0.4000001"

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /minimum quantity/i,
  )
})

test("Bitunix operator preflight rejects an order below the documented minimum notional", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.filtersResult.data.minPrice = "12.0001"

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /minimum notional/i,
  )
})

test("Bitunix operator preflight rejects free USDT sufficient to cover the order", () => {
  for (const amount of ["12", "12.0000", "20"]) {
    const input = createValidBitunixOperatorPreflightInput()
    input.balancesResult.data[0].free.amount = amount

    assert.throws(
      () => createBitunixOperatorOrderPreflight(input),
      /free USDT.*at least.*12/i,
      `free USDT ${amount} must stop an insufficient-balance probe`,
    )
  }
})

test("Bitunix operator preflight requires an explicit USDT balance row", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.balancesResult.data = []

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /USDT balance/i,
  )
})

test("Bitunix operator preflight rejects any existing HYPEUSDT open order", () => {
  const input = createValidBitunixOperatorPreflightInput()
  input.openOrdersResult.data = [{
    id: "existing-order",
  }]

  assert.throws(
    () => createBitunixOperatorOrderPreflight(input),
    /existing HYPEUSDT open order/i,
  )
})

test("Bitunix operator preflight fails closed when any broker read fails", () => {
  const operations = [
    "marketResult",
    "filtersResult",
    "balancesResult",
    "openOrdersResult",
  ]

  for (const operation of operations) {
    const input = createValidBitunixOperatorPreflightInput()
    input[operation] = {
      ok: false,
      errors: [new Error(`${operation} failed`)],
    }

    assert.throws(
      () => createBitunixOperatorOrderPreflight(input),
      new RegExp(operation.replace("Result", ""), "i"),
      `${operation} failure must stop before the order confirmation`,
    )
  }
})
