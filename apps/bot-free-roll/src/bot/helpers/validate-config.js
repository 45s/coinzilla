import { toResult } from "@coinzilla/utils"

export function validateConfig(input) {
  const { broker, tradingConfig } = input ?? {}
  const errors = []
  if (!broker) {
    errors.push(new Error("Bot requires a broker"))
  }

  const { pairs } = tradingConfig.strategies["free-roll"]

  if (!pairs || Object.keys(pairs).length === 0) {
    errors.push(new Error("Bot requires at least one trading pair"))
  }

  return toResult({ errors })
}
