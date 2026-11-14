import { open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { validateAppConfig } from "../../src/domain/app-config.js"
import { addPairToAppConfig } from "./configuration.js"
import { insertPairConfiguration } from "./config-source.js"

async function removeIfPresent(filePath) {
  try {
    await unlink(filePath)
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error
    }
  }
}

async function removeStaleTemporaryFiles(directory, configFileName) {
  const prefix = "." + configFileName + "."
  const entries = await readdir(directory)
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(".tmp.mjs")) {
      await removeIfPresent(path.join(directory, entry))
    }
  }
}

async function importAppConfig(configPath) {
  const moduleUrl = pathToFileURL(configPath)
  moduleUrl.searchParams.set("config-symbol-load", randomUUID())

  let configModule
  try {
    configModule = await import(moduleUrl.href)
  } catch (cause) {
    const message = "Unable to load CG coin-grabber strategy config module at " + configPath + ": " + cause.message
    if (cause instanceof SyntaxError) {
      throw new SyntaxError(message, { cause })
    }
    throw new Error(message, { cause })
  }

  if (!Object.hasOwn(configModule, "CG_COIN_GRABBER_CONFIG")) {
    throw new TypeError("CG coin-grabber config module must export a named CG_COIN_GRABBER_CONFIG value")
  }
  return { strategies: { CG_coinGrabber: configModule.CG_COIN_GRABBER_CONFIG } }
}

/**
 * Insert a new pair into the CG coin-grabber strategy pairs object and atomically replace the strategy module.
 *
 * @param {{configPath: string, symbol: string, pairConfig: object}} options - Target config and generated pair.
 * @returns {Promise<string>} Absolute path of the updated config module.
 * @throws {Error|TypeError} If the module, pair, insertion target, lock, or write is invalid.
 */
export async function writePairConfigAtomically({ configPath, symbol, pairConfig } = {}) {
  if (typeof configPath !== "string" || !configPath.trim()) {
    throw new TypeError("configPath must be a non-empty file path")
  }
  const absoluteConfigPath = path.resolve(configPath)
  const lockPath = absoluteConfigPath + ".config-symbol.lock"
  const directory = path.dirname(absoluteConfigPath)
  const configFileName = path.basename(absoluteConfigPath)
  const temporaryPath = path.join(
    directory,
    "." + configFileName + "." + randomUUID() + ".tmp.mjs",
  )

  let lockHandle
  let temporaryCreated = false
  try {
    try {
      lockHandle = await open(lockPath, "wx", 0o600)
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Another config:symbol operation holds the configuration lock; inspect its PID/timestamp and remove a stale lock only after confirming no generator is running", { cause: error })
      }
      throw error
    }
    await lockHandle.writeFile(JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
    }) + "\n", "utf8")
    await removeStaleTemporaryFiles(directory, configFileName)

    let currentConfigText
    try {
      currentConfigText = await readFile(absoluteConfigPath, "utf8")
    } catch (cause) {
      throw new Error("Unable to read CG coin-grabber strategy config module at " + absoluteConfigPath + ": " + cause.message, { cause })
    }

    const currentConfig = await importAppConfig(absoluteConfigPath)
    validateAppConfig(currentConfig)
    const updatedConfig = addPairToAppConfig({
      appConfig: currentConfig,
      symbol,
      pairConfig,
    })
    const updatedSource = insertPairConfiguration({
      source: currentConfigText,
      symbol,
      pairConfig,
    })
    const originalMode = (await stat(absoluteConfigPath)).mode & 0o777

    temporaryCreated = true
    await writeFile(temporaryPath, updatedSource, {
      encoding: "utf8",
      flag: "wx",
      mode: originalMode,
    })

    const temporaryConfig = await importAppConfig(temporaryPath)
    validateAppConfig(temporaryConfig)
    if (!isDeepStrictEqual(temporaryConfig, updatedConfig)) {
      throw new Error("Generated CG coin-grabber strategy module does not match the validated pair update")
    }

    await rename(temporaryPath, absoluteConfigPath)
    temporaryCreated = false
    return absoluteConfigPath
  } finally {
    try {
      if (temporaryCreated) {
        await removeIfPresent(temporaryPath)
      }
    } finally {
      if (lockHandle) {
        try {
          await lockHandle.close()
        } finally {
          await removeIfPresent(lockPath)
        }
      }
    }
  }
}
