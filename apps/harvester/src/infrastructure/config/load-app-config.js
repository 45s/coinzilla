import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { validateAppConfig } from "../../domain/app-config.js"
import { resolvePairSpecifications } from "./token-specifications.js"

const DEFAULT_CONFIG_URL = new URL("../../../config/index.js", import.meta.url)
const DEFAULT_TOKEN_SPECIFICATIONS_PATH = fileURLToPath(new URL("../../../token-specification.json", import.meta.url))

function resolveConfigUrl(source) {
  if (source instanceof URL) {
    return new URL(source.href)
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new TypeError("App config source must be a file URL or non-empty filesystem path")
  }
  return pathToFileURL(resolve(source))
}

async function readTokenSpecifications(specificationPath) {
  let source
  try {
    source = await readFile(specificationPath, "utf8")
  } catch (cause) {
    throw new Error(`Unable to read Harvester token specifications at ${specificationPath}: ${cause.message}`, { cause })
  }

  try {
    return JSON.parse(source)
  } catch (cause) {
    throw new Error(`Harvester token specifications at ${specificationPath} are not valid JSON`, { cause })
  }
}

/**
 * Load and validate the named appConfig export, enriching strategy pairs from the shared token registry.
 *
 * The default app config is apps/harvester/config/index.js and the default token
 * registry is apps/harvester/token-specification.json. Precision is resolved
 * by exact market symbol; strategy-owned pair files never duplicate it.
 *
 * @param {object|string|URL} [sourceOrOptions] - ESM source or loader options.
 * @returns {Promise<object>} Validated effective application configuration.
 * @throws {TypeError|SyntaxError|Error} If either source is missing, malformed, or inconsistent.
 */
export async function loadAppConfig(sourceOrOptions = {}) {
  const options = sourceOrOptions instanceof URL || typeof sourceOrOptions === "string"
    ? { source: sourceOrOptions }
    : sourceOrOptions
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("App config options must be a file URL, path, or options object")
  }
  const source = options.source ?? DEFAULT_CONFIG_URL
  const tokenSpecificationsPath = options.tokenSpecificationsPath ?? DEFAULT_TOKEN_SPECIFICATIONS_PATH
  if (typeof tokenSpecificationsPath !== "string" || !tokenSpecificationsPath.trim()) {
    throw new TypeError("tokenSpecificationsPath must be a non-empty file path")
  }
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

  const tokenSpecifications = await readTokenSpecifications(resolve(tokenSpecificationsPath))
  const rawConfig = configModule.appConfig
  const strategy = rawConfig?.strategies?.CG_coinGrabber
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
    return validateAppConfig(rawConfig)
  }

  let resolvedPairs
  try {
    resolvedPairs = resolvePairSpecifications({
      pairs: strategy.pairs,
      tokenSpecifications,
    })
  } catch (cause) {
    throw new Error(`Unable to resolve configured market precision using token specifications at ${resolve(tokenSpecificationsPath)}: ${cause.message}`, { cause })
  }

  const effectiveConfig = {
    ...rawConfig,
    strategies: {
      ...rawConfig.strategies,
      CG_coinGrabber: {
        ...strategy,
        pairs: resolvedPairs,
      },
    },
  }
  return validateAppConfig(effectiveConfig)
}
