import { createProviderRegistry } from "../../application/providers/provider-registry.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
} from "../../application/events/lifecycle-event-dtos.js"
import { resolveBinanceProviderIdentity } from "../../domain/provider-identity.js"

function logSystem({ logger, ...data }) {
  const write = typeof logger?.system === "function" ? logger.system : logger?.info
  write?.call(logger, data)
}

async function createRegisteredProvider({ broker, identity, tradingMode }) {
  try {
    return createProviderRegistry({
      providers: [{
        ...identity,
        environment: tradingMode,
        broker,
      }],
    })
  } catch (error) {
    try {
      if (typeof broker?.disconnect === "function") {
        await broker.disconnect()
      }
    } catch (disconnectError) {
      throw new AggregateError(
        [error, disconnectError],
        `Provider ${identity.providerType} validation failed and constructed-client cleanup also failed`,
        { cause: disconnectError },
      )
    }
    throw error
  }
}

function publishConnectionFailure({ eventPublisher, brokerName, providerType, error, logger }) {
  const secondaryErrors = []
  try {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
      dataResult: mapBrokerConnectionFailedData({
        broker: brokerName,
        error,
      }),
    })
  } catch (eventError) {
    secondaryErrors.push(eventError)
  }
  try {
    logger?.error?.({
      message: `${providerType === "binance" ? "Binance" : providerType} broker connection failed`,
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
  } catch (loggingError) {
    secondaryErrors.push(loggingError)
  }
  return secondaryErrors
}

function assertRequiredCapabilities({ provider, requiredCapabilities }) {
  for (const capabilityType of requiredCapabilities) {
    const status = typeof provider.capabilities?.getStatus === "function"
      ? provider.capabilities.getStatus({ type: capabilityType })
      : "UNKNOWN"
    if (status !== "SUPPORTED") {
      const error = new Error(
        `Provider ${provider.providerInstanceId} requires ${capabilityType}; capability status is ${status}`,
      )
      error.code = "HARVESTER_PROVIDER_CAPABILITY_UNAVAILABLE"
      error.context = {
        providerInstanceId: provider.providerInstanceId,
        capabilityType,
        status,
      }
      throw error
    }
  }
}

async function disconnectProviderAfterStartupFailure({ providerRegistry, error, message }) {
  try {
    await providerRegistry.disconnectAll()
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      message,
      { cause: cleanupError },
    )
  }
  throw error
}

async function connectRegisteredProviders({ providerRegistry, brokerName, providerType, eventPublisher, logger }) {
  let connected = false
  try {
    logSystem({
      logger,
      message: `Connecting to ${providerType === "binance" ? "Binance" : providerType} broker`,
    })
    await providerRegistry.connectAll()
    connected = true
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
      dataResult: mapBrokerConnectedData({ broker: brokerName }),
    })
  } catch (error) {
    const secondaryErrors = publishConnectionFailure({
      eventPublisher,
      brokerName,
      providerType,
      error,
      logger,
    })
    if (connected) {
      try {
        await providerRegistry.disconnectAll()
      } catch (disconnectError) {
        secondaryErrors.push(disconnectError)
      }
    }
    if (secondaryErrors.length > 0) {
      throw new AggregateError(
        [error, ...secondaryErrors],
        "Harvester provider startup failed and secondary cleanup/reporting also failed",
        { cause: error },
      )
    }
    throw error
  }
}

/**
 * Construct the configured provider instance at the composition boundary and connect it through the registry.
 * @returns {Promise<object>} The registered Harvester BrokerPort facade.
 */
function assertBrokerConnectionOptions({ requiredCapabilities, onBrokerConnected }) {
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.some((capability) =>
    typeof capability !== "string" || !capability.trim()
  )) {
    throw new TypeError("requiredCapabilities must be an array of non-empty capability identifiers")
  }
  if (onBrokerConnected !== undefined && typeof onBrokerConnected !== "function") {
    throw new TypeError("onBrokerConnected must be a function when supplied")
  }
}

function resolveConnectedProviderIdentity({
  configuredProviderIdentity,
  tradingMode,
  env,
}) {
  return configuredProviderIdentity ?? resolveBinanceProviderIdentity({
    tradingMode,
    providerInstanceId: env.BINANCE_PROVIDER_INSTANCE_ID,
    accountId: env.BINANCE_ACCOUNT_ID,
  })
}

async function notifyBrokerConnected({
  onBrokerConnected,
  identity,
  provider,
  providerRegistry,
}) {
  if (!onBrokerConnected) {
    return
  }
  try {
    await onBrokerConnected({
      providerInstanceId: identity.providerInstanceId,
      broker: provider.broker,
    })
  } catch (error) {
    await disconnectProviderAfterStartupFailure({
      providerRegistry,
      error,
      message: "Provider registration callback failed and connection cleanup also failed",
    })
  }
}

export async function connectBroker({
  brokerAdapterFactory,
  env,
  brokerName,
  tradingMode,
  providerIdentity: configuredProviderIdentity,
  eventPublisher,
  logger,
  requiredCapabilities = [],
  onBrokerConnected,
} = {}) {
  assertBrokerConnectionOptions({ requiredCapabilities, onBrokerConnected })
  const identity = resolveConnectedProviderIdentity({
    configuredProviderIdentity,
    tradingMode,
    env,
  })
  const broker = await brokerAdapterFactory({
    config: {
      apiKey: env.BINANCE_API_KEY,
      apiSecret: env.BINANCE_API_SECRET_KEY,
      tradingMode,
    },
  })
  const providerRegistry = await createRegisteredProvider({
    broker,
    identity,
    tradingMode,
  })
  const provider = providerRegistry.get(identity.providerInstanceId)
  try {
    assertRequiredCapabilities({
      provider,
      requiredCapabilities,
    })
  } catch (error) {
    await disconnectProviderAfterStartupFailure({
      providerRegistry,
      error,
      message: "Provider capability validation failed and constructed-client cleanup also failed",
    })
  }
  await connectRegisteredProviders({
    providerRegistry,
    brokerName,
    providerType: identity.providerType,
    eventPublisher,
    logger,
  })
  await notifyBrokerConnected({
    onBrokerConnected,
    identity,
    provider,
    providerRegistry,
  })
  return provider.broker
}
