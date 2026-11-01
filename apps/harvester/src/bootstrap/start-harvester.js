import { loadTradingConfig } from '../infrastructure/config/load-trading-config.js';

/**
 * Perform the startup work that is defined today.
 *
 * Configuration must be loaded and validated before startup is considered
 * successful. No business workflow is started until Harvester's product
 * responsibility and processing contract have been agreed.
 */
export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
} = {}) {
  const tradingConfig = await loadConfig(configSource);

  return Object.freeze({ tradingConfig });
}
