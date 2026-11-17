import { assertBrokerPort, BROKER_PORT_METHODS } from "../../application/ports/broker.port.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerDisconnectedData,
} from "../../application/events/lifecycle-event-dtos.js"

const REQUIRED_CAPABILITIES = [
  ["marketData", "priceStream"], ["marketData", "bookTickerStream"],
  ["marketData", "candleHistory"], ["marketData", "candleStream"],
  ["account", "snapshot"], ["orders", "openOrders"], ["orders", "placement"],
  ["orders", "cancellation"], ["fills", "canonicalHistory"],
  ["fills", "executionUpdates"], ["userData", "stream"], ["recovery", "sameProcess"],
]

function assertDescriptor({ descriptor, index }) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError(`Provider descriptor at index ${index} must be an object`)
  }
  const { id, provider, accountId, tradingMode } = descriptor
  if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ||
      typeof provider !== "string" || !provider.trim() ||
      typeof accountId !== "string" || !accountId.trim()) {
    throw new TypeError(`Provider descriptor at index ${index} has invalid non-secret identity fields`)
  }
  if (provider === "binance" && !["testnet", "live"].includes(tradingMode)) {
    throw new TypeError(`Binance instance "${id}" requires explicit testnet or live mode`)
  }
  return Object.freeze({ id, provider, accountId, ...(tradingMode ? { tradingMode } : {}) })
}

function assertCapabilities({ descriptor, broker }) {
  const declaration = broker.capabilities
  if (!declaration || declaration.contractVersion !== 1 || declaration.provider !== descriptor.provider) {
    throw new TypeError(`Provider instance "${descriptor.id}" has no compatible verified capability declaration`)
  }
  if (descriptor.tradingMode && declaration.environment?.selectedMode !== descriptor.tradingMode) {
    throw new TypeError(`Provider instance "${descriptor.id}" capability environment does not match configured mode`)
  }
  for (const path of REQUIRED_CAPABILITIES) {
    const capability = path.reduce((value, key) => value?.[key], declaration)
    const mutation = path[0] === "orders" && ["placement", "cancellation"].includes(path[1])
    if (capability?.status !== "supported" &&
        !(mutation && capability?.status === "environment-dependent")) {
      throw new TypeError(`Provider instance "${descriptor.id}" lacks required capability "${path.join(".")}"`)
    }
  }
}

function resolveProviderConfig({ descriptor, env }) {
  if (descriptor.provider !== "binance") {
    throw new TypeError(`Provider type "${descriptor.provider}" is not registered in Harvester`)
  }
  const apiKey = env.BINANCE_API_KEY
  const apiSecret = env.BINANCE_API_SECRET_KEY
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new TypeError(`Provider instance "${descriptor.id}" requires its configured API key`)
  }
  if (typeof apiSecret !== "string" || !apiSecret.trim()) {
    throw new TypeError(`Provider instance "${descriptor.id}" requires its configured API secret`)
  }
  return { apiKey, apiSecret, tradingMode: descriptor.tradingMode }
}

function publishConnected({ eventPublisher, descriptor }) {
  publishLifecycleEvent({
    eventPublisher, eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    dataResult: mapBrokerConnectedData({ broker: descriptor.provider }),
  })
}

function publishConnectionFailure({ eventPublisher, descriptor, error }) {
  publishLifecycleEvent({
    eventPublisher, eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
    dataResult: mapBrokerConnectionFailedData({ broker: descriptor.provider, error }),
  })
}

async function disconnectEntries({ entries, eventPublisher }) {
  const reversed = entries.slice().reverse()
  const results = await Promise.allSettled(reversed.map((entry) => entry.broker.disconnect()))
  const errors = []
  for (const [index, result] of results.entries()) {
    const entry = reversed[index]
    publishLifecycleEvent({
      eventPublisher, eventName: HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
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
    providerInstanceId: { enumerable: true, value: entry.descriptor.id },
    providerType: { enumerable: true, value: entry.descriptor.provider },
    accountId: { enumerable: true, value: entry.descriptor.accountId },
  })
  return Object.freeze(assertBrokerPort({ broker }))
}

/** Construct configured adapters and own their connection and cleanup lifecycle. */
export async function createProviderRegistry({
  providerInstances, selections, adapterFactories, env = process.env, logger, eventPublisher,
} = {}) {
  if (!Array.isArray(providerInstances) || providerInstances.length === 0) {
    throw new TypeError("Harvester requires at least one named provider instance")
  }
  const descriptors = providerInstances.map((descriptor, index) => assertDescriptor({ descriptor, index }))
  const ids = new Set()
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new TypeError(`Duplicate provider instance ID "${descriptor.id}"`)
    }
    ids.add(descriptor.id)
  }
  const selectedIds = [selections?.execution, selections?.account, selections?.marketData]
  if (selectedIds.some((id) => typeof id !== "string" || !ids.has(id))) {
    throw new TypeError("Every provider role must explicitly select a configured instance ID")
  }
  if (new Set(selectedIds).size !== 1) {
    throw new TypeError("Execution, account, and market data must use the same instance until isolation is implemented")
  }
  if (!adapterFactories || typeof adapterFactories !== "object") {
    throw new TypeError("Harvester provider adapter factories must be registered")
  }

  const entries = []
  try {
    for (const descriptor of descriptors) {
      const factory = adapterFactories[descriptor.provider]
      if (typeof factory !== "function") {
        throw new TypeError(`Provider type "${descriptor.provider}" is not registered in Harvester`)
      }
      const config = resolveProviderConfig({ descriptor, env })
      const broker = assertBrokerPort({ broker: factory({ config, logger }) })
      entries.push({ descriptor, broker })
      assertCapabilities({ descriptor, broker })
    }
  } catch (error) {
    const cleanupErrors = await disconnectEntries({ entries, eventPublisher })
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], "Provider construction failed and cleanup also failed", { cause: error })
    }
    throw error
  }

  const entriesById = new Map(entries.map((entry) => [entry.descriptor.id, entry]))
  let connectPromise
  let disconnectPromise
  const disconnectAll = async () => {
    if (!disconnectPromise) {
      disconnectPromise = disconnectEntries({ entries, eventPublisher })
    }
    const errors = await disconnectPromise
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more provider instances failed to disconnect")
    }
  }
  const connectAll = async () => {
    if (disconnectPromise) {
      throw new Error("Provider registry cannot connect after shutdown has started")
    }
    if (!connectPromise) {
      connectPromise = (async () => {
        for (const entry of entries) {
          try {
            await entry.broker.connect()
            publishConnected({ eventPublisher, descriptor: entry.descriptor })
          } catch (error) {
            publishConnectionFailure({ eventPublisher, descriptor: entry.descriptor, error })
            try {
              await disconnectAll()
            } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], "Provider connection and cleanup both failed", { cause: error })
            }
            throw error
          }
        }
      })()
    }
    return connectPromise
  }
  const getEntry = ({ instanceId } = {}) => {
    const entry = entriesById.get(instanceId)
    if (!entry) {
      throw new TypeError(`Unknown provider instance ID "${instanceId}"`)
    }
    return entry
  }
  return Object.freeze({
    connectAll, disconnectAll,
    getBrokerPort: ({ instanceId } = {}) => createPortFacade({ entry: getEntry({ instanceId }), connectAll, disconnectAll }),
    getDescriptor: ({ instanceId } = {}) => getEntry({ instanceId }).descriptor,
    descriptors: Object.freeze(descriptors.slice()),
  })
}
