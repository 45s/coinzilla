import { toResult } from "@coinzilla/utils"

export function validateConfig(input) {
  const { broker, tradingConfig } = input ?? {}
  const errors = []

  const strategyEnabled =
    tradingConfig?.strategies?.["free-roll"]?.enabled !== false

  if (!broker && strategyEnabled) {
    errors.push(new Error("Bot requires a broker when the strategy is enabled"))
  }

  const { pairs } = tradingConfig?.strategies?.["free-roll"] ?? {}

  if (!pairs || Object.keys(pairs).length === 0) {
    errors.push(new Error("Bot requires at least one trading pair"))
  }

  return toResult({ errors })
}
