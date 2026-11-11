import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { validateAppConfig } from "../../src/domain/app-config.js"
import { addPairToAppConfig } from "./configuration.js"

async function removeIfPresent(filePath) {
  try {
    await unlink(filePath)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

/** Merge a new pair into config.json and atomically replace the file under an exclusive generator lock. */
export async function writePairConfigAtomically({ configPath, symbol, pairConfig } = {}) {
  if (typeof configPath !== "string" || !configPath.trim()) {
    throw new TypeError("configPath must be a non-empty file path")
  }
  const absoluteConfigPath = path.resolve(configPath)
  const lockPath = absoluteConfigPath + ".config-symbol.lock"
  const directory = path.dirname(absoluteConfigPath)
  const temporaryPath = path.join(
    directory,
    "." + path.basename(absoluteConfigPath) + "." + randomUUID() + ".tmp",
  )

  let lockHandle
  let temporaryCreated = false
  try {
    try {
      lockHandle = await open(lockPath, "wx", 0o600)
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Another config:symbol operation holds the configuration lock; inspect and remove a stale lock only after confirming no generator is running")
      }
      throw error
    }

    let currentConfigText
    try {
      currentConfigText = await readFile(absoluteConfigPath, "utf8")
    } catch (cause) {
      throw new Error("Unable to read Harvester config.json at " + absoluteConfigPath + ": " + cause.message, { cause })
    }

    let currentConfig
    try {
      currentConfig = JSON.parse(currentConfigText)
    } catch (cause) {
      throw new SyntaxError("Harvester config.json is not valid JSON: " + cause.message, { cause })
    }
    validateAppConfig(currentConfig)

    const updatedConfig = addPairToAppConfig({
      appConfig: currentConfig,
      symbol,
      pairConfig,
    })
    const serializedConfig = JSON.stringify(updatedConfig, null, 2) + "\n"
    const originalMode = (await stat(absoluteConfigPath)).mode & 0o777

    await writeFile(temporaryPath, serializedConfig, {
      encoding: "utf8",
      flag: "wx",
      mode: originalMode,
    })
    temporaryCreated = true
    await rename(temporaryPath, absoluteConfigPath)
    temporaryCreated = false
    return absoluteConfigPath
  } finally {
    if (temporaryCreated) await removeIfPresent(temporaryPath)
    if (lockHandle) {
      await lockHandle.close()
      await removeIfPresent(lockPath)
    }
  }
}
