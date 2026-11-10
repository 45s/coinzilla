import assert from "node:assert/strict"
import test from "node:test"

import { getMarketSellQuantity } from "./testnet-sell-utils.js"

const symbolInfo = {
  filters: [
    {
      filterType: "MARKET_LOT_SIZE",
      minQty: "0.10000000",
      maxQty: "100000.00000000",
      stepSize: "0.10000000",
    },
    {
      filterType: "LOT_SIZE",
      minQty: "0.01000000",
      maxQty: "100000.00000000",
      stepSize: "0.01000000",
    },
  ],
}

test("rounds the free balance down to the market step without floating-point math", () => {
  assert.deepEqual(
    getMarketSellQuantity({
      freeBalance: "249.85999999",
      symbolInfo,
    }),
    {
      quantity: "249.80000000",
      stepSize: "0.10000000",
    },
  )
})

test("falls back to LOT_SIZE when MARKET_LOT_SIZE has a zero step", () => {
  const { quantity, stepSize } = getMarketSellQuantity({
    freeBalance: "1.239",
    symbolInfo: {
      filters: [
        {
          filterType: "MARKET_LOT_SIZE",
          minQty: "0",
          maxQty: "100",
          stepSize: "0",
        },
        {
          filterType: "LOT_SIZE",
          minQty: "0.01",
          maxQty: "100",
          stepSize: "0.01",
        },
      ],
    },
  })

  assert.equal(quantity, "1.230")
  assert.equal(stepSize, "0.01")
})

test("rejects a quantity below the exchange market minimum", () => {
  assert.throws(
    () =>
      getMarketSellQuantity({
        freeBalance: "0.09",
        symbolInfo,
      }),
    /below the market minimum/,
  )
})

test("rejects a quantity above the exchange market maximum", () => {
  assert.throws(
    () =>
      getMarketSellQuantity({
        freeBalance: "100000.1",
        symbolInfo,
      }),
    /exceeds the market maximum/,
  )
})

test("rejects malformed balances and missing quantity filters", () => {
  assert.throws(
    () => getMarketSellQuantity({ freeBalance: "NaN", symbolInfo }),
    /freeBalance must be a non-negative decimal string/,
  )
  assert.throws(
    () =>
      getMarketSellQuantity({
        freeBalance: "1",
        symbolInfo: { filters: [] },
      }),
    /No usable MARKET_LOT_SIZE or LOT_SIZE filter/,
  )
})


test("preserves the maximum input precision after rounding to the exchange step", () => {
  const { quantity } = getMarketSellQuantity({
    freeBalance: "1.239000",
    symbolInfo: {
      filters: [
        {
          filterType: "MARKET_LOT_SIZE",
          minQty: "0.01",
          maxQty: "100",
          stepSize: "0.01",
        },
      ],
    },
  })

  assert.equal(quantity, "1.230000")
})

test("accepts exact inclusive minimum and maximum quantity boundaries", () => {
  const filters = {
    filters: [
      {
        filterType: "MARKET_LOT_SIZE",
        minQty: "0.1",
        maxQty: "1.00",
        stepSize: "0.1",
      },
    ],
  }

  assert.equal(
    getMarketSellQuantity({ freeBalance: "0.1", symbolInfo: filters }).quantity,
    "0.1",
  )
  assert.equal(
    getMarketSellQuantity({ freeBalance: "1.00", symbolInfo: filters }).quantity,
    "1.00",
  )
})

test("rejects a zero LOT_SIZE fallback instead of treating it as disabled rounding", () => {
  assert.throws(
    () =>
      getMarketSellQuantity({
        freeBalance: "1",
        symbolInfo: {
          filters: [
            {
              filterType: "LOT_SIZE",
              minQty: "0",
              maxQty: "100",
              stepSize: "0",
            },
          ],
        },
      }),
    /stepSize must be positive/,
  )
})

test("retains the strict non-negative plain-decimal input contract", () => {
  for (const freeBalance of ["-0", "-1", "01", "1e2", " 1", "1 "]) {
    assert.throws(
      () => getMarketSellQuantity({ freeBalance, symbolInfo }),
      /freeBalance must be a non-negative decimal string/,
      freeBalance,
    )
  }
})
