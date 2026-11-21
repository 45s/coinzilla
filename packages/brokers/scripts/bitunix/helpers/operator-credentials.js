export function parseBitunixApiCredentials({ env }) {
  const apiKey = env.BITUNIX_API_KEY?.trim()
  const apiSecret = env.BITUNIX_API_SECRET?.trim()
  if (!apiKey || !apiSecret) {
    throw new Error("Set BITUNIX_API_KEY and BITUNIX_API_SECRET in packages/brokers/.env.development")
  }
  return {
    apiKey,
    apiSecret,
  }
}

export function redactBitunixApiSecrets({ message, secrets }) {
  let safeMessage = String(message)
  for (const secret of secrets) {
    if (secret) {
      safeMessage = safeMessage.replaceAll(secret, "[REDACTED]")
    }
  }
  return safeMessage
}
