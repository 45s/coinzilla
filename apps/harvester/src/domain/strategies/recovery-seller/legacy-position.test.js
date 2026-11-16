import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { createFillFingerprint } from "../../fills/fill-fingerprint.js"
import * as legacyPosition from "./legacy-position.js"

const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const feeAsset = new Asset({ id: "asset:BNB", code: "BNB" })
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset,
  quoteAsset,
})

function makeLegacySellFill() {
  return new Fill({
    tradeId: "legacy-sell-1",
    brokerOrderId: "legacy-order-1",
    market,
    side: "SELL",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: "3", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "300", asset: quoteAsset }),
    commissions: [
      new Commission({ amount: new Money({ amount: "0.03", asset: baseAsset }) }),
      new Commission({ amount: new Money({ amount: "0.3", asset: quoteAsset }) }),
      new Commission({
        amount: new Money({ amount: "0.03", asset: feeAsset }),
        quoteValue: new Money({ amount: "0.15", asset: quoteAsset }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function makeLegacySellAllocation(fill, {
  allocationFingerprint = "legacy-allocation-fingerprint-1",
  legacy = {
    grossBaseQuantity: "1",
    baseDebit: "1.01",
    quoteProceeds: "100",
    commissions: [
      { assetId: baseAsset.id, assetCode: baseAsset.code, amount: "0.01" },
      { assetId: quoteAsset.id, assetCode: quoteAsset.code, amount: "0.1" },
      {
        assetId: feeAsset.id,
        assetCode: feeAsset.code,
        amount: "0.01",
        quoteValue: {
          assetId: quoteAsset.id,
          assetCode: quoteAsset.code,
          amount: "0.05",
        },
      },
    ],
  },
} = {}) {
  return {
    fillId: fill.id,
    fillFingerprint: createFillFingerprint({ fill }),
    marketId: fill.market.id,
    allocationFingerprint,
    recovery: {
      grossBaseQuantity: "2",
      baseDebit: "2.02",
      quoteProceeds: "200",
      commissions: [
        { assetId: baseAsset.id, assetCode: baseAsset.code, amount: "0.02" },
        { assetId: quoteAsset.id, assetCode: quoteAsset.code, amount: "0.2" },
        {
          assetId: feeAsset.id,
          assetCode: feeAsset.code,
          amount: "0.02",
          quoteValue: {
            assetId: quoteAsset.id,
            assetCode: quoteAsset.code,
            amount: "0.1",
          },
        },
      ],
    },
    legacy,
  }
}

test("creates a legacy position with one fixed average cost and the original remaining quantity", () => {
  assert.equal(typeof legacyPosition.createLegacyPosition, "function", "RS must expose the legacy-position constructor before accounting can begin.")
  assert.equal(typeof legacyPosition.calculateLegacySellQuantity, "function", "RS must expose the per-cycle legacy slice calculation.")
  assert.equal(typeof legacyPosition.recordLegacySale, "function", "RS must expose the successful-cycle legacy quantity transition.")

  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "50",
  })

  assert.deepEqual(position, {
    invested: "100",
    originalQuantity: "50",
    averageCost: "2",
    remainingQuantity: "50",
  }, "The initial legacy position must derive its average cost once from the operator's original invested amount and quantity.")
})

test("reduces remaining legacy quantity by the actual legacy amount sold without recalculating average cost", () => {
  const initialPosition = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "50",
  })

  const nextPosition = legacyPosition.recordLegacySale({
    position: initialPosition,
    quantitySold: "0.01",
  })

  assert.equal(nextPosition.remainingQuantity, "49.99", "A successful cycle must remove only the 0.01 legacy units actually sold.")
  assert.equal(nextPosition.averageCost, "2", "Selling legacy units must never recalculate the original average acquisition cost.")
  assert.equal(nextPosition.invested, "100", "The original invested amount must remain unchanged after a legacy disposal.")
  assert.equal(initialPosition.remainingQuantity, "50", "Recording a disposal must return a new position without mutating the previous accounting snapshot.")
})

test("caps each cycle legacy slice at the smaller remaining quantity", () => {
  const position = {
    invested: "100",
    originalQuantity: "50",
    averageCost: "2",
    remainingQuantity: "0.005",
  }

  assert.equal(
    legacyPosition.calculateLegacySellQuantity({
      remainingQuantity: position.remainingQuantity,
      sellQuantity: "0.01",
    }),
    "0.005",
    "When less than sellQuantity remains, the cycle may include only the smaller remaining legacy quantity.",
  )
})

test("allows recovery-only cycles after legacy inventory is exhausted", () => {
  assert.equal(
    legacyPosition.calculateLegacySellQuantity({
      remainingQuantity: "0",
      sellQuantity: "0.01",
    }),
    "0",
    "An exhausted legacy position contributes zero additional quantity while recovery-only cycles remain possible.",
  )
})

test("rejects invalid original legacy basis and invalid legacy disposals", () => {
  assert.throws(
    () => legacyPosition.createLegacyPosition({
      invested: "0",
      quantity: "50",
    }),
    /invested/i,
    "A legacy position must have a positive original quote investment.",
  )
  assert.throws(
    () => legacyPosition.createLegacyPosition({
      invested: "100",
      quantity: "0",
    }),
    /quantity/i,
    "A legacy position must have a positive original base quantity.",
  )
  assert.throws(
    () => legacyPosition.createLegacyPosition({
      invested: "-1",
      quantity: "50",
    }),
    /invested/i,
    "Negative historical investment must be rejected.",
  )

  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "50",
  })
  assert.throws(
    () => legacyPosition.recordLegacySale({
      position,
      quantitySold: "50.01",
    }),
    /remaining/i,
    "A legacy disposal must never exceed the remaining authorized legacy quantity.",
  )
  assert.throws(
    () => legacyPosition.recordLegacySale({
      position,
      quantitySold: "0",
    }),
    /greater than zero/i,
    "A successful legacy disposal must represent a positive quantity.",
  )
})


test("creates a separate exact-once legacy realized-profit ledger", () => {
  assert.equal(typeof legacyPosition.createLegacyPositionAccounting, "function", "RS must expose the legacy realized-profit ledger constructor.")
  assert.equal(typeof legacyPosition.applyLegacySellAllocation, "function", "RS must expose the legacy allocated-SELL projection.")

  assert.deepEqual(legacyPosition.createLegacyPositionAccounting(), {
    realizedQuoteProceeds: "0",
    realizedCostBasis: "0",
    realizedProfit: "0",
    appliedFillIds: [],
    appliedFillFingerprints: [],
  }, "Legacy realized proceeds, cost basis and profit must start at zero with an empty exact-once ledger.")
})

test("applies legacy base debit, net proceeds and fixed-average-cost realized P&L", () => {
  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "10",
  })
  const accounting = legacyPosition.createLegacyPositionAccounting()
  const fill = makeLegacySellFill()
  const allocation = makeLegacySellAllocation(fill)
  const result = legacyPosition.applyLegacySellAllocation({
    position,
    accounting,
    fill,
    allocation,
  })

  assert.equal(result.position.remainingQuantity, "8.99", "Legacy inventory must decrease by gross quantity plus allocated base commission.")
  assert.equal(result.position.averageCost, "10", "Legacy average cost must remain fixed after a partial disposal.")
  assert.equal(result.position.invested, "100", "Original legacy invested amount must remain unchanged.")
  assert.equal(result.accounting.realizedQuoteProceeds, "99.85", "Legacy proceeds must be net of quote and valued third-asset commissions.")
  assert.equal(result.accounting.realizedCostBasis, "10.1", "Legacy cost basis must include the full base debit, including base commission.")
  assert.equal(result.accounting.realizedProfit, "89.75", "Legacy realized P&L must use net proceeds less consumed historical cost basis.")
  assert.ok(result.accounting.appliedFillIds.includes(fill.id), "The canonical Fill ID must be recorded in the legacy ledger.")
  assert.equal(position.remainingQuantity, "10", "The original legacy Position snapshot must remain immutable.")
  assert.equal(accounting.realizedProfit, "0", "The original legacy accounting snapshot must remain immutable.")
})

test("treats an identical legacy allocation replay as an immutable no-op", () => {
  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "10",
  })
  const accounting = legacyPosition.createLegacyPositionAccounting()
  const fill = makeLegacySellFill()
  const allocation = makeLegacySellAllocation(fill)
  const first = legacyPosition.applyLegacySellAllocation({
    position,
    accounting,
    fill,
    allocation,
  })
  const replay = legacyPosition.applyLegacySellAllocation({
    position: first.position,
    accounting: first.accounting,
    fill,
    allocation,
  })
  assert.equal(replay.position, first.position, "An identical replay must preserve the same legacy Position snapshot.")
  assert.equal(replay.accounting, first.accounting, "An identical replay must preserve the same realized-profit ledger.")
  assert.equal(replay.applied, false, "An identical replay must not apply legacy accounting twice.")
  assert.equal(replay.duplicate, true, "An identical replay must be explicitly classified.")
})

test("rejects changed allocation facts for an already accounted legacy Fill", () => {
  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "10",
  })
  const accounting = legacyPosition.createLegacyPositionAccounting()
  const fill = makeLegacySellFill()
  const allocation = makeLegacySellAllocation(fill)
  const first = legacyPosition.applyLegacySellAllocation({
    position,
    accounting,
    fill,
    allocation,
  })
  assert.throws(
    () => legacyPosition.applyLegacySellAllocation({
      position: first.position,
      accounting: first.accounting,
      fill,
      allocation: {
        ...allocation,
        allocationFingerprint: "changed-allocation-fingerprint",
      },
    }),
    /Conflicting allocation facts reused Fill ID/,
    "A canonical Fill cannot be attributed to a different legacy allocation after accounting.",
  )
})

test("rejects a legacy SELL allocation whose actual base debit exceeds remaining inventory", () => {
  const position = legacyPosition.createLegacyPosition({
    invested: "10",
    quantity: "1",
  })
  const accounting = legacyPosition.createLegacyPositionAccounting()
  const fill = makeLegacySellFill()
  const allocation = makeLegacySellAllocation(fill)
  assert.throws(
    () => legacyPosition.applyLegacySellAllocation({
      position,
      accounting,
      fill,
      allocation,
    }),
    /base quantity negative/,
    "Legacy inventory must not become negative when base commission is included in actual debit.",
  )
})

test("records recovery-only SELL fills without changing exhausted legacy inventory or P&L", () => {
  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "10",
  })
  const accounting = legacyPosition.createLegacyPositionAccounting()
  const fill = makeLegacySellFill()
  const allocation = makeLegacySellAllocation(fill, {
    allocationFingerprint: "recovery-only-allocation",
    legacy: {
      grossBaseQuantity: "0",
      baseDebit: "0",
      quoteProceeds: "0",
      commissions: [
        { assetId: baseAsset.id, assetCode: baseAsset.code, amount: "0" },
        { assetId: quoteAsset.id, assetCode: quoteAsset.code, amount: "0" },
        { assetId: feeAsset.id, assetCode: feeAsset.code, amount: "0" },
      ],
    },
  })
  const result = legacyPosition.applyLegacySellAllocation({
    position,
    accounting,
    fill,
    allocation,
  })
  assert.equal(result.position, position, "A recovery-only SELL must not change legacy inventory.")
  assert.equal(result.accounting.realizedQuoteProceeds, "0", "A recovery-only SELL must not create legacy proceeds.")
  assert.equal(result.accounting.realizedCostBasis, "0", "A recovery-only SELL must not consume legacy cost basis.")
  assert.equal(result.accounting.realizedProfit, "0", "A recovery-only SELL must not change legacy realized P&L.")
  assert.ok(result.accounting.appliedFillIds.includes(fill.id), "The zero legacy allocation must still bind the canonical Fill against later reallocation.")
})
