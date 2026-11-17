import { assertBrokerPort, BROKER_PORT_METHODS } from "../../application/ports/broker.port.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
} from "../../application/events/lifecycle-event-dtos.js"

const REQUIRED_CAPABILITIES = [
  ["marketData", "oneShotPrice"],
  ["marketData", "priceStream"],
  ["marketData", "bookTickerStream"],
  ["marketData", "candleHistory"],
  ["marketData", "candleStream"],
  ["account", "snapshot"],
  ["orders", "openOrders"],
  ["orders", "canonicalLookup"],
  ["orders", "canonicalHistory"],
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
  if (typeof id !== "string" || !/^[a-z][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new TypeError(`Provider descriptor at index ${index} has an invalid instance ID`)
  }
  if (typeof provider !== "string" || !/^[a-z][a-z0-9-]*$/.test(provider)) {
    throw new TypeError(`Provider instance "${id}" must declare a provider type`)
  }
  if (typeof accountId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(accountId) || accountId.length > 64) {
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
  for (const name of Object.values(credentialEnv)) {
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
  if (tradingMode !== undefined && !["testnet", "live"].includes(tradingMode)) {
    throw new TypeError(`Provider instance "${id}" has an unsupported trading environment`)
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
  const descriptors = []
  for (const [index, descriptor] of providerInstances.entries()) {
    descriptors.push(assertDescriptor({
      descriptor,
      index,
    }))
  }
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

function isCapabilityEnvironmentValid({
    descriptor,
    declaration,
  }) {
  const selectedMode = declaration.environment?.selectedMode
  return !descriptor.tradingMode || selectedMode === undefined || selectedMode === descriptor.tradingMode
}

function isCapabilityAvailable({
      capability,
      path,
    }) {
  const isMutation = path[0] === "orders" &&
    ["placement", "cancellation"].includes(path[1])
  return capability?.status === "supported" ||
    (isMutation && capability?.status === "environment-dependent")
}

function assertCapabilities({ descriptor, broker }) {
  const declaration = broker.capabilities
  if (!declaration || declaration.contractVersion !== 1 || declaration.provider !== descriptor.provider) {
    throw new TypeError(`Provider instance "${descriptor.id}" has no compatible verified capability declaration`)
  }
  const environmentValid = isCapabilityEnvironmentValid({
    descriptor,
    declaration,
  })
  if (!environmentValid) {
    throw new TypeError(`Provider instance "${descriptor.id}" capability environment does not match configured mode`)
  }
  for (const path of REQUIRED_CAPABILITIES) {
    const capability = getCapability({
      declaration,
      path,
    })
    const available = isCapabilityAvailable({
      capability,
      path,
    })
    if (!available) {
      throw new TypeError(`Provider instance "${descriptor.id}" declares capability "${path.join(".")}" as "${capability?.status ?? "missing"}"`)
    }
  }
}



function logProviderLifecycle({ logger, level, message, descriptor, error }) {
  const logMethod = typeof logger?.[level] === "function" ? logger[level] : logger?.info
  logMethod?.call(logger, {
    message,
    provider: descriptor.provider,
    providerInstanceId: descriptor.id,
    accountId: descriptor.accountId,
    ...(error ? { errorName: error.name ?? "Error" } : {}),
  })
}

function publishConnected({ eventPublisher, descriptor, logger }) {
  logProviderLifecycle({
    logger,
    level: "system",
    message: "Provider instance connected",
    descriptor,
  })
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    dataResult: mapBrokerConnectedData({
      broker: descriptor.provider,
    }),
  })
}

function publishConnectionFailure({ eventPublisher, descriptor, error, logger }) {
  logProviderLifecycle({
    logger,
    level: "error",
    message: "Provider instance connection failed",
    descriptor,
    error,
  })
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
    dataResult: mapBrokerConnectionFailedData({
      broker: descriptor.provider,
      error,
    }),
  })
}

function getDisconnectLogMessage({ entry, result }) {
  if (result.status === "rejected") {
    return "Provider instance disconnect failed"
  }
  return entry.connected
    ? "Provider instance disconnected"
    : "Provider instance resources cleaned up"
}

async function disconnectEntries({ entries, logger }) {
  const reversedEntries = entries.slice().reverse()
  const results = await Promise.allSettled(reversedEntries.map((entry) =>
    Promise.resolve().then(() => entry.broker.disconnect())))
  const errors = []
  for (const [index, result] of results.entries()) {
    const entry = reversedEntries[index]
    logProviderLifecycle({
      logger,
      level: result.status === "fulfilled" ? "system" : "error",
      message: getDisconnectLogMessage({
        entry,
        result,
      }),
      descriptor: entry.descriptor,
      ...(result.status === "rejected" ? { error: result.reason } : {}),
    })
    if (result.status === "fulfilled") {
      entry.connected = false
    }
    if (result.status === "rejected") {
      errors.push(result.reason)
    }
  }
  return errors
}

async function constructProviderEntries({ descriptors, adapterFactories, env, logger }) {
  const entries = []
  try {
    for (const descriptor of descriptors) {
      const factory = adapterFactories[descriptor.provider]
      if (typeof factory !== "function") {
        throw new TypeError(`Provider type "${descriptor.provider}" is not registered in Harvester`)
      }
      const adapter = await factory({
        descriptor,
        env,
        logger,
      })
      entries.push({
        descriptor,
        broker: adapter,
        connected: false,
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
      logger,
    })
    if (cleanupErrors.length > 0) {
      throw new AggregateError([
        error,
        ...cleanupErrors,
      ], "Provider construction failed and cleanup also failed", {
        cause: error,
      })
    }
    throw error
  }
  return entries
}

function createPortFacade({ entry, entryLifecycle }) {
  const broker = {}
  for (const method of BROKER_PORT_METHODS) {
    if (method === "connect") {
      broker.connect = entryLifecycle.connect
    } else if (method === "disconnect") {
      broker.disconnect = entryLifecycle.disconnect
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
    capabilities: {
      enumerable: true,
      value: entry.broker.capabilities,
    },
  })
  return Object.freeze(assertBrokerPort({
    broker,
  }))
}

function createEntryLifecycle({ entry, eventPublisher, logger, registryState }) {
  let connectPromise
  let disconnectPromise
  const disconnect = async function disconnectEntry() {
    if (!disconnectPromise) {
      disconnectPromise = disconnectEntries({
        entries: [entry],
        logger,
      })
    }
    const errors = await disconnectPromise
    if (errors.length > 0) {
      throw new AggregateError(errors, `Provider instance "${entry.descriptor.id}" failed to disconnect`)
    }
  }
  const connect = async function connectEntry() {
    if (registryState.disconnectPromise || disconnectPromise) {
      throw new Error(`Provider instance "${entry.descriptor.id}" cannot connect after shutdown has started`)
    }
    if (!connectPromise) {
      connectPromise = (async () => {
        try {
          await entry.broker.connect()
          entry.connected = true
          publishConnected({
            eventPublisher,
            descriptor: entry.descriptor,
            logger,
          })
        } catch (error) {
          publishConnectionFailure({
            eventPublisher,
            descriptor: entry.descriptor,
            error,
            logger,
          })
          try {
            await disconnect()
          } catch (cleanupError) {
            throw new AggregateError([
              error,
              cleanupError,
            ], "Provider connection and cleanup both failed", {
              cause: cleanupError,
            })
          }
          throw error
        }
      })()
    }
    return connectPromise
  }
  return Object.freeze({
    connect,
    disconnect,
  })
}

function createDisconnectAll({ entries, entryLifecycles, registryState }) {
  return async function disconnectAll() {
    if (!registryState.disconnectPromise) {
      registryState.disconnectPromise = (async () => {
        const results = await Promise.allSettled(entries.slice().reverse().map((entry) =>
          entryLifecycles.get(entry.descriptor.id).disconnect()))
        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason)
        if (errors.length > 0) {
          throw new AggregateError(errors, "One or more provider instances failed to disconnect")
        }
      })()
    }
    return registryState.disconnectPromise
  }
}

function createConnectionCleanupError({ error, cleanupError }) {
  const originalErrors = error instanceof AggregateError ? error.errors : [error]
  const cleanupErrors = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError]
  const additionalErrors = cleanupErrors.filter((entry) => !originalErrors.includes(entry))
  return new AggregateError([
    ...originalErrors,
    ...additionalErrors,
  ], "Provider connection and registry cleanup both failed", {
    cause: cleanupError,
  })
}

function createConnectAll({ entries, entryLifecycles, disconnectAll, registryState }) {
  return async function connectAll() {
    if (registryState.disconnectPromise) {
      throw new Error("Provider registry cannot connect after shutdown has started")
    }
    if (!registryState.connectPromise) {
      registryState.connectPromise = (async () => {
        try {
          for (const entry of entries) {
            await entryLifecycles.get(entry.descriptor.id).connect()
          }
        } catch (error) {
          try {
            await disconnectAll()
          } catch (cleanupError) {
            throw createConnectionCleanupError({
              error,
              cleanupError,
            })
          }
          throw error
        }
      })()
    }
    return registryState.connectPromise
  }
}

function createRegistryLifecycle({ entries, eventPublisher, logger }) {
  const entriesById = new Map(entries.map((entry) => [entry.descriptor.id, entry]))
  const registryState = {}
  const entryLifecycles = new Map()
  for (const entry of entries) {
    entryLifecycles.set(entry.descriptor.id, createEntryLifecycle({
      entry,
      eventPublisher,
      logger,
      registryState,
    }))
  }
  const disconnectAll = createDisconnectAll({
    entries,
    entryLifecycles,
    registryState,
  })
  const connectAll = createConnectAll({
    entries,
    entryLifecycles,
    disconnectAll,
    registryState,
  })
  const getEntry = ({ instanceId } = {}) => {
    const entry = entriesById.get(instanceId)
    if (!entry) {
      throw new TypeError(`Unknown provider instance ID "${instanceId}"`)
    }
    return entry
  }
  const getEntryLifecycle = ({ instanceId }) => {
    const lifecycle = entryLifecycles.get(instanceId)
    if (!lifecycle) {
      throw new TypeError(`Unknown provider instance ID "${instanceId}"`)
    }
    return lifecycle
  }
  return Object.freeze({
    connectAll,
    disconnectAll,
    getBrokerPort: ({ instanceId } = {}) => createPortFacade({
      entry: getEntry({
        instanceId,
      }),
      entryLifecycle: getEntryLifecycle({
        instanceId,
      }),
    }),
    getDescriptor: ({ instanceId } = {}) => getEntry({
      instanceId,
    }).descriptor,
    getCapabilities: ({ instanceId } = {}) => getEntry({
      instanceId,
    }).broker.capabilities,
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
  })
  return createRegistryLifecycle({
    entries,
    eventPublisher,
    logger,
  })
}
