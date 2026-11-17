import { createBinanceBrokerAdapter } from "../../infrastructure/brokers/binance-broker-adapter.js"

function assertBinanceCredentialReferences({ descriptor }) {
  const credentialEnv = descriptor.credentialEnv
  if (credentialEnv === undefined) {
    return
  }
  const allowedKeys = ["apiKey", "apiSecret"]
  const hasUnsupportedKeys = Object.keys(credentialEnv).some((key) => !allowedKeys.includes(key))
  if (hasUnsupportedKeys ||
      typeof credentialEnv.apiKey !== "string" ||
      typeof credentialEnv.apiSecret !== "string") {
    throw new TypeError(`Binance instance "${descriptor.id}" requires apiKey and apiSecret environment references only`)
  }
}

function resolveBinanceCredentialNames({ descriptor }) {
  assertBinanceCredentialReferences({
    descriptor,
  })
  const {
    apiKey: apiKeyName = "BINANCE_API_KEY",
    apiSecret: apiSecretName = "BINANCE_API_SECRET_KEY",
  } = descriptor.credentialEnv ?? {}
  return {
    apiKeyName,
    apiSecretName,
  }
}

function readRequiredCredential({ descriptor, env, name, label }) {
  const value = env[name]
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Binance instance "${descriptor.id}" requires its configured API ${label} environment variable`)
  }
  return value
}

export function resolveBinanceProviderConfig({ descriptor, env = process.env } = {}) {
  if (descriptor?.provider !== "binance") {
    throw new TypeError("Binance provider factory requires a Binance instance descriptor")
  }
  if (descriptor.tradingMode !== "testnet" && descriptor.tradingMode !== "live") {
    throw new TypeError(`Binance instance "${descriptor.id}" requires explicit testnet or live mode`)
  }
  const credentialNames = resolveBinanceCredentialNames({
    descriptor,
  })
  const apiKey = readRequiredCredential({
    descriptor,
    env,
    name: credentialNames.apiKeyName,
    label: "key",
  })
  const apiSecret = readRequiredCredential({
    descriptor,
    env,
    name: credentialNames.apiSecretName,
    label: "secret",
  })
  return Object.freeze({
    apiKey,
    apiSecret,
    tradingMode: descriptor.tradingMode,
  })
}

export function createBinanceProviderFactory({ brokerAdapterFactory = createBinanceBrokerAdapter } = {}) {
  if (typeof brokerAdapterFactory !== "function") {
    throw new TypeError("Binance provider adapter factory must be a function")
  }
  return ({ descriptor, env = process.env, logger } = {}) => {
    const config = resolveBinanceProviderConfig({
      descriptor,
      env,
    })
    return brokerAdapterFactory({
      config,
      logger,
    })
  }
}
