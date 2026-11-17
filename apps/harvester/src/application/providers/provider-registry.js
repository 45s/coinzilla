import { SystemCustomError } from "@coinzilla/utils"
import { assertBrokerPort, BROKER_PORT_METHODS } from "../ports/broker.port.js"

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export class ProviderRegistryError extends SystemCustomError {
  constructor(...args) {
    const [message, options = {}] = args
    super(message, options)
  }
}

function createRegistryError({
  message,
  code = "HARVESTER_PROVIDER_REGISTRY_INVALID",
  context = {},
  cause,
} = {}) {
  const options = {
    code,
    context,
  }
  if (cause !== undefined) {
    options.cause = cause
  }
  return new ProviderRegistryError(message, options)
}

function isDeeplyFrozen({ value } = {}) {
  if (value === null || typeof value !== "object") {
    return true
  }
  if (!Object.isFrozen(value)) {
    return false
  }
  return Object.values(value).every((nestedValue) => isDeeplyFrozen({ value: nestedValue }))
}

function validateIdentifier({ value, field }) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw createRegistryError({
      message: `Provider registry ${field} must be a stable non-secret identifier`,
      context: { field },
    })
  }
  return value
}

function validateCapabilityDeclaration({ broker, providerType, environment }) {
  const { capabilities } = broker
  const { selectedMode } = capabilities?.environment ?? {}
  const valid = capabilities !== null &&
    typeof capabilities === "object" &&
    !Array.isArray(capabilities) &&
    isDeeplyFrozen({ value: capabilities }) &&
    capabilities.contractVersion === 1 &&
    capabilities.provider === providerType &&
    (selectedMode === undefined || selectedMode === environment)
  if (!valid) {
    throw createRegistryError({
      message: "Provider capability declaration must be immutable and match its registered provider identity",
      context: {
        field: "capabilities",
        providerType,
        environment,
      },
    })
  }
  return capabilities
}

function validateProviderBroker({ broker, providerType, environment }) {
  let brokerPort
  try {
    brokerPort = assertBrokerPort({ broker })
  } catch (cause) {
    throw createRegistryError({
      message: "Provider registry entry must implement the Harvester BrokerPort",
      context: { field: "broker" },
      cause,
    })
  }
  const capabilities = validateCapabilityDeclaration({
    broker: brokerPort,
    providerType,
    environment,
  })
  return {
    broker: brokerPort,
    capabilities,
  }
}

function validateProviderDescriptor({ provider } = {}) {
  if (provider === null || typeof provider !== "object" || Array.isArray(provider)) {
    throw createRegistryError({
      message: "Provider registry entries must be objects",
      context: { field: "provider" },
    })
  }

  const providerInstanceId = validateIdentifier({
    value: provider.providerInstanceId,
    field: "providerInstanceId",
  })
  const providerType = validateIdentifier({
    value: provider.providerType,
    field: "providerType",
  })
  const accountId = validateIdentifier({
    value: provider.accountId,
    field: "accountId",
  })
  const environment = validateIdentifier({
    value: provider.environment,
    field: "environment",
  })
  const { broker, capabilities } = validateProviderBroker({
    broker: provider.broker,
    providerType,
    environment,
  })
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment,
    broker,
    capabilities,
  }
}

function createBrokerPortProxy({
  broker,
  connect,
  disconnect,
  capabilities,
  providerInstanceId,
  providerType,
  accountId,
  environment,
}) {
  const proxy = Object.fromEntries(BROKER_PORT_METHODS.map((method) => {
    if (method === "connect") {
      return [method, connect]
    }
    if (method === "disconnect") {
      return [method, disconnect]
    }
    return [method, (...args) => broker[method](...args)]
  }))
  Object.defineProperties(proxy, {
    capabilities: {
      value: capabilities,
      enumerable: true,
    },
    providerInstanceId: {
      value: providerInstanceId,
      enumerable: true,
    },
    providerType: {
      value: providerType,
      enumerable: true,
    },
    accountId: {
      value: accountId,
      enumerable: true,
    },
    environment: {
      value: environment,
      enumerable: true,
    },
  })
  return Object.freeze(proxy)
}

function createProviderConnect({ broker, lifecycle }) {
  return function connect() {
    if (lifecycle.status === "connected") {
      return Promise.resolve()
    }
    if (lifecycle.status === "connecting") {
      return lifecycle.connectPromise
    }
    if (lifecycle.status !== "created") {
      return Promise.reject(createRegistryError({
        message: "Provider instance cannot connect from its current lifecycle state",
        code: "HARVESTER_PROVIDER_LIFECYCLE_INVALID",
        context: { status: lifecycle.status },
      }))
    }

    lifecycle.status = "connecting"
    let connection
    try {
      connection = broker.connect()
    } catch (cause) {
      connection = Promise.reject(cause)
    }
    lifecycle.connectPromise = Promise.resolve(connection)
      .then(() => {
        lifecycle.status = "connected"
      }, (cause) => {
        lifecycle.status = "failed"
        throw cause
      })
    return lifecycle.connectPromise
  }
}

function startProviderDisconnect({ broker, lifecycle }) {
  lifecycle.status = "disconnecting"
  lifecycle.disconnectPromise = Promise.resolve()
    .then(() => broker.disconnect())
    .then(() => {
      lifecycle.status = "disconnected"
    }, (cause) => {
      lifecycle.status = "disconnect-failed"
      throw cause
    })
    .finally(() => {
      lifecycle.disconnectPromise = undefined
    })
  return lifecycle.disconnectPromise
}

function createProviderDisconnect({ broker, lifecycle }) {
  return function disconnect() {
    if (lifecycle.status === "disconnected") {
      return Promise.resolve()
    }
    if (lifecycle.status === "disconnecting") {
      return lifecycle.disconnectPromise
    }
    if (lifecycle.status === "connecting" && lifecycle.connectPromise) {
      return lifecycle.connectPromise.catch(() => undefined).then(() => {
        if (lifecycle.status === "disconnected") {
          return Promise.resolve()
        }
        if (lifecycle.status === "disconnecting") {
          return lifecycle.disconnectPromise
        }
        return startProviderDisconnect({
          broker,
          lifecycle,
        })
      })
    }
    return startProviderDisconnect({
      broker,
      lifecycle,
    })
  }
}

function createProviderEntry({ descriptor }) {
  const {
    providerInstanceId,
    providerType,
    accountId,
    environment,
    broker,
    capabilities,
  } = descriptor
  const lifecycle = {
    status: "created",
    connectPromise: undefined,
    disconnectPromise: undefined,
  }
  const connect = createProviderConnect({
    broker,
    lifecycle,
  })
  const disconnect = createProviderDisconnect({
    broker,
    lifecycle,
  })
  const brokerPort = createBrokerPortProxy({
    broker,
    connect,
    disconnect,
    capabilities,
    providerInstanceId,
    providerType,
    accountId,
    environment,
  })
  return Object.freeze({
    providerInstanceId,
    providerType,
    accountId,
    environment,
    capabilities,
    broker: brokerPort,
    connect,
    disconnect,
    get status() {
      return lifecycle.status
    },
  })
}

function createProviderEntries({ providers }) {
  const entries = new Map()
  for (const provider of providers) {
    const descriptor = validateProviderDescriptor({ provider })
    if (entries.has(descriptor.providerInstanceId)) {
      throw createRegistryError({
        message: "Provider registry contains a duplicate provider-instance identity",
        context: { field: "providerInstanceId" },
      })
    }
    entries.set(descriptor.providerInstanceId, createProviderEntry({ descriptor }))
  }
  return entries
}

function getProvider({ entries, providerInstanceId }) {
  const provider = entries.get(providerInstanceId)
  if (!provider) {
    throw createRegistryError({
      message: "Requested provider instance is not registered",
      code: "HARVESTER_PROVIDER_INSTANCE_NOT_FOUND",
      context: { field: "providerInstanceId" },
    })
  }
  return provider
}

function listProviderMetadata({ entries }) {
  const metadata = [...entries.values()].map((provider) => Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
    capabilities: provider.capabilities,
    status: provider.status,
  }))
  return Object.freeze(metadata)
}

async function connectAllProviders({ entries }) {
  const providersToConnect = [...entries.values()]
  try {
    for (const provider of providersToConnect) {
      await provider.connect()
    }
  } catch (connectionError) {
    const cleanupErrors = []
    for (const provider of providersToConnect.reverse()) {
      try {
        await provider.disconnect()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [connectionError, ...cleanupErrors],
        "Provider registry connection failed and rollback cleanup was incomplete",
        { cause: connectionError },
      )
    }
    throw connectionError
  }
  return Object.freeze(providersToConnect)
}

async function disconnectAllProviders({ entries }) {
  const cleanupErrors = []
  const providersToDisconnect = [...entries.values()].reverse()
  for (const provider of providersToDisconnect) {
    try {
      await provider.disconnect()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Provider registry disconnect cleanup failed",
      { cause: cleanupErrors[0] },
    )
  }
}

/**
 * Create an immutable registry of explicitly named Harvester provider instances.
 * The registry owns provider connection lifecycle; route selection remains outside this foundation.
 *
 * @param {{providers: object[]}} input
 * @returns {{get: (providerInstanceId: string) => object, list: () => object[], connect: (providerInstanceId: string) => Promise<void>, disconnect: (providerInstanceId: string) => Promise<void>, connectAll: () => Promise<object[]>, disconnectAll: () => Promise<void>}}
 */
export function createProviderRegistry({ providers } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw createRegistryError({
      message: "Provider registry requires at least one explicitly configured provider instance",
      context: { field: "providers" },
    })
  }

  const entries = createProviderEntries({ providers })
  return Object.freeze({
    get: (providerInstanceId) => getProvider({
      entries,
      providerInstanceId,
    }),
    list: () => listProviderMetadata({ entries }),
    connect: (providerInstanceId) => getProvider({
      entries,
      providerInstanceId,
    }).connect(),
    disconnect: (providerInstanceId) => getProvider({
      entries,
      providerInstanceId,
    }).disconnect(),
    connectAll: () => connectAllProviders({ entries }),
    disconnectAll: () => disconnectAllProviders({ entries }),
  })
}
