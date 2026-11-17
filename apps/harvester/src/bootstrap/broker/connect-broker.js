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
  const providerRegistry = createProviderRegistry({
    providers: [{
      providerInstanceId,
      providerType,
      accountId,
      environment: tradingMode,
      broker,
    }],
  })
  const provider = providerRegistry.get(providerInstanceId)

  try {
    logSystem({ logger,
message: "Connecting to Binance broker" })

    await providerRegistry.connect(providerInstanceId)
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
      dataResult: mapBrokerConnectedData({ broker: brokerName }),
    })
  } catch (error) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
      dataResult: mapBrokerConnectionFailedData({ broker: brokerName,
error }),
    })
    logger.error?.({
      message: "Binance broker connection failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
    try {
      await providerRegistry.disconnect(providerInstanceId)
    } catch (disconnectError) {
      throw new AggregateError(
        [error, disconnectError],
        "Harvester broker connection failed and disconnect cleanup also failed",
        { cause: disconnectError },
      )
    }
    throw error
  }

  return { providerRegistry, provider }
}
