import { assertBrokerPort, BROKER_PORT_METHODS } from "../../application/ports/broker.port.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerDisconnectedData,
} from "../../application/events/lifecycle-event-dtos.js"

const REQUIRED_CAPABILITIES = [
  ["marketData", "priceStream"],
  ["marketData", "bookTickerStream"],
  ["marketData", "candleHistory"],
  ["marketData", "candleStream"],
  ["account", "snapshot"],
  ["orders", "openOrders"],
  ["orders", "placement"],
  ["orders", "cancellation"],
  ["fills", "canonicalHistory"],
  ["fills", "executionUpdates"],
  ["userData", "stream"],
  ["recovery", "sameProcess"],
]

function assertDescriptorObject({ descriptor, index }) {
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError(`Provider descriptor at index ${index} must be an object`)
  }
}

function assertProviderIdentity({ id, provider, accountId, index }) {
  if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new TypeError(`Provider descriptor at index ${index} has an invalid instance ID`)
  }
  if (typeof provider !== "string" || !provider.trim()) {
    throw new TypeError(`Provider instance "${id}" must declare a provider type`)
  }
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new TypeError(`Provider instance "${id}" must declare a stable non-secret account ID`)
  }
}

function assertCredentialEnvironment({ credentialEnv, id }) {
  if (credentialEnv === undefined) {
    return
  }
  if (credentialEnv === null || typeof credentialEnv !== "object" || Array.isArray(credentialEnv)) {
    throw new TypeError(`Provider instance "${id}" has invalid credential environment references`)
  }
  const allowedKeys = ["apiKey", "apiSecret"]
  for (const key of Object.keys(credentialEnv)) {
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`Provider instance "${id}" has an unsupported credential environment reference`)
    }
  }
  for (const key of allowedKeys) {
    const name = credentialEnv[key]
    if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new TypeError(`Provider instance "${id}" credential references must be environment variable names`)
    }
  }
}

function assertDescriptor({ descriptor, index }) {
  assertDescriptorObject({
    descriptor,
    index,
  })
  const { id, provider, accountId, tradingMode, credentialEnv } = descriptor
  assertProviderIdentity({
    id,
    provider,
    accountId,
    index,
  })
  if (provider === "binance" && !["testnet", "live"].includes(tradingMode)) {
    throw new TypeError(`Binance instance "${id}" requires explicit testnet or live mode`)
  }
  assertCredentialEnvironment({
    credentialEnv,
    id,
  })
  return Object.freeze({
    id,
    provider,
    accountId,
    ...(tradingMode ? { tradingMode } : {}),
    ...(credentialEnv ? { credentialEnv: Object.freeze({ ...credentialEnv }) } : {}),
  })
}

function validateRegistryInput({ providerInstances, selections, adapterFactories }) {
  if (!Array.isArray(providerInstances) || providerInstances.length === 0) {
    throw new TypeError("Harvester requires at least one named provider instance")
  }
  const descriptors = providerInstances.map((descriptor, index) =>
    assertDescriptor({
      descriptor,
      index,
    }))
  const instanceIds = new Set()
  const accountIds = new Set()
  for (const descriptor of descriptors) {
    if (instanceIds.has(descriptor.id)) {
      throw new TypeError(`Duplicate provider instance ID "${descriptor.id}"`)
    }
    if (accountIds.has(descriptor.accountId)) {
      throw new TypeError(`Duplicate provider account ID "${descriptor.accountId}"`)
    }
    instanceIds.add(descriptor.id)
    accountIds.add(descriptor.accountId)
  }
  const selectedIds = [
    selections?.execution,
    selections?.account,
    selections?.marketData,
  ]
  if (selectedIds.some((id) => typeof id !== "string" || !instanceIds.has(id))) {
    throw new TypeError("Every provider role must explicitly select a configured instance ID")
  }
  if (new Set(selectedIds).size !== 1) {
    throw new TypeError("Execution, account, and market data must use the same instance until isolation is implemented")
  }
  if (adapterFactories === null || typeof adapterFactories !== "object") {
    throw new TypeError("Harvester provider adapter factories must be registered")
  }
  return descriptors
}

function getCapability({ declaration, path }) {
  let capability = declaration
  for (const key of path) {
    capability = capability?.[key]
  }
  return capability
}

function assertCapabilities({ descriptor, broker }) {
  const declaration = broker.capabilities
  if (!declaration || declaration.contractVersion !== 1 || declaration.provider !== descriptor.provider) {
    throw new TypeError(`Provider instance "${descriptor.id}" has no compatible verified capability declaration`)
  }
  const selectedMode = declaration.environment?.selectedMode
  if (descriptor.tradingMode && selectedMode !== undefined && selectedMode !== descriptor.tradingMode) {
    throw new TypeError(`Provider instance "${descriptor.id}" capability environment does not match configured mode`)
  }
  for (const path of REQUIRED_CAPABILITIES) {
    const capability = getCapability({
      declaration,
      path,
    })
    const isMutation = path[0] === "orders" &&
      ["placement", "cancellation"].includes(path[1])
    const supported = capability?.status === "supported"
    const environmentDependent = isMutation && capability?.status === "environment-dependent"
    if (!supported && !environmentDependent) {
      throw new TypeError(`Provider instance "${descriptor.id}" lacks required capability "${path.join(".")}"`)
    }
  }
}

function resolveProviderConfig({ descriptor, env }) {
  if (descriptor.provider !== "binance") {
    throw new TypeError(`Provider type "${descriptor.provider}" is not registered in Harvester`)
  }
  const apiKeyName = descriptor.credentialEnv?.apiKey ?? "BINANCE_API_KEY"
  const apiSecretName = descriptor.credentialEnv?.apiSecret ?? "BINANCE_API_SECRET_KEY"
  const apiKey = env[apiKeyName]
  const apiSecret = env[apiSecretName]
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new TypeError(`Provider instance "${descriptor.id}" requires the configured API key environment variable`)
  }
  if (typeof apiSecret !== "string" || !apiSecret.trim()) {
    throw new TypeError(`Provider instance "${descriptor.id}" requires the configured API secret environment variable`)
  }
  return {
    apiKey,
    apiSecret,
    tradingMode: descriptor.tradingMode,
  }
}

function publishConnected({ eventPublisher, descriptor }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    dataResult: mapBrokerConnectedData({
      broker: descriptor.provider,
    }),
  })
}

function publishConnectionFailure({ eventPublisher, descriptor, error }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
    dataResult: mapBrokerConnectionFailedData({
      broker: descriptor.provider,
      error,
    }),
  })
}

async function disconnectEntries({ entries, eventPublisher }) {
  const reversedEntries = entries.slice().reverse()
  const results = await Promise.allSettled(reversedEntries.map((entry) =>
    Promise.resolve().then(() => entry.broker.disconnect())))
  const errors = []
  for (const [index, result] of results.entries()) {
    const entry = reversedEntries[index]
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
      dataResult: mapBrokerDisconnectedData({
        broker: entry.descriptor.provider,
        outcome: result.status === "fulfilled" ? "success" : "failed",
        ...(result.status === "rejected" ? { error: result.reason } : {}),
      }),
    })
    if (result.status === "rejected") {
      errors.push(result.reason)
    }
  }
  return errors
}

async function constructProviderEntries({ descriptors, adapterFactories, env, logger, eventPublisher }) {
  const entries = []
  try {
    for (const descriptor of descriptors) {
      const factory = adapterFactories[descriptor.provider]
      if (typeof factory !== "function") {
        throw new TypeError(`Provider type "${descriptor.provider}" is not registered in Harvester`)
      }
      const config = resolveProviderConfig({
        descriptor,
        env,
      })
      const adapter = factory({
        config,
        logger,
      })
      entries.push({
        descriptor,
        broker: adapter,
      })
      const broker = assertBrokerPort({
        broker: adapter,
      })
      assertCapabilities({
        descriptor,
        broker,
      })
      entries[entries.length - 1].broker = broker
    }
  } catch (error) {
    const cleanupErrors = await disconnectEntries({
      entries,
      eventPublisher,
    })
    if (cleanupErrors.length > 0) {
      throw new AggregateError([
        error,
        ...cleanupErrors,
      ], "Provider construction failed and cleanup also failed")
    }
    throw error
  }
  return entries
}

function createPortFacade({ entry, connectAll, disconnectAll }) {
  const broker = {}
  for (const method of BROKER_PORT_METHODS) {
    if (method === "connect") {
      broker.connect = connectAll
    } else if (method === "disconnect") {
      broker.disconnect = disconnectAll
    } else {
      broker[method] = (...args) => entry.broker[method](...args)
    }
  }
  Object.defineProperties(broker, {
    providerInstanceId: {
      enumerable: true,
      value: entry.descriptor.id,
    },
    providerType: {
      enumerable: true,
      value: entry.descriptor.provider,
    },
    accountId: {
      enumerable: true,
      value: entry.descriptor.accountId,
    },
  })
  return Object.freeze(assertBrokerPort({
    broker,
  }))
}

function createDisconnectAll({ entries, eventPublisher, lifecycleState }) {
  return async function disconnectAll() {
    if (!lifecycleState.disconnectPromise) {
      lifecycleState.disconnectPromise = disconnectEntries({
        entries,
        eventPublisher,
      })
    }
    const errors = await lifecycleState.disconnectPromise
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more provider instances failed to disconnect")
    }
  }
}

function createConnectAll({ entries, disconnectAll, eventPublisher, lifecycleState }) {
  return async function connectAll() {
    if (lifecycleState.disconnectPromise) {
      throw new Error("Provider registry cannot connect after shutdown has started")
    }
    if (lifecycleState.connectPromise) {
      return lifecycleState.connectPromise
    }
    lifecycleState.connectPromise = (async () => {
      for (const entry of entries) {
        try {
          await entry.broker.connect()
          publishConnected({
            eventPublisher,
            descriptor: entry.descriptor,
          })
        } catch (error) {
          publishConnectionFailure({
            eventPublisher,
            descriptor: entry.descriptor,
            error,
          })
          try {
            await disconnectAll()
          } catch (cleanupError) {
            throw new AggregateError([
              error,
              cleanupError,
            ], "Provider connection and cleanup both failed")
          }
          throw error
        }
      }
    })()
    return lifecycleState.connectPromise
  }
}

function createRegistryLifecycle({ entries, eventPublisher }) {
  const entriesById = new Map(entries.map((entry) => [entry.descriptor.id, entry]))
  const lifecycleState = {}
  const disconnectAll = createDisconnectAll({
    entries,
    eventPublisher,
    lifecycleState,
  })
  const connectAll = createConnectAll({
    entries,
    disconnectAll,
    eventPublisher,
    lifecycleState,
  })
  const getEntry = ({ instanceId } = {}) => {
    const entry = entriesById.get(instanceId)
    if (!entry) {
      throw new TypeError(`Unknown provider instance ID "${instanceId}"`)
    }
    return entry
  }
  return Object.freeze({
    connectAll,
    disconnectAll,
    getBrokerPort: ({ instanceId } = {}) => createPortFacade({
      entry: getEntry({
        instanceId,
      }),
      connectAll,
      disconnectAll,
    }),
    getDescriptor: ({ instanceId } = {}) => getEntry({
      instanceId,
    }).descriptor,
    descriptors: Object.freeze(entries.map((entry) => entry.descriptor)),
  })
}

/** Construct configured adapters and own their connection and cleanup lifecycle. */
export async function createProviderRegistry({
  providerInstances,
  selections,
  adapterFactories,
  env = process.env,
  logger,
  eventPublisher,
} = {}) {
  const descriptors = validateRegistryInput({
    providerInstances,
    selections,
    adapterFactories,
  })
  const entries = await constructProviderEntries({
    descriptors,
    adapterFactories,
    env,
    logger,
    eventPublisher,
  })
  return createRegistryLifecycle({
    entries,
    eventPublisher,
  })
}
