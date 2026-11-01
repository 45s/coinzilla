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
    await start();
    logger.info('Harvester configuration validated; no processing workflow is configured yet.');
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
