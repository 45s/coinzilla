import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import {
  TradingRules,
  tradingRulesErrMsgs,
  TRADING_RULE_STATUSES,
} from "./trading-rules.js"

describe(TradingRules.name, () => {
  const btc = new Asset({ id: "bitcoin", code: "BTC" })
  const usd = new Asset({ id: "usd", code: "USD" })
  const otherBtc = new Asset({ id: "wrapped-bitcoin", code: "BTC" })
  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset: btc,
    quoteAsset: usd,
  })
  const money = (amount, asset = usd) => new Money({ amount, asset })
  const quantity = (amount, asset = btc) => new Quantity({ amount, asset })

  it("stores supported price, quantity, and notional constraints", () => {
    const rules = new TradingRules({
      market,
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: money("0.01") },
        { type: "MIN_PRICE", status: "SUPPORTED", value: money("1") },
        { type: "MAX_PRICE", status: "SUPPORTED", value: money("100000") },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: quantity("0.00001") },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: quantity("0.0001") },
        { type: "MAX_QUANTITY", status: "SUPPORTED", value: quantity("100") },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: money("5") },
        { type: "MAX_NOTIONAL", status: "SUPPORTED", value: money("1000000") },
      ],
    })

    assert.strictEqual(rules.market, market)
    assert.equal(rules.constraints.length, 8)
    assert.deepEqual(rules.value, {
      market: market.value,
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: money("0.01").value },
        { type: "MIN_PRICE", status: "SUPPORTED", value: money("1").value },
        { type: "MAX_PRICE", status: "SUPPORTED", value: money("100000").value },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: quantity("0.00001").value },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: quantity("0.0001").value },
        { type: "MAX_QUANTITY", status: "SUPPORTED", value: quantity("100").value },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: money("5").value },
        { type: "MAX_NOTIONAL", status: "SUPPORTED", value: money("1000000").value },
      ],
    })
  })

  it("represents unsupported, dynamic, and unknown constraints explicitly", () => {
    const rules = new TradingRules({
      market,
      constraints: [
        { type: "PRICE_INCREMENT", status: "UNKNOWN" },
        { type: "MIN_PRICE", status: "UNSUPPORTED" },
        { type: "MAX_PRICE", status: "DYNAMIC" },
      ],
    })

    assert.deepEqual(
      rules.value.constraints,
      [
        { type: "PRICE_INCREMENT", status: "UNKNOWN" },
        { type: "MIN_PRICE", status: "UNSUPPORTED" },
        { type: "MAX_PRICE", status: "DYNAMIC" },
      ],
    )
    assert.deepEqual(TRADING_RULE_STATUSES, ["SUPPORTED", "UNSUPPORTED", "DYNAMIC", "UNKNOWN"])
  })

  it("allows an empty constraint set without implying that any constraint is unsupported", () => {
    const rules = new TradingRules({ market })

    assert.deepEqual(rules.value.constraints, [])
  })

  it("rejects invalid market and constraint collections", () => {
    for (const invalidMarket of [undefined, null, "BTCUSDT"]) {
      assert.throws(() => new TradingRules({ market: invalidMarket }), {
        message: tradingRulesErrMsgs.market,
      })
    }
    for (const constraints of [null, {}, "rules", [undefined]]) {
      assert.throws(() => new TradingRules({ market, constraints }), {
        message: tradingRulesErrMsgs.constraints,
      })
    }
  })

  it("rejects unsupported constraint types and statuses", () => {
    assert.throws(
      () => new TradingRules({ market, constraints: [{ type: "BINANCE_FILTER", status: "UNKNOWN" }] }),
      { message: tradingRulesErrMsgs.type },
    )
    assert.throws(
      () => new TradingRules({ market, constraints: [{ type: "MIN_PRICE", status: "MAYBE" }] }),
      { message: tradingRulesErrMsgs.status },
    )
  })

  it("requires exact typed values for supported constraints", () => {
    for (const value of [undefined, null, "0.01", quantity("0.01")]) {
      assert.throws(
        () => new TradingRules({
          market,
          constraints: [{ type: "PRICE_INCREMENT", status: "SUPPORTED", value }],
        }),
        { message: tradingRulesErrMsgs.value },
      )
    }
  })

  it("requires quote assets for price and notional values and base assets for quantity values", () => {
    assert.throws(
      () => new TradingRules({
        market,
        constraints: [{ type: "PRICE_INCREMENT", status: "SUPPORTED", value: money("0.01", btc) }],
      }),
      { message: tradingRulesErrMsgs.asset },
    )
    assert.throws(
      () => new TradingRules({
        market,
        constraints: [{ type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: quantity("0.01", otherBtc) }],
      }),
      { message: tradingRulesErrMsgs.asset },
    )
  })

  it("rejects values on unsupported, dynamic, or unknown constraints", () => {
    for (const status of ["UNSUPPORTED", "DYNAMIC", "UNKNOWN"]) {
      assert.throws(
        () => new TradingRules({
          market,
          constraints: [{ type: "MIN_PRICE", status, value: money("1") }],
        }),
        { message: tradingRulesErrMsgs.unsupportedValue },
      )
    }
  })

  it("rejects negative values and zero increments", () => {
    assert.throws(
      () => new TradingRules({
        market,
        constraints: [{ type: "MIN_PRICE", status: "SUPPORTED", value: money("-1") }],
      }),
      { message: tradingRulesErrMsgs.negativeValue },
    )
    assert.throws(
      () => new TradingRules({
        market,
        constraints: [{ type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: quantity("0") }],
      }),
      { message: tradingRulesErrMsgs.positiveIncrement },
    )
  })

  it("rejects duplicate constraint types", () => {
    assert.throws(
      () => new TradingRules({
        market,
        constraints: [
          { type: "MIN_PRICE", status: "UNKNOWN" },
          { type: "MIN_PRICE", status: "DYNAMIC" },
        ],
      }),
      { message: tradingRulesErrMsgs.duplicate },
    )
  })

  it("rejects inverted minimum and maximum bounds", () => {
    for (const [minimum, maximum, valueFactory] of [
      ["MIN_PRICE", "MAX_PRICE", money],
      ["MIN_QUANTITY", "MAX_QUANTITY", quantity],
      ["MIN_NOTIONAL", "MAX_NOTIONAL", money],
    ]) {
      assert.throws(
        () => new TradingRules({
          market,
          constraints: [
            { type: minimum, status: "SUPPORTED", value: valueFactory("10") },
            { type: maximum, status: "SUPPORTED", value: valueFactory("2") },
          ],
        }),
        { message: `TradingRules.${minimum} cannot exceed ${maximum}` },
      )
    }
  })

  it("allows equal minimum and maximum bounds", () => {
    const rules = new TradingRules({
      market,
      constraints: [
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: money("5") },
        { type: "MAX_NOTIONAL", status: "SUPPORTED", value: money("5") },
      ],
    })

    assert.equal(rules.constraints.length, 2)
  })

  it("returns independent snapshots and immutable constraint collections", () => {
    const rules = new TradingRules({
      market,
      constraints: [{ type: "MIN_PRICE", status: "SUPPORTED", value: money("1") }],
    })
    const snapshot = rules.value

    snapshot.market.symbol = "ETHUSDT"
    snapshot.constraints[0].value.amount = "999"

    assert.equal(rules.value.market.symbol, "BTCUSDT")
    assert.equal(rules.value.constraints[0].value.amount, "1")
    assert.throws(() => {
      rules.constraints.push({ type: "MAX_PRICE", status: "UNKNOWN" })
    }, TypeError)
    assert.throws(() => {
      rules.constraints[0].status = "UNKNOWN"
    }, TypeError)
  })
})
