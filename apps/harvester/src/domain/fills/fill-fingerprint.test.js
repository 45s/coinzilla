import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { createFillFingerprint } from "./fill-fingerprint.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function makeFill(overrides = {}) {
  return new Fill({
    tradeId: "trade-1",
    brokerOrderId: "order-1",
    clientOrderId: "client-1",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: "100", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 100,
    commissions: [],
    commissionStatus: "COMPLETE",
    ...overrides,
  })
}

const fingerprint = (fill) => createFillFingerprint({ fill })

test("fingerprint includes every mutable canonical execution fact", () => {
  const original = makeFill()
  const originalFingerprint = fingerprint(original)
  const changes = [
    ["brokerOrderId", "order-2"],
    ["clientOrderId", "client-2"],
    ["side", "SELL"],
    ["price", new Money({ amount: "0.2", asset: quoteAsset })],
    ["quantity", new Quantity({ amount: "101", asset: baseAsset })],
    ["quoteQuantity", new Money({ amount: "10.1", asset: quoteAsset })],
    ["liquidityRole", "TAKER"],
    ["executedAt", 101],
    ["commissions", [
      new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
    ]],
    ["commissionStatus", "UNKNOWN"],
  ]

  for (const [field, value] of changes) {
    const changed = makeFill({ [field]: value })
    assert.equal(changed.id, original.id, field + " must preserve the canonical execution identity")
    assert.notEqual(fingerprint(changed), originalFingerprint, field + " must change the execution fingerprint")
  }
})

test("fingerprint is stable when commission entries arrive in a different order", () => {
  const baseFee = new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) })
  const quoteFee = new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) })
  const first = makeFill({ commissions: [baseFee, quoteFee] })
  const reordered = makeFill({ commissions: [quoteFee, baseFee] })

  assert.equal(first.id, reordered.id)
  assert.equal(fingerprint(first), fingerprint(reordered))
})

test("identical canonical executions produce identical fingerprints", () => {
  assert.equal(fingerprint(makeFill()), fingerprint(makeFill()))
})
