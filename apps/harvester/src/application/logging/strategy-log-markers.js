import { StrategyId } from "../../domain/strategies/strategy-ids.js"

export const strategyLogMarkers = Object.freeze({
  [StrategyId.COIN_GRABBER]: "🪙 CG",
  [StrategyId.RECOVERY_SELLER]: "🔴 RS",
})

export const SYSTEM_LOG_MARKER = "⚪ SYS"
