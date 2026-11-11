import test from "node:test"
import assert from "node:assert/strict"

import {
  createVolatilityProtectionState,
  transitionVolatilityProtection,
  VOLATILITY_PROTECTION_MODES,
} from "./volatility-protection-state.js"

function snapshot({ ratio = "1", openTime = 60_000, ready = true, reason = null } = {}) {
  return {
    ok: true,
    data: {
      status: { isReady: ready, reason },
      metrics: ready ? {
        openTime,
        atr: "1",
        natr: "1",
        referenceNatr: "1",
        volatilityRatio: ratio,
      } : null,
    },
  }
}

test("starts protected and fails closed when candle data is unavailable", () => {
  const initial = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  assert.equal(initial.mode, VOLATILITY_PROTECTION_MODES.PROTECTED)

  const result = transitionVolatilityProtection({
    state: initial,
    snapshot: snapshot({ ready: false, reason: "STALE_STREAM" }),
  })
  assert.equal(result.state.mode, VOLATILITY_PROTECTION_MODES.PROTECTED)
  assert.equal(result.state.reason, "STALE_STREAM")
  assert.equal(result.state.stableCandleCount, 0)
})

test("protects at the inclusive high-volatility threshold", () => {
  const initial = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  const result = transitionVolatilityProtection({
    state: initial,
    snapshot: snapshot({ ratio: "2" }),
  })
  assert.equal(result.state.mode, VOLATILITY_PROTECTION_MODES.PROTECTED)
  assert.equal(result.state.reason, "HIGH_VOLATILITY")
  assert.equal(result.enteredProtected, false, "Startup is already protected before the first valid snapshot.")
})

test("counts each completed stable candle once and resumes after three", () => {
  let state = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  for (const openTime of [60_000, 120_000, 180_000]) {
    const result = transitionVolatilityProtection({
      state,
      snapshot: snapshot({ ratio: "1.3", openTime }),
      activeBuyOrderCount: 0,
    })
    state = result.state
  }
  assert.equal(state.mode, VOLATILITY_PROTECTION_MODES.NORMAL)
  assert.equal(state.stableCandleCount, 3)
  assert.equal(state.reason, null)
})

test("does not count repeated updates to the same completed candle", () => {
  let state = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  for (let index = 0; index < 5; index += 1) {
    state = transitionVolatilityProtection({
      state,
      snapshot: snapshot({ ratio: "1", openTime: 60_000 }),
    }).state
  }
  assert.equal(state.stableCandleCount, 1)
  assert.equal(state.mode, VOLATILITY_PROTECTION_MODES.RECOVERING)
})

test("does not resume while any owned BUY remains active or unresolved", () => {
  let state = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  for (const openTime of [60_000, 120_000, 180_000]) {
    state = transitionVolatilityProtection({
      state,
      snapshot: snapshot({ ratio: "1" , openTime }),
      activeBuyOrderCount: 1,
    }).state
  }
  assert.equal(state.mode, VOLATILITY_PROTECTION_MODES.RECOVERING)
  assert.equal(state.stableCandleCount, 3)
  assert.equal(state.reason, "OWNED_BUY_ORDERS_UNRESOLVED")

  state = transitionVolatilityProtection({
    state,
    snapshot: snapshot({ ratio: "1", openTime: 240_000 }),
    activeBuyOrderCount: 0,
  }).state
  assert.equal(state.mode, VOLATILITY_PROTECTION_MODES.NORMAL)
})

test("resets recovery hysteresis when ratio rises above the recovery threshold", () => {
  let state = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  state = transitionVolatilityProtection({ state, snapshot: snapshot({ ratio: "1", openTime: 60_000 }) }).state
  state = transitionVolatilityProtection({ state, snapshot: snapshot({ ratio: "1", openTime: 120_000 }) }).state
  state = transitionVolatilityProtection({ state, snapshot: snapshot({ ratio: "1.31", openTime: 180_000 }) }).state
  assert.equal(state.mode, VOLATILITY_PROTECTION_MODES.PROTECTED)
  assert.equal(state.stableCandleCount, 0)
  assert.equal(state.reason, "VOLATILITY_NOT_RECOVERED")
})

test("warns at 1.5 without protecting until the 2.0 threshold", () => {
  const initial = createVolatilityProtectionState({ symbol: "DOGEUSDT" })
  const result = transitionVolatilityProtection({
    state: { ...initial, mode: VOLATILITY_PROTECTION_MODES.NORMAL, reason: null },
    snapshot: snapshot({ ratio: "1.5" }),
  })
  assert.equal(result.warning, true)
  assert.equal(result.state.mode, VOLATILITY_PROTECTION_MODES.NORMAL)
})
