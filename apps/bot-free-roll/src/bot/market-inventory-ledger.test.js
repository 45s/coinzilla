import test from "node:test"
import assert from "node:assert/strict"
import { calculateFillAccountingExact } from "./helpers/accounting.js"

import {
  appendUnmanagedMovement,
  applyMarketInventoryFill,
  createMarketInventoryLedger,
} from "./market-inventory-ledger.js"

function createMarket(overrides = {}) {
  return {
    symbol: "DOGEUSDT",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
    ...overrides,
  }
}

function createFill(overrides = {}) {
  return {
    id: "trade-1",
    orderId: "order-1",
    symbol: "DOGEUSDT",
    side: "BUY",
    price: "2",
    quantity: "10",
    quoteQuantity: "20",
    commissionAmount: "0",
    commissionAsset: null,
    ...overrides,
  }
}

function createLedger(market = createMarket()) {
  const result = createMarketInventoryLedger({ market })
  assert.equal(result.ok, true)
  return result.ledger
}

function createMovement(overrides = {}) {
  return {
    id: "movement-1",
    symbol: "DOGEUSDT",
    asset: "DOGE",
    source: "deposit",
    amount: "2",
    ...overrides,
  }
}

test("creates an immutable market-scoped ledger with separate unreconciled activity", () => {
  const result = createMarketInventoryLedger({ market: createMarket() })

  assert.equal(result.ok, true)
  assert.equal(Object.isFrozen(result.ledger), true)
  assert.equal(Object.isFrozen(result.ledger.market), true)
  assert.deepEqual(result.ledger.market, createMarket())
  assert.equal(result.ledger.strategy.baseQuantity, "0")
  assert.equal(result.ledger.strategy.quoteCashFlow, "0")
  assert.deepEqual(result.ledger.strategy.commissionsByAsset, [])
  assert.equal(result.ledger.unmanaged.status, "unreconciled")
  assert.deepEqual(result.ledger.unmanaged.byAsset, [])
  assert.deepEqual(result.ledger.unmanaged.movements, [])
})

test("rejects invalid market definitions", () => {
  for (const market of [undefined, null, [], {}, createMarket({ symbol: "" }),
    createMarket({ symbol: 1 }), createMarket({ baseAsset: "" }),
    createMarket({ baseAsset: 1 }), createMarket({ quoteAsset: "" }),
    createMarket({ quoteAsset: 1 }), createMarket({ baseAsset: "USDT" })]) {
    assert.equal(createMarketInventoryLedger({ market }).ok, false)
  }
})

test("applies a buy fill as base inventory and negative quote cash flow", () => {
  const ledger = createLedger()
  const fill = createFill()
  const result = applyMarketInventoryFill({ ledger, fill })

  assert.equal(result.ok, true)
  assert.equal(result.accounting.baseQuantity, "10")
  assert.equal(result.accounting.quoteQuantity, "20")
  assert.equal(result.ledger.strategy.baseQuantity, "10")
  assert.equal(result.ledger.strategy.quoteCashFlow, "-20")
  assert.equal(result.ledger.fillCount, 1)
  assert.deepEqual(result.ledger.processedTradeIds, ["trade-1"])
  assert.equal(ledger.strategy.baseQuantity, "0")
  assert.equal(ledger.fillCount, 0)
})

test("accepts the already-validated exact accounting projection", () => {
  const fill = createFill()
  const accounting = calculateFillAccountingExact({
    side: fill.side,
    quantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    commissionAmount: fill.commissionAmount,
    commissionAsset: fill.commissionAsset,
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  })
  const result = applyMarketInventoryFill({
    ledger: createLedger(),
    fill,
    accounting,
  })

  assert.equal(result.ok, true)
  assert.equal(result.ledger.strategy.baseQuantity, "10")
  assert.equal(result.ledger.strategy.quoteCashFlow, "-20")
})

test("rejects an invalid supplied accounting projection", () => {
  const result = applyMarketInventoryFill({
    ledger: createLedger(),
    fill: createFill(),
    accounting: { baseQuantity: "0", quoteQuantity: "1" },
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /accounting is invalid/)
})

test("rejects malformed supplied accounting and unsupported supplied commission facts", () => {
  const ledger = createLedger()
  const fill = createFill()
  const accounting = calculateFillAccountingExact({
    side: fill.side,
    quantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    commissionAmount: fill.commissionAmount,
    commissionAsset: fill.commissionAsset,
    baseAsset: "DOGE",
    quoteAsset: "USDT",
  })
  const malformedAccounting = applyMarketInventoryFill({
    ledger,
    fill,
    accounting: { baseQuantity: "bad", quoteQuantity: "1" },
  })
  const negativeCommission = applyMarketInventoryFill({
    ledger,
    fill: createFill({ commissionAmount: "-0.01", commissionAsset: "DOGE" }),
    accounting,
  })
  const thirdAsset = applyMarketInventoryFill({
    ledger,
    fill: createFill({ commissionAmount: "0.01", commissionAsset: "BNB" }),
    accounting,
  })

  assert.equal(malformedAccounting.ok, false)
  assert.match(malformedAccounting.reason, /accounting is invalid/)
  assert.equal(negativeCommission.ok, false)
  assert.match(negativeCommission.reason, /Negative commission/)
  assert.equal(thirdAsset.ok, false)
  assert.match(thirdAsset.reason, /Unsupported commission asset/)
})

test("applies base and quote commissions to their own asset totals", () => {
  const ledger = createLedger()
  const baseFee = applyMarketInventoryFill({
    ledger,
    fill: createFill({
      commissionAmount: "0.1",
      commissionAsset: "DOGE",
    }),
  })
  const quoteFee = applyMarketInventoryFill({
    ledger: baseFee.ledger,
    fill: createFill({
      id: "trade-2",
      side: "SELL",
      price: "3",
      quantity: "2",
      quoteQuantity: "6",
      commissionAmount: "0.03",
      commissionAsset: "USDT",
    }),
  })

  assert.equal(baseFee.ledger.strategy.baseQuantity, "9.9")
  assert.equal(baseFee.ledger.strategy.quoteCashFlow, "-20")
  assert.equal(quoteFee.ledger.strategy.baseQuantity, "7.9")
  assert.equal(quoteFee.ledger.strategy.quoteCashFlow, "-14.03")
  assert.deepEqual(quoteFee.ledger.strategy.commissionsByAsset, [
    { asset: "DOGE", amount: "0.1" },
    { asset: "USDT", amount: "0.03" },
  ])
})

test("rejects fills from another market instead of mixing pair inventory", () => {
  const result = applyMarketInventoryFill({
    ledger: createLedger(),
    fill: createFill({ symbol: "DOGEFDUSD" }),
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /does not match DOGEUSDT/)
})

test("rejects duplicate fills and unstable fill identifiers", () => {
  const ledger = createLedger()
  const first = applyMarketInventoryFill({ ledger, fill: createFill() })
  const duplicate = applyMarketInventoryFill({ ledger: first.ledger, fill: createFill() })
  const invalid = applyMarketInventoryFill({
    ledger,
    fill: createFill({ id: "", orderId: "order-2" }),
  })

  assert.equal(duplicate.ok, false)
  assert.match(duplicate.reason, /already contains trade/)
  assert.equal(invalid.ok, false)
  assert.match(invalid.reason, /stable trade and order IDs/)
})

test("rejects invalid ledger shapes and fill payloads", () => {
  const ledger = createLedger()
  const invalidLedgers = [
    null,
    [],
    { ...ledger, market: null },
    { ...ledger, market: { ...ledger.market, symbol: 1 } },
    { ...ledger, market: { ...ledger.market, baseAsset: 1 } },
    { ...ledger, market: { ...ledger.market, quoteAsset: 1 } },
    { ...ledger, strategy: null },
    { ...ledger, strategy: { ...ledger.strategy, baseQuantity: 1 } },
    { ...ledger, strategy: { ...ledger.strategy, quoteCashFlow: 1 } },
    { ...ledger, strategy: { ...ledger.strategy, commissionsByAsset: null } },
    { ...ledger, processedTradeIds: null },
    { ...ledger, unmanaged: null },
    { ...ledger, unmanaged: { ...ledger.unmanaged, byAsset: null } },
    { ...ledger, unmanaged: { ...ledger.unmanaged, movements: null } },
    { ...ledger, fillCount: -1 },
    { ...ledger, fillCount: "0" },
  ]
  for (const invalidLedger of invalidLedgers) {
    assert.equal(applyMarketInventoryFill({ ledger: invalidLedger, fill: createFill() }).ok, false)
  }

  for (const fill of [null, [], createFill({ id: "" }), createFill({ id: "-1" }),
    createFill({ id: "undefined" }), createFill({ orderId: "" }),
    createFill({ orderId: "undefined" }), createFill({ side: "HOLD" })]) {
    assert.equal(applyMarketInventoryFill({ ledger, fill }).ok, false)
  }
})

test("rejects unsupported commissions and malformed execution quantities", () => {
  const ledger = createLedger()
  const unsupported = applyMarketInventoryFill({
    ledger,
    fill: createFill({ commissionAmount: "0.01", commissionAsset: "BNB" }),
  })
  const malformed = applyMarketInventoryFill({
    ledger,
    fill: createFill({ quantity: "bad" }),
  })

  assert.equal(unsupported.ok, false)
  assert.match(unsupported.reason, /Invalid market fill accounting/)
  assert.equal(malformed.ok, false)
  assert.match(malformed.reason, /Invalid market fill accounting/)
})

test("rejects a sell that would make strategy-owned base inventory negative", () => {
  const result = applyMarketInventoryFill({
    ledger: createLedger(),
    fill: createFill({
      side: "SELL",
      quantity: "1",
      quoteQuantity: "2",
    }),
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /would make strategy inventory negative/)
})

test("records explicit unmanaged movements without changing strategy inventory", () => {
  const ledger = createLedger()
  const first = appendUnmanagedMovement({ ledger, movement: createMovement() })
  const second = appendUnmanagedMovement({
    ledger: first.ledger,
    movement: createMovement({
      id: "movement-2",
      source: "withdrawal",
      amount: "-0.5",
    }),
  })
  const third = appendUnmanagedMovement({
    ledger: second.ledger,
    movement: createMovement({
      id: "movement-3",
      asset: "USDT",
      source: "withdrawal",
      amount: "-5",
    }),
  })

  assert.equal(third.ok, true)
  assert.equal(third.ledger.strategy.baseQuantity, "0")
  assert.equal(third.ledger.strategy.quoteCashFlow, "0")
  assert.deepEqual(third.ledger.unmanaged.byAsset, [
    { asset: "DOGE", amount: "1.5" },
    { asset: "USDT", amount: "-5" },
  ])
  assert.equal(second.ledger.unmanaged.status, "unreconciled")
  assert.equal(ledger.unmanaged.movements.length, 0)
  assert.equal(Object.isFrozen(third.ledger.unmanaged.movements), true)
})

test("deduplicates identical unmanaged movements and rejects changed source facts", () => {
  const first = appendUnmanagedMovement({
    ledger: createLedger(),
    movement: createMovement({ amount: "2.0" }),
  })
  const duplicate = appendUnmanagedMovement({
    ledger: first.ledger,
    movement: createMovement({ amount: "2.00" }),
  })
  const conflict = appendUnmanagedMovement({
    ledger: first.ledger,
    movement: createMovement({ amount: "3" }),
  })

  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.ledger, first.ledger)
  assert.equal(conflict.ok, false)
  assert.match(conflict.reason, /Conflicting unmanaged movement facts/)
})

test("rejects unmanaged movement IDs that are not stable", () => {
  const ledger = createLedger()
  for (const movement of [
    createMovement({ id: "" }),
    createMovement({ id: "-1" }),
    createMovement({ id: "undefined" }),
  ]) {
    assert.equal(appendUnmanagedMovement({ ledger, movement }).ok, false)
  }
})

test("rejects conflicting unmanaged source, asset, and stored market facts", () => {
  const first = appendUnmanagedMovement({
    ledger: createLedger(),
    movement: createMovement(),
  })
  const sourceConflict = appendUnmanagedMovement({
    ledger: first.ledger,
    movement: createMovement({ source: "manual" }),
  })
  const assetConflict = appendUnmanagedMovement({
    ledger: first.ledger,
    movement: createMovement({ asset: "USDT" }),
  })
  const corruptedLedger = {
    ...first.ledger,
    unmanaged: {
      ...first.ledger.unmanaged,
      movements: [
        Object.freeze({ ...first.ledger.unmanaged.movements[0], symbol: "OTHER" }),
      ],
    },
  }
  const marketConflict = appendUnmanagedMovement({
    ledger: corruptedLedger,
    movement: createMovement(),
  })

  assert.equal(sourceConflict.ok, false)
  assert.equal(assetConflict.ok, false)
  assert.equal(marketConflict.ok, false)
})

test("rejects unmanaged movements with unknown markets, assets, or invalid amounts", () => {
  const ledger = createLedger()
  const wrongMarket = appendUnmanagedMovement({
    ledger,
    movement: createMovement({ symbol: "DOGEFDUSD" }),
  })
  const wrongAsset = appendUnmanagedMovement({
    ledger,
    movement: createMovement({ asset: "BNB" }),
  })
  const invalidAmount = appendUnmanagedMovement({
    ledger,
    movement: createMovement({ amount: "not-a-number" }),
  })
  const zeroAmount = appendUnmanagedMovement({
    ledger,
    movement: createMovement({ amount: "0.00" }),
  })
  const missingSource = appendUnmanagedMovement({
    ledger,
    movement: createMovement({ source: "" }),
  })

  assert.equal(wrongMarket.ok, false)
  assert.equal(wrongAsset.ok, false)
  assert.equal(invalidAmount.ok, false)
  assert.equal(zeroAmount.ok, false)
  assert.equal(missingSource.ok, false)
})

test("rejects malformed unmanaged movement inputs and ledgers", () => {
  assert.equal(appendUnmanagedMovement({ ledger: null, movement: createMovement() }).ok, false)
  assert.equal(appendUnmanagedMovement({ ledger: createLedger(), movement: null }).ok, false)
  assert.equal(appendUnmanagedMovement({ ledger: createLedger(), movement: [] }).ok, false)
})
