import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Asset } from "../assets/asset.js"
import { Market, marketErrMsgs } from "./market.js"

describe(Market.name, () => {
  const baseAsset = new Asset({ id: "dogecoin", code: "DOGE" })
  const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })

  const createMarket = (overrides = {}) =>
    new Market({
      venue: " Binance ",
      symbol: "DOGEFDUSD",
      baseAsset,
      quoteAsset,
      ...overrides,
    })

  it("normalizes venue and exposes explicit base/quote assets", () => {
    const market = createMarket()

    assert.equal(market.id, "binance:DOGEFDUSD")
    assert.equal(market.venue, "binance")
    assert.equal(market.symbol, "DOGEFDUSD")
    assert.strictEqual(market.baseAsset, baseAsset)
    assert.strictEqual(market.quoteAsset, quoteAsset)
    assert.deepEqual(market.value, {
      id: "binance:DOGEFDUSD",
      venue: "binance",
      symbol: "DOGEFDUSD",
      baseAsset: { id: "dogecoin", code: "DOGE" },
      quoteAsset: { id: "fdusd", code: "FDUSD" },
    })
  })

  it("does not infer base and quote assets by parsing the venue symbol", () => {
    const market = createMarket({
      symbol: "CUSTOM-MARKET-CODE",
    })

    assert.equal(market.symbol, "CUSTOM-MARKET-CODE")
    assert.equal(market.baseAsset.id, "dogecoin")
    assert.equal(market.quoteAsset.id, "fdusd")
  })

  it("distinguishes the same symbol listed on different venues", () => {
    const first = createMarket({ venue: "binance" })
    const second = createMarket({ venue: "other-exchange" })

    assert.notEqual(first.id, second.id)
    assert.equal(first.symbol, second.symbol)
  })

  it("rejects missing, non-string, blank, or ambiguous venue values", () => {
    for (const venue of [undefined, null, "", "  ", 1, "binance:spot"]) {
      assert.throws(() => createMarket({ venue }), {
        message: marketErrMsgs.venue,
      })
    }
  })

  it("rejects missing, non-string, or blank symbols", () => {
    for (const symbol of [undefined, null, "", "  ", 1]) {
      assert.throws(() => createMarket({ symbol }), {
        message: marketErrMsgs.symbol,
      })
    }
  })

  it("preserves symbols containing delimiters as opaque venue metadata", () => {
    const market = createMarket({ symbol: "BTC:USDT:SPOT" })

    assert.equal(market.symbol, "BTC:USDT:SPOT")
    assert.equal(market.id, "binance:BTC:USDT:SPOT")
  })

  it("requires canonical Asset instances for both sides", () => {
    assert.throws(() => createMarket({ baseAsset: { id: "dogecoin", code: "DOGE" } }), {
      message: marketErrMsgs.baseAsset,
    })
    assert.throws(() => createMarket({ quoteAsset: null }), {
      message: marketErrMsgs.quoteAsset,
    })
  })

  it("rejects a market that quotes an asset against itself", () => {
    const sameAsset = new Asset({ id: "dogecoin", code: "DOGE" })

    assert.throws(
      () => createMarket({ baseAsset: sameAsset, quoteAsset: sameAsset }),
      { message: marketErrMsgs.sameAssets },
    )
  })

  it("rejects distinct Asset instances with the same canonical identity", () => {
    const duplicateQuoteAsset = new Asset({ id: "dogecoin", code: "DOGE" })

    assert.throws(
      () => createMarket({ quoteAsset: duplicateQuoteAsset }),
      { message: marketErrMsgs.sameAssets },
    )
  })

  it("returns an independent nested value snapshot", () => {
    const market = createMarket()
    const snapshot = market.value

    snapshot.baseAsset.code = "XXX"
    snapshot.quoteAsset.id = "other"

    assert.equal(market.baseAsset.code, "DOGE")
    assert.equal(market.quoteAsset.id, "fdusd")
    assert.notStrictEqual(market.value, snapshot)
  })

  it("is immutable", () => {
    const market = createMarket()

    assert.throws(() => {
      market.symbol = "OTHER"
    }, TypeError)
  })
})
