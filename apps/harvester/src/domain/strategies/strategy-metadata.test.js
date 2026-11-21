import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId } from "./strategy-ids.js"
import { strategyMetadataById } from "../../application/logging/strategy-metadata.js"
import { strategyLogMarkers } from "../../application/logging/strategy-log-markers.js"
import { appConfig } from "../../../config/index.js"

const expectedStrategyMetadata = Object.freeze({
  [StrategyId.COIN_GRABBER]: Object.freeze({
    displayName: "Coin Grabber",
    logMarker: "🪙 CG",
  }),
  [StrategyId.RECOVERY_SELLER]: Object.freeze({
    displayName: "Recovery Seller",
    logMarker: "🔴 RS",
  }),
})

test("strategy metadata covers every canonical strategy ID without changing identity", () => {
  assert.deepEqual(
    strategyMetadataById,
    expectedStrategyMetadata,
    "Every canonical strategy ID must have one stable display name and logging marker without altering its persisted identifier.",
  )
  assert.deepEqual(
    Object.keys(strategyMetadataById).sort(),
    Object.values(StrategyId).sort(),
    "The metadata registry must neither omit a canonical strategy nor introduce an identity that is not registered.",
  )
})

test("strategy metadata and derived log markers are immutable", () => {
  assert.equal(
    Object.isFrozen(strategyMetadataById),
    true,
    "Strategy metadata registration must be immutable so runtime presentation cannot drift.",
  )
  for (const strategyMetadata of Object.values(strategyMetadataById)) {
    assert.equal(
      Object.isFrozen(strategyMetadata),
      true,
      "Each strategy metadata entry must be immutable after registration.",
    )
  }
  assert.equal(
    Object.isFrozen(strategyLogMarkers),
    true,
    "The derived logging marker map must be immutable for all consumers.",
  )
})

test("strategy log markers are derived from canonical strategy metadata", () => {
  const expectedLogMarkers = Object.fromEntries(
    Object.entries(expectedStrategyMetadata).map(([strategyId, metadata]) => [
      strategyId,
      metadata.logMarker,
    ]),
  )
  assert.deepEqual(
    strategyLogMarkers,
    expectedLogMarkers,
    "Console log markers must be derived from the single strategy metadata source instead of maintaining a second registration list.",
  )
})

test("application strategy configuration uses canonical strategy IDs", () => {
  assert.deepEqual(
    Object.keys(appConfig.strategies).sort(),
    Object.values(StrategyId).sort(),
    "Application configuration must key each strategy by its canonical ID rather than repeat serialized strategy identity strings.",
  )
})
