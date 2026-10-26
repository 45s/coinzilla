import { toResult } from "@coinzilla/utils"

export function validateConfig({ config }) {
  const { broker, pairs } = config ?? {}
  const errors = []
  if (!broker) {
    errors.push(new Error("Bot requires a broker"))
  }

  if (!pairs || Object.keys(pairs).length === 0) {
    errors.push(new Error("Bot requires at least one trading pair"))
  }

  return toResult({ errors })
}
