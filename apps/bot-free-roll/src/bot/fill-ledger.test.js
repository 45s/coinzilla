import test from "node:test"
import assert from "node:assert/strict"

import {
  appendFillLedgerEntry,
  createFillLedgerEntry,
} from "./fill-ledger.js"

function createFill(overrides = {}) {
  return {
    id: "trade-1",
    orderId: "order-1",
    symbol: "DOGEUSDT",
    side: "BUY",
    price: "2.00",
    quantity: "10",
    quoteQuantity: "20",
    commissionAmount: "0",
    commissionAsset: null,
    isMaker: true,
    ...overrides,
  }
}

test("creates a frozen exact-decimal snapshot with stable source identifiers", () => {
  const fill = createFill()
  const result = createFillLedgerEntry({ fill })

  assert.equal(result.ok, true)
  assert.deepEqual(result.entry, fill)
  assert.equal(Object.isFrozen(result.entry), true)
  assert.equal(typeof result.entry.price, "string")
  assert.equal(Object.isFrozen(fill), false)
})

test("normalizes optional facts without inventing financial values", () => {
  const result = createFillLedgerEntry({
    fill: createFill({
      symbol: undefined,
      side: undefined,
      price: undefined,
      quantity: null,
      quoteQuantity: undefined,
      commissionAmount: undefined,
      commissionAsset: undefined,
      isMaker: undefined,
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.entry.symbol, null)
  assert.equal(result.entry.side, null)
  assert.equal(result.entry.price, null)
  assert.equal(result.entry.quantity, null)
  assert.equal(result.entry.quoteQuantity, null)
  assert.equal(result.entry.commissionAmount, null)
  assert.equal(result.entry.commissionAsset, null)
  assert.equal(result.entry.isMaker, null)
})

test("treats zero-fee asset metadata as economically irrelevant", () => {
  const first = appendFillLedgerEntry({
    entries: Object.freeze([]),
    fill: createFill({ commissionAsset: "BNB" }),
  })
  const repeated = appendFillLedgerEntry({
    entries: first.entries,
    fill: createFill({ commissionAsset: null }),
  })

  assert.equal(first.ok, true)
  assert.equal(first.entry.commissionAsset, null)
  assert.equal(repeated.ok, true)
  assert.equal(repeated.duplicate, true)
})

test("preserves commission asset facts when the reported amount is malformed", () => {
  const result = createFillLedgerEntry({
    fill: createFill({ commissionAmount: "invalid-fee", commissionAsset: "BNB" }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.entry.commissionAmount, "invalid-fee")
  assert.equal(result.entry.commissionAsset, "BNB")
})

test("rejects missing, primitive, array, and unstable fill identities", () => {
  for (const fill of [undefined, null, "fill", [], createFill({ id: "" }),
    createFill({ id: "-1" }), createFill({ id: "undefined" }),
    createFill({ orderId: "" }), createFill({ orderId: "undefined" })]) {
    assert.equal(createFillLedgerEntry({ fill }).ok, false)
  }
})

test("rejects non-array ledgers and invalid entries before appending", () => {
  assert.equal(appendFillLedgerEntry({ entries: null, fill: createFill() }).ok, false)
  assert.equal(appendFillLedgerEntry({ entries: [], fill: null }).ok, false)
})

test("appends immutably and freezes both the entry and the new ledger", () => {
  const original = []
  const result = appendFillLedgerEntry({ entries: original, fill: createFill() })

  assert.equal(result.ok, true)
  assert.equal(result.duplicate, false)
  assert.equal(original.length, 0)
  assert.equal(result.entries.length, 1)
  assert.equal(Object.isFrozen(result.entries), true)
  assert.equal(Object.isFrozen(result.entry), true)
})

test("keeps an already frozen ledger and treats identical repeated fills as duplicates", () => {
  const first = appendFillLedgerEntry({
    entries: Object.freeze([]),
    fill: createFill(),
  })
  const repeated = appendFillLedgerEntry({
    entries: first.entries,
    fill: createFill(),
  })

  assert.equal(repeated.ok, true)
  assert.equal(repeated.duplicate, true)
  assert.equal(repeated.entries, first.entries)
  assert.equal(repeated.entries.length, 1)
})

test("rejects reuse of a trade ID when any recorded execution fact changes", () => {
  const first = appendFillLedgerEntry({
    entries: Object.freeze([]),
    fill: createFill(),
  })
  const conflict = appendFillLedgerEntry({
    entries: first.entries,
    fill: createFill({ quantity: "9", quoteQuantity: "18" }),
  })

  assert.equal(conflict.ok, false)
  assert.match(conflict.reason, /Conflicting facts for trade trade-1/)
  assert.equal(first.entries.length, 1)
})

test("appends a distinct trade to an immutable ledger", () => {
  const first = appendFillLedgerEntry({
    entries: Object.freeze([]),
    fill: createFill(),
  })
  const second = appendFillLedgerEntry({
    entries: first.entries,
    fill: createFill({ id: "trade-2", quantity: "3", quoteQuantity: "6" }),
  })

  assert.equal(second.ok, true)
  assert.equal(second.duplicate, false)
  assert.equal(second.entries.length, 2)
  assert.deepEqual(second.entries.map((entry) => entry.id), ["trade-1", "trade-2"])
  assert.equal(Object.isFrozen(second.entries), true)
})
