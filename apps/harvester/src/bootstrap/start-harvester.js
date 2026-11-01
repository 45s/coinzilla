import { loadTradingConfig } from '../infrastructure/config/load-trading-config.js';
import { createBinanceBrokerAdapter } from '../infrastructure/brokers/binance-broker-adapter.js';
import { assertBrokerPort } from '../application/ports/broker.port.js';

/**
 * Load configuration and optionally connect the explicitly selected broker.
 *
 * Broker connectivity is opt-in through HARVESTER_BROKER=binance. No orders
 * are submitted here; strategy execution remains disabled until its contracts
 * and unresolved trading rules are implemented.
 */
export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
} = {}) {
  const tradingConfig = await loadConfig(configSource);
  const brokerName = env.HARVESTER_BROKER;

  if (brokerName === undefined || brokerName === '') {
    return Object.freeze({
      tradingConfig,
      broker: undefined,
      connected: false,
      stop: async () => {},
    });
  }

  if (brokerName !== 'binance') {
    throw new Error(`Unsupported HARVESTER_BROKER value: ${brokerName}`);
  }

  const broker = assertBrokerPort({
    broker: brokerAdapterFactory({
      config: {
        apiKey: env.BINANCE_API_KEY,
        apiSecret: env.BINANCE_API_SECRET_KEY,
      },
    }),
  });

  try {
    await broker.connect();
  } catch (error) {
    try {
      await broker.disconnect();
    } catch (disconnectError) {
      throw new AggregateError(
        [error, disconnectError],
        "Harvester broker connection failed and disconnect cleanup also failed",
      )
    }
    throw error;
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await broker.disconnect();
  };

  return Object.freeze({
    tradingConfig,
    broker,
    connected: true,
    stop,
  });
}
