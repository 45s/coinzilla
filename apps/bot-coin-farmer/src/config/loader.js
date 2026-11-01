import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_CONFIG_PATH = fileURLToPath(
  new URL("../../config/coin-farmer.config.json", import.meta.url),
)

/**
 * Load the application JSON configuration.
 *
 * @param {{ configPath?: string }} options
 * @returns {Promise<unknown>}
 */
export async function loadConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  if (typeof configPath !== "string" || configPath.trim() === "") {
    throw new TypeError("configPath must be a non-empty string")
  }

  const absolutePath = resolve(configPath)

  let contents
  try {
    contents = await readFile(absolutePath, "utf8")
  } catch (error) {
    throw new Error(`Unable to read Coin Farmer config at ${absolutePath}`, {
      cause: error,
    })
  }

  try {
    return JSON.parse(contents)
  } catch (error) {
    throw new SyntaxError(
      `Coin Farmer config contains invalid JSON at ${absolutePath}`,
      { cause: error },
    )
  }
}

