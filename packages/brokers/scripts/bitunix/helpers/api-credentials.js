export function parseApiCredentials({ env }) {
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

export function redactApiSecrets({ message, secrets }) {
  let safeMessage = String(message)
  for (const secret of secrets) {
    if (secret) {
      safeMessage = safeMessage.replaceAll(secret, "[REDACTED]")
    }
  }
  return safeMessage
}

export function getConfiguredApiSecrets({ env }) {
  return [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean)
}

export function getMissingApiCredentialNames({ env }) {
  return ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"].filter((key) =>
    typeof env[key] !== "string" || !env[key].trim())
}

export function hasApiCredentials({ env }) {
  return getMissingApiCredentialNames({ env }).length === 0
}
