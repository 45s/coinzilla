import { pathToFileURL } from 'node:url';
import { startHarvester } from './bootstrap/start-harvester.js';

/**
 * CLI entry point. Startup errors are reported once and produce a non-zero
 * process exit code; they are never converted into a successful startup.
 */
export async function main({
  start = startHarvester,
  logger = console,
} = {}) {
  try {
    const runtime = await start();
    logger.info(
      runtime.connected
        ? `Harvester configuration validated; Binance connected and subscribed to ${runtime.subscriptions.length} enabled market(s). Trading remains disabled.`
        : 'Harvester configuration validated; broker connection and market data are disabled.',
    );

    if (runtime.connected && typeof runtime.stop === 'function') {
      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
          await runtime.stop();
          logger.info('Harvester broker disconnected.');
        } catch (error) {
          logger.error('Harvester shutdown failed.', error);
          process.exitCode = 1;
        }
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
  } catch (error) {
    logger.error('Harvester startup failed.', error);
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  await main();
}
