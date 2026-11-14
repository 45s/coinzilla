import { open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { appConfig } from "../../config/index.js"
import { validateAppConfig } from "../../src/domain/app-config.js"
import { insertTradingPairConfiguration } from "./config-source.js"

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

async function importTradingPairs(configPath) {
  const moduleUrl = pathToFileURL(configPath)
  moduleUrl.searchParams.set("config-symbol-load", randomUUID())
  let configModule
  try {
    configModule = await import(moduleUrl.href)
  } catch (cause) {
    const message = "Unable to load CG coin-grabber trading-pairs config at " + configPath + ": " + cause.message
    if (cause instanceof SyntaxError) {
      throw new SyntaxError(message, { cause })
    }
    throw new Error(message, { cause })
  }
  if (!Object.hasOwn(configModule, "tradingPairs")) {
    throw new TypeError("CG coin-grabber config module must export a named tradingPairs object")
  }
  return configModule.tradingPairs
}

function createValidatedAppConfig(pairs) {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs,
      },
    },
  }
}

/**
 * Add one pair to the external tradingPairs module and atomically replace it.
 *
 * @param {{configPath: string, symbol: string, pairConfig: object}} options - Target config and generated pair.
 * @returns {Promise<string>} Absolute path of the updated config module.
 */
export async function writePairConfigAtomically({ configPath, symbol, pairConfig } = {}) {
  if (typeof configPath !== "string" || !configPath.trim()) {
    throw new TypeError("configPath must be a non-empty file path")
  }
  const absoluteConfigPath = path.resolve(configPath)
  const lockPath = absoluteConfigPath + ".config-symbol.lock"
  const directory = path.dirname(absoluteConfigPath)
  const configFileName = path.basename(absoluteConfigPath)
  const temporaryPath = path.join(directory, "." + configFileName + "." + randomUUID() + ".tmp.mjs")
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
    await lockHandle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n", "utf8")
    await removeStaleTemporaryFiles(directory, configFileName)

    let currentSource
    try {
      currentSource = await readFile(absoluteConfigPath, "utf8")
    } catch (cause) {
      throw new Error("Unable to read CG coin-grabber trading-pairs config at " + absoluteConfigPath + ": " + cause.message, { cause })
    }
    const currentPairs = await importTradingPairs(absoluteConfigPath)
    validateAppConfig(createValidatedAppConfig(currentPairs))
    if (Object.hasOwn(currentPairs, symbol)) {
      throw new Error("Pair " + symbol + " already exists in CG coin-grabber trading-pairs config; refusing to overwrite it")
    }
    const updatedPairs = { ...currentPairs, [symbol]: pairConfig }
    const updatedSource = insertTradingPairConfiguration({ source: currentSource, symbol, pairConfig })
    const originalMode = (await stat(absoluteConfigPath)).mode & 0o777

    temporaryCreated = true
    await writeFile(temporaryPath, updatedSource, { encoding: "utf8", flag: "wx", mode: originalMode })
    const temporaryPairs = await importTradingPairs(temporaryPath)
    validateAppConfig(createValidatedAppConfig(temporaryPairs))
    if (!isDeepStrictEqual(temporaryPairs, updatedPairs)) {
      throw new Error("Generated tradingPairs module does not match the validated pair update")
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
