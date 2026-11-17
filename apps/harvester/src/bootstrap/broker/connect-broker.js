import { createProviderRegistry } from "../../application/providers/provider-registry.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
} from "../../application/events/lifecycle-event-dtos.js"

function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

/**
 * Construct and register the configured Binance instance, connect it through the registry,
 * and publish the existing broker lifecycle evidence.
 * Connection failure still attempts registry-owned disconnect and aggregates both failures.
 */
export async function connectBroker({
  brokerAdapterFactory,
  env,
  brokerName,
  providerType,
  providerInstanceId,
  accountId,
  tradingMode,
  eventPublisher,
  logger,
} = {}) {
  const broker = brokerAdapterFactory({
    config: {
      apiKey: env.BINANCE_API_KEY,
      apiSecret: env.BINANCE_API_SECRET_KEY,
      tradingMode,
    },
  })
  let providerRegistry
  let provider
  try {
    providerRegistry = createProviderRegistry({
      providers: [{
        providerInstanceId,
        providerType,
        accountId,
        environment: tradingMode,
        broker,
      }],
    })
    provider = providerRegistry.get(providerInstanceId)
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

  let providersConnected = false
  try {
    logSystem({ logger,
message: "Connecting to Binance broker" })

    await providerRegistry.connectAll()
    providersConnected = true
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
      dataResult: mapBrokerConnectedData({ broker: brokerName }),
    })
  } catch (error) {
    const secondaryErrors = []
    try {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
        dataResult: mapBrokerConnectionFailedData({ broker: brokerName,
error }),
      })
    } catch (eventError) {
      secondaryErrors.push(eventError)
    }
    try {
      logger.error?.({
        message: "Binance broker connection failed",
        errorName: error?.name,
        errorMessage: error?.message ?? String(error),
        errorStack: error?.stack,
      })
    } catch (loggingError) {
      secondaryErrors.push(loggingError)
    }
    if (providersConnected) {
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

  return { providerRegistry, provider }
}
