import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { validateAppConfig } from "../../domain/app-config.js"

const DEFAULT_CONFIG_URL = new URL("../../../config/index.js", import.meta.url)

function resolveConfigUrl(source) {
  if (source instanceof URL) {
    return new URL(source.href)
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new TypeError("App config source must be a file URL or non-empty filesystem path")
  }
  return pathToFileURL(resolve(source))
}

/**
 * Load and validate the named appConfig export from a native ESM module.
 *
 * The default module is apps/harvester/config/index.js. Supplying a file URL
 * or filesystem path keeps alternate deployment locations straightforward to
 * exercise in tests. A unique query parameter avoids Node's ESM module cache
 * returning stale configuration after an operator edits the source file.
 *
 * @param {URL|string} [source] - ESM config module URL or filesystem path.
 * @returns {Promise<object>} Validated application configuration.
 * @throws {TypeError|SyntaxError|Error} If the module cannot be loaded or its export is invalid.
 */
export async function loadAppConfig(source = DEFAULT_CONFIG_URL) {
  const sourceUrl = resolveConfigUrl(source)
  const sourcePath = fileURLToPath(sourceUrl)
  const importUrl = new URL(sourceUrl.href)
  importUrl.searchParams.set("app-config-load", randomUUID())

  let configModule
  try {
    configModule = await import(importUrl.href)
  } catch (cause) {
    const message = `Unable to load app config module from "${sourcePath}": ${cause.message}`
    if (cause instanceof SyntaxError) {
      throw new SyntaxError(message, { cause })
    }
    throw new Error(message, { cause })
  }

  if (!Object.hasOwn(configModule, "appConfig")) {
    throw new TypeError(`App config module at "${sourcePath}" must export a named appConfig value`)
  }

  return validateAppConfig(configModule.appConfig)
}
