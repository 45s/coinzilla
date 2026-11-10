import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[recovery-fill-accounting.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { calculateRecoveryFillAccounting } from "./recovery-fill-accounting.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const thirdAsset = new Asset({ id: "asset:BNB", code: "BNB" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function makeFill({
  side = "BUY",
  quantity = "100",
  quoteQuantity = "10",
  commissions = [],
  commissionStatus = "COMPLETE",
} = {}) {
  return new Fill({
    tradeId: "trade-1",
    brokerOrderId: "order-1",
    market,
    side,
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions,
    commissionStatus,
  })
}

test("adds actual quote commission to BUY recovery cost", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "10.02",
    netSellProceeds: "0",
  }, "BUY recovery cost must include the actual quote commission exactly once.")
})

test("does not convert base BUY commission into quote recovery cost", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "10",
    netSellProceeds: "0",
  }, "Base BUY commission changes inventory but must not be converted into quote recovery cost.")
})

test("credits SELL proceeds net of actual quote commission", () => {
  const fill = makeFill({
    side: "SELL",
    quoteQuantity: "12",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.03", asset: quoteAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "0",
    netSellProceeds: "11.97",
  }, "SELL recovery proceeds must subtract the actual quote commission exactly once.")
})

test("does not deduct base SELL commission from quote recovery proceeds", () => {
  const fill = makeFill({
    side: "SELL",
    quoteQuantity: "12",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "0",
    netSellProceeds: "12",
  }, "Base SELL commission must reduce base inventory, not quote recovery proceeds.")
})

test("rejects incomplete commission data and unvalued third-asset fees", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({ commissionStatus: "UNKNOWN" }),
    }),
    /complete commission data/,
    "UNKNOWN commission status must be rejected because its accounting facts are incomplete.",
  )
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        commissions: [
          new Commission({ amount: new Money({ amount: "0.01", asset: thirdAsset }) }),
        ],
      }),
    }),
    /reliable quote-currency valuation/,
    "A third-asset commission without a quote-currency valuation must fail closed.",
  )
})

test("rejects quote commission greater than SELL proceeds", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        side: "SELL",
        quoteQuantity: "0.01",
        commissions: [
          new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
        ],
      }),
    }),
    /exceeds SELL quote proceeds/,
    "A quote commission greater than actual SELL proceeds must be rejected.",
  )
})


test("rejects base commission greater than SELL execution quantity", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        side: "SELL",
        commissions: [
          new Commission({ amount: new Money({ amount: "100.01", asset: baseAsset }) }),
        ],
      }),
    }),
    /base commission exceeds executed base quantity/i,
    "A base commission greater than executed SELL quantity must be rejected.",
  )
})

test("rejects quote commission greater than BUY quote notional", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        quoteQuantity: "0.01",
        commissions: [
          new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
        ],
      }),
    }),
    /quote commission exceeds executed quote notional/i,
    "A quote commission greater than BUY quote notional must be rejected.",
  )
})

test("checks aggregated commissions against the executed amount", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        quoteQuantity: "1",
        commissions: [
          new Commission({ amount: new Money({ amount: "0.6", asset: quoteAsset }) }),
          new Commission({ amount: new Money({ amount: "0.6", asset: quoteAsset }) }),
        ],
      }),
    }),
    /quote commission exceeds executed quote notional/i,
    "Two individually valid 0.6 quote commissions must be aggregated and rejected when their 1.2 total exceeds the 1 quote notional.",
  )
})

test("aggregates multiple base and quote commission entries for BUY cost and SELL proceeds", () => {
  const commissions = [
    new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) }),
    new Commission({ amount: new Money({ amount: "0.2", asset: baseAsset }) }),
    new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
    new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
  ]
  const buyFill = makeFill({ quantity: "1", quoteQuantity: "0.1", commissions })
  const sellFill = makeFill({ side: "SELL", quantity: "1", quoteQuantity: "0.2", commissions })

  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill: buyFill }), {
    buyCost: "0.13",
    netSellProceeds: "0",
  }, "BUY recovery cost must add both quote commission entries (0.01 + 0.02) while excluding base commissions from quote cost.")
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill: sellFill }), {
    buyCost: "0",
    netSellProceeds: "0.17",
  }, "SELL recovery proceeds must subtract both quote commission entries (0.01 + 0.02) while base commissions remain inventory-only.")
})

test("rejects base commission entries whose aggregate exceeds executed quantity", () => {
  const fill = makeFill({
    quantity: "1",
    quoteQuantity: "0.1",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.6", asset: baseAsset }) }),
      new Commission({ amount: new Money({ amount: "0.6", asset: baseAsset }) }),
    ],
  })

  assert.throws(
    () => calculateRecoveryFillAccounting({ market, fill }),
    /base commission exceeds executed base quantity/i,
    "Two individually valid 0.6 base commissions must be aggregated and rejected when their 1.2 total exceeds the 1 base execution.",
  )
})

test("rejects negative commission amounts before accounting", () => {
  const fill = {
    market,
    side: "BUY",
    quantity: new Quantity({ amount: "1", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "0.1", asset: quoteAsset }),
    commissionStatus: "COMPLETE",
    commissions: [{ amount: { amount: "-0.01", asset: quoteAsset } }],
  }

  assert.throws(
    () => calculateRecoveryFillAccounting({ market, fill }),
    /Commission amount must be non-negative/,
    "Negative commission facts must be rejected before they can change recovery accounting.",
  )
})

test("deducts a reliable third-asset quote valuation from SELL proceeds", () => {
  const fill = makeFill({
    side: "SELL",
    quoteQuantity: "12",
    commissions: [new Commission({
      amount: new Money({ amount: "0.01", asset: thirdAsset }),
      quoteValue: new Money({ amount: "0.03", asset: quoteAsset }),
    })],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "0",
    netSellProceeds: "11.97",
  }, "A valid third-asset quote valuation must reduce SELL proceeds by its supplied quote value.")
})
