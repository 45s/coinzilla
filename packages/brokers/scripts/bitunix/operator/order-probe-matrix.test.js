import assert from "node:assert/strict"
import test from "node:test"
import { createSpotOrderRequest } from "../../../src/infrastructure/bitunix/spot/adapters/order-requests.js"
import {
  BITUNIX_ORDER_PROBE_IDS,
  createBitunixOrderProbeInput,
  getBitunixOrderProbe,
} from "./order-probe-matrix.js"

const EXPECTED_PROBES = [
  ["limit-buy-1", "BUY", "LIMIT", "1", "30", 2, 1, "1", "30"],
  ["limit-buy-2", "BUY", "LIMIT", "2", "30", 2, 1, "2", "30"],
  ["limit-sell-1", "SELL", "LIMIT", "1", "30", 1, 1, "1", "30"],
  ["limit-sell-2", "SELL", "LIMIT", "2", "30", 1, 1, "2", "30"],
  ["market-buy-1", "BUY", "MARKET", "1", undefined, 2, 2, "1", "0"],
  ["market-buy-2", "BUY", "MARKET", "2", undefined, 2, 2, "2", "0"],
  ["market-sell-1", "SELL", "MARKET", "1", undefined, 1, 2, "1", "0"],
  ["market-sell-2", "SELL", "MARKET", "2", undefined, 1, 2, "2", "0"],
]

test("Bitunix order probe matrix contains the eight explicitly reviewed first-pass cases", () => {
  assert.deepEqual(BITUNIX_ORDER_PROBE_IDS, EXPECTED_PROBES.map(([id]) => id))
})

test("each Bitunix probe maps through createOrder() to the expected REST wire values", () => {
  for (const [id, side, type, amount, price, wireSide, wireType, wireVolume, wirePrice] of EXPECTED_PROBES) {
    const input = createBitunixOrderProbeInput({
      probeId: id,
    })
    const request = createSpotOrderRequest({
      input,
    })

    assert.equal(input.symbol, "HYPEUSDT", id)
    assert.equal(input.side, side, id)
    assert.equal(input.type, type, id)
    if (type === "LIMIT") {
      assert.equal(input.quantity, amount, id)
      assert.equal(input.price, price, id)
      assert.equal(Object.hasOwn(input, "quoteQuantity"), false, id)
    } else {
      assert.equal(input.quoteQuantity, amount, id)
      assert.equal(Object.hasOwn(input, "quantity"), false, id)
      assert.equal(Object.hasOwn(input, "price"), false, id)
    }
    assert.deepEqual(request.body, {
      symbol: "HYPEUSDT",
      side: wireSide,
      type: wireType,
      volume: wireVolume,
      price: wirePrice,
    }, id)
  }
})

test("Bitunix order probe lookup rejects unknown identifiers before any broker can be constructed", () => {
  assert.throws(
    () => getBitunixOrderProbe({
      probeId: "unknown-probe",
    }),
    /unsupported Bitunix order probe/i,
  )
  assert.throws(
    () => createBitunixOrderProbeInput({
      probeId: "",
    }),
    /probe id/i,
  )
})
