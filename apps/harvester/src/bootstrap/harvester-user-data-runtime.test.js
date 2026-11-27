import nodeTest from "node:test"
import assert from "node:assert/strict"
import {
  createHarvesterUserDataState,
  isHarvesterMarketPriceFresh,
} from "./harvester-user-data-runtime.js"

const test = (...args) => nodeTest(
  `[harvester-user-data-runtime.test.js] ${args[0]}`,
  ...args.slice(1),
)

test("creates a closed user-data readiness state before account recovery", () => {
  const state = createHarvesterUserDataState()

  assert.equal(state.ready, false, "User-data readiness must remain closed before reconciliation.")
  assert.equal(state.status, "NOT_SUBSCRIBED", "A new runtime must not claim an active user-data subscription.")
  assert.equal(state.accountRecoverySnapshotVerified, false, "Account recovery must require a verified initial snapshot.")
})

test("evaluates market-price freshness using the injected timestamp and clock", () => {
  let freshnessInput
  const fresh = isHarvesterMarketPriceFresh({
    marketPrice: {
      timestamp: 90,
    },
    isMarketDataFresh: (input) => {
      freshnessInput = input
      return true
    },
    now: () => 100,
  })

  assert.equal(fresh, true, "The runtime must return the market-data freshness policy result.")
  assert.deepEqual(
    freshnessInput,
    {
      timestamp: 90,
      now: 100,
    },
    "Freshness must use the supplied price timestamp and injected clock.",
  )
})
