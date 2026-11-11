import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateAppConfig } from '../../domain/app-config.js';

const DEFAULT_CONFIG_URL = new URL('../../../config.json', import.meta.url);

/**
 * Read, parse, and validate application configuration.
 *
 * The default file is apps/harvester/config.json. Supplying a URL or
 * filesystem path makes the loader straightforward to exercise in tests and
 * useful for deployments that keep configuration outside the package.
 */
export async function loadAppConfig(source = DEFAULT_CONFIG_URL) {
  const sourcePath = source instanceof URL ? fileURLToPath(source) : source;
  let contents;

  try {
    contents = await readFile(sourcePath, 'utf8');
  } catch (cause) {
    throw new Error(`Unable to read app config from "${sourcePath}": ${cause.message}`, { cause });
  }

  let config;
  try {
    config = JSON.parse(contents);
  } catch (cause) {
    throw new SyntaxError(`Unable to parse app config from "${sourcePath}": ${cause.message}`, { cause });
  }

  return validateAppConfig(config);
}
