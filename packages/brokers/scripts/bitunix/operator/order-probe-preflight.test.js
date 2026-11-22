import assert from "node:assert/strict"
import test from "node:test"
import { createBitunixOrderProbePreflight } from "./order-probe-preflight.js"

function createPreflightInput({ probeId = "limit-buy-1", overrides = {} } = {}) {
  return {
    probeId,
    marketResult: {
      ok: true,
      data: [{
        symbol: "HYPEUSDT",
        baseAsset: { code: "HYPE" },
        quoteAsset: { code: "USDT" },
      }],
    },
    filtersResult: {
      ok: true,
      data: {
        symbol: "HYPEUSDT",
        base: "HYPE",
        quote: "USDT",
        isOpen: "1",
        minVolume: "0.1",
        minPrice: "10",
        basePrecision: "4",
        quotePrecision: "2",
      },
    },
    balancesResult: {
      ok: true,
      data: [
        {
          free: {
            amount: "0.01",
            asset: { code: "HYPE" },
          },
          locked: {
            amount: "0",
            asset: { code: "HYPE" },
          },
        },
        {
          free: {
            amount: "0.01",
            asset: { code: "USDT" },
          },
          locked: {
            amount: "0",
            asset: { code: "USDT" },
          },
        },
      ],
    },
    openOrdersResult: {
      ok: true,
      data: [],
    },
    ...overrides,
  }
}

test("Bitunix order probe preflight accepts all eight cases only with insufficient relevant balances", () => {
  const probeIds = [
    "limit-buy-1",
    "limit-buy-2",
    "limit-sell-1",
    "limit-sell-2",
    "market-buy-1",
    "market-buy-2",
    "market-sell-1",
    "market-sell-2",
  ]

  for (const probeId of probeIds) {
    const preflight = createBitunixOrderProbePreflight(createPreflightInput({
      probeId,
    }))
    assert.equal(preflight.probe.id, probeId)
    assert.equal(preflight.openOrderCount, 0)
    assert.equal(preflight.freeBaseBalance, "0.01")
    assert.equal(preflight.freeQuoteBalance, "0.01")
    assert.equal(preflight.wireRequest.symbol, "HYPEUSDT")
  }
})

test("Bitunix order probe preflight marks below-minimum MARKET amounts without blocking the diagnostic", () => {
  const preflight = createBitunixOrderProbePreflight(createPreflightInput({
    probeId: "market-buy-1",
  }))

  assert.equal(preflight.belowMinimumQuantity, false)
  assert.equal(preflight.belowMinimumNotional, true)
})

test("Bitunix BUY LIMIT probe blocks when free USDT can cover the order notional", () => {
  const input = createPreflightInput({
    probeId: "limit-buy-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [
          {
            free: {
              amount: "0.01",
              asset: { code: "HYPE" },
            },
            locked: {
              amount: "0",
              asset: { code: "HYPE" },
            },
          },
          {
            free: {
              amount: "30",
              asset: { code: "USDT" },
            },
            locked: {
              amount: "0",
              asset: { code: "USDT" },
            },
          },
        ],
      },
    },
  })

  assert.throws(
    () => createBitunixOrderProbePreflight(input),
    /free USDT can cover/i,
  )
})

test("Bitunix SELL LIMIT probe blocks when free HYPE can cover the base quantity", () => {
  const input = createPreflightInput({
    probeId: "limit-sell-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [
          {
            free: {
              amount: "1",
              asset: { code: "HYPE" },
            },
            locked: {
              amount: "0",
              asset: { code: "HYPE" },
            },
          },
          {
            free: {
              amount: "0.01",
              asset: { code: "USDT" },
            },
            locked: {
              amount: "0",
              asset: { code: "USDT" },
            },
          },
        ],
      },
    },
  })

  assert.throws(
    () => createBitunixOrderProbePreflight(input),
    /free HYPE can cover/i,
  )
})

test("Bitunix MARKET probe blocks if either conflicting denomination could be funded", () => {
  const input = createPreflightInput({
    probeId: "market-sell-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [
          {
            free: {
              amount: "0",
              asset: { code: "HYPE" },
            },
            locked: {
              amount: "0",
              asset: { code: "HYPE" },
            },
          },
          {
            free: {
              amount: "1",
              asset: { code: "USDT" },
            },
            locked: {
              amount: "0",
              asset: { code: "USDT" },
            },
          },
        ],
      },
    },
  })

  assert.throws(
    () => createBitunixOrderProbePreflight(input),
    /conflicting documented MARKET volume denominations/i,
  )
})

test("Bitunix SELL LIMIT preflight preserves an unreported HYPE balance as unknown", () => {
  const preflight = createBitunixOrderProbePreflight(createPreflightInput({
    probeId: "limit-sell-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [{
          free: {
            amount: "0.01",
            asset: { code: "USDT" },
          },
          locked: {
            amount: "0",
            asset: { code: "USDT" },
          },
        }],
      },
    },
  }))

  assert.equal(preflight.freeBaseBalance, null)
  assert.equal(preflight.lockedBaseBalance, null)
  assert.equal(preflight.baseBalanceUnreported, true)
  assert.equal(preflight.probe.side, "SELL")
})

test("Bitunix order probe preflight rejects open orders and missing explicit asset balances", () => {
  assert.throws(
    () => createBitunixOrderProbePreflight(createPreflightInput({
      overrides: {
        openOrdersResult: {
          ok: true,
          data: [{ orderId: "open-1" }],
        },
      },
    })),
    /existing open orders/i,
  )

  assert.throws(
    () => createBitunixOrderProbePreflight(createPreflightInput({
      probeId: "market-buy-1",
      overrides: {
        balancesResult: {
          ok: true,
          data: [{
            free: {
              amount: "0",
              asset: { code: "USDT" },
            },
            locked: {
              amount: "0",
              asset: { code: "USDT" },
            },
          }],
        },
      },
    })),
    /explicit HYPE balance row/i,
  )
})

test("Bitunix order probe preflight fails closed on unsuccessful reads and closed markets", () => {
  for (const field of ["marketResult", "filtersResult", "balancesResult", "openOrdersResult"]) {
    assert.throws(
      () => createBitunixOrderProbePreflight(createPreflightInput({
        overrides: {
          [field]: {
            ok: false,
            errors: [new Error("read failed")],
          },
        },
      })),
      /failed/i,
      field,
    )
  }

  assert.throws(
    () => createBitunixOrderProbePreflight(createPreflightInput({
      overrides: {
        filtersResult: {
          ok: true,
          data: {
            symbol: "HYPEUSDT",
            base: "HYPE",
            quote: "USDT",
            isOpen: "0",
            minVolume: "0.1",
            minPrice: "10",
          },
        },
      },
    })),
    /explicitly open/i,
  )
})


test("Bitunix LIMIT probes require only the balance asset they can spend", () => {
  const buy = createBitunixOrderProbePreflight(createPreflightInput({
    probeId: "limit-buy-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [{
          free: {
            amount: "0.01",
            asset: { code: "USDT" },
          },
          locked: {
            amount: "0",
            asset: { code: "USDT" },
          },
        }],
      },
    },
  }))
  const sell = createBitunixOrderProbePreflight(createPreflightInput({
    probeId: "limit-sell-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [{
          free: {
            amount: "0.01",
            asset: { code: "HYPE" },
          },
          locked: {
            amount: "0",
            asset: { code: "HYPE" },
          },
        }],
      },
    },
  }))

  assert.equal(buy.freeBaseBalance, null)
  assert.equal(sell.freeQuoteBalance, null)
})

test("Bitunix MARKET probes require both balances while volume denomination is unresolved", () => {
  const input = createPreflightInput({
    probeId: "market-buy-1",
    overrides: {
      balancesResult: {
        ok: true,
        data: [{
          free: {
            amount: "0.01",
            asset: { code: "USDT" },
          },
          locked: {
            amount: "0",
            asset: { code: "USDT" },
          },
        }],
      },
    },
  })

  assert.throws(
    () => createBitunixOrderProbePreflight(input),
    /explicit HYPE balance row/i,
  )
})


test("funded HYPE BUY calculates base quantity from live precision and confirms the quote budget", () => {
  const input = createPreflightInput({
    probeId: "limit-buy-11-usdt",
    overrides: {
      balancesResult: {
        ok: true,
        data: [{
          free: {
            amount: "11.24",
            asset: { code: "USDT" },
          },
          locked: {
            amount: "0",
            asset: { code: "USDT" },
          },
        }],
      },
    },
  })
  const preflight = createBitunixOrderProbePreflight(input)
  assert.equal(preflight.probe.quantity, "0.3666")
  assert.equal(preflight.probe.quoteNotional, "10.998")
  assert.equal(preflight.orderInput.quantity, "0.3666")
  assert.equal(preflight.wireRequest.volume, "0.3666")
  assert.equal(preflight.freeQuoteBalance, "11.24")
})

test("funded HYPE BUY refuses to dispatch when the 11 USDT budget plus reserve is unavailable", () => {
  const input = createPreflightInput({
    probeId: "limit-buy-11-usdt",
    overrides: {
      balancesResult: {
        ok: true,
        data: [{
          free: {
            amount: "11.23",
            asset: { code: "USDT" },
          },
          locked: {
            amount: "0",
            asset: { code: "USDT" },
          },
        }],
      },
    },
  })
  assert.throws(() => createBitunixOrderProbePreflight(input), /11\.24 USDT/i)
})
