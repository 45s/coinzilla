import { resolveBinanceProviderIdentity } from "../../domain/provider-identity.js"

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]*$/
const TRADING_ENVIRONMENTS = new Set(["testnet", "live"])

function assertRecord({ value, path }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Provider configuration ${path} must be an object`)
  }
}

function assertIdentifier({ value, field }) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`Provider configuration ${field} must be a stable non-secret identifier`)
  }
}

function assertEnvironment({ environment, providerInstanceId }) {
  if (!TRADING_ENVIRONMENTS.has(environment)) {
    throw new TypeError(`Provider ${providerInstanceId} environment must be testnet or live`)
  }
}

function assertCredentialEnvironmentName({ value, field, providerInstanceId }) {
  if (typeof value !== "string" || !ENVIRONMENT_VARIABLE_PATTERN.test(value)) {
    throw new TypeError(`Provider ${providerInstanceId} credential environment variable name ${field} is invalid`)
  }
}

function resolveCredentialEnvironmentNames({ credentials, providerInstanceId }) {
  assertRecord({ value: credentials, path: `${providerInstanceId}.credentials` })
  const apiKeyEnv = credentials.apiKeyEnv
  const apiSecretEnv = credentials.apiSecretEnv
  assertCredentialEnvironmentName({
    value: apiKeyEnv,
    field: "apiKeyEnv",
    providerInstanceId,
  })
  assertCredentialEnvironmentName({
    value: apiSecretEnv,
    field: "apiSecretEnv",
    providerInstanceId,
  })
  if (apiKeyEnv === apiSecretEnv) {
    throw new TypeError(`Provider ${providerInstanceId} must use separate API key and secret environment variables`)
  }
  return Object.freeze({ apiKeyEnv, apiSecretEnv })
}

function createBrokerAdapterFactory({ providerInstanceId, environment, credentials, env, adapterFactory }) {
  return function createConfiguredBrokerAdapter({ config = {}, logger } = {}) {
    const apiKey = env[credentials.apiKeyEnv]
    const apiSecret = env[credentials.apiSecretEnv]
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new TypeError(`Provider ${providerInstanceId} requires a non-empty ${credentials.apiKeyEnv}`)
    }
    if (typeof apiSecret !== "string" || !apiSecret.trim()) {
      throw new TypeError(`Provider ${providerInstanceId} requires a non-empty ${credentials.apiSecretEnv}`)
    }
    return adapterFactory({
      config: {
        ...config,
        apiKey,
        apiSecret,
        tradingMode: environment,
      },
      logger,
    })
  }
}

function createProviderInstance({ descriptor, env, adapterFactories }) {
  assertRecord({ value: descriptor, path: "instance" })
  const {
    providerInstanceId,
    providerType,
    accountId,
    environment,
    credentials: configuredCredentials,
  } = descriptor
  for (const [field, value] of Object.entries({
    providerInstanceId,
    providerType,
    accountId,
  })) {
    assertIdentifier({ value, field })
  }
  assertEnvironment({ environment, providerInstanceId })
  const adapterFactory = adapterFactories[providerType]
  if (typeof adapterFactory !== "function") {
    throw new TypeError(`Provider ${providerInstanceId} uses unsupported provider type ${providerType}`)
  }
  const credentials = resolveCredentialEnvironmentNames({
    credentials: configuredCredentials,
    providerInstanceId,
  })
  return Object.freeze({
    providerInstanceId,
    providerType,
    accountId,
    environment,
    identity: Object.freeze({
      providerInstanceId,
      providerType,
      accountId,
    }),
    brokerAdapterFactory: createBrokerAdapterFactory({
      providerInstanceId,
      environment,
      credentials,
      env,
      adapterFactory,
    }),
  })
}

function validateUniqueProviderIdentities({ providers }) {
  const instanceIds = new Set()
  const accountScopes = new Set()
  for (const provider of providers) {
    if (instanceIds.has(provider.providerInstanceId)) {
      throw new TypeError(`Provider configuration contains duplicate providerInstanceId ${provider.providerInstanceId}`)
    }
    instanceIds.add(provider.providerInstanceId)
    const accountScope = JSON.stringify([
      provider.providerType,
      provider.accountId,
      provider.environment,
    ])
    if (accountScopes.has(accountScope)) {
      throw new TypeError("Provider configuration contains duplicate provider account identity")
    }
    accountScopes.add(accountScope)
  }
}

function resolveLegacyBinanceProvider({ env, adapterFactories }) {
  const identity = resolveBinanceProviderIdentity({
    tradingMode: env.TRADING_MODE,
    providerInstanceId: env.BINANCE_PROVIDER_INSTANCE_ID,
    accountId: env.BINANCE_ACCOUNT_ID,
  })
  const provider = createProviderInstance({
    descriptor: {
      ...identity,
      environment: env.TRADING_MODE,
      credentials: {
        apiKeyEnv: "BINANCE_API_KEY",
        apiSecretEnv: "BINANCE_API_SECRET_KEY",
      },
    },
    env,
    adapterFactories,
  })
  return Object.freeze([provider])
}

/**
 * Resolve the configured provider/account instances at the process composition boundary.
 * The legacy Binance environment remains the default when brokers.instances is absent.
 * Credential values are captured by factory closures and never exposed in provider metadata.
 *
 * @param {{appConfig: object, env: object, adapterFactories: object}} input
 * @returns {ReadonlyArray<object>}
 */
export function resolveProviderInstances({ appConfig, env = process.env, adapterFactories = {} } = {}) {
  assertRecord({ value: appConfig, path: "appConfig" })
  assertRecord({ value: env, path: "env" })
  assertRecord({ value: adapterFactories, path: "adapterFactories" })
  const brokers = appConfig.brokers
  if (brokers === undefined) {
    return resolveLegacyBinanceProvider({ env, adapterFactories })
  }
  assertRecord({ value: brokers, path: "brokers" })
  if (!Array.isArray(brokers.instances) || brokers.instances.length === 0) {
    throw new TypeError("Provider configuration brokers.instances must be a non-empty array")
  }
  const providers = brokers.instances.map((descriptor) => createProviderInstance({
    descriptor,
    env,
    adapterFactories,
  }))
  validateUniqueProviderIdentities({ providers })
  return Object.freeze(providers)
}
