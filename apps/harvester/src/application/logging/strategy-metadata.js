import { StrategyId } from "../../domain/strategies/strategy-ids.js"

export const strategyMetadataById = Object.freeze({
  [StrategyId.COIN_GRABBER]: Object.freeze({
    displayName: "Coin Grabber",
    logMarker: "🪙 CG",
  }),
  [StrategyId.RECOVERY_SELLER]: Object.freeze({
    displayName: "Recovery Seller",
    logMarker: "🔴 RS",
  }),
})
