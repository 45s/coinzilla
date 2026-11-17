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
        "Binance provider validation failed and constructed-client cleanup also failed",
        { cause: disconnectError },
      )
    }
    throw error
  }
}

function publishConnectionFailure({ eventPublisher, brokerName, error, logger }) {
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
      message: "Binance broker connection failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
  } catch (loggingError) {
    secondaryErrors.push(loggingError)
  }
  return secondaryErrors
}

async function connectRegisteredProviders({ providerRegistry, brokerName, eventPublisher, logger }) {
  let connected = false
  try {
    logSystem({
      logger,
      message: "Connecting to Binance broker",
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
 * Construct the configured Binance instance at the composition boundary and connect it through the registry.
 * @returns {Promise<object>} The registered Harvester BrokerPort facade.
 */
export async function connectBroker({
  brokerAdapterFactory,
  env,
  brokerName,
  tradingMode,
  eventPublisher,
  logger,
} = {}) {
  const identity = resolveBinanceProviderIdentity({
    tradingMode,
    providerInstanceId: env.BINANCE_PROVIDER_INSTANCE_ID,
    accountId: env.BINANCE_ACCOUNT_ID,
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
  await connectRegisteredProviders({
    providerRegistry,
    brokerName,
    eventPublisher,
    logger,
  })
  return providerRegistry.get(identity.providerInstanceId).broker
}
