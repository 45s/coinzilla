import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { createContainer } from "./bootstrap/container.js"
import {
  installSignalHandlers,
  startRuntime,
} from "./bootstrap/startup.js"
import { loadConfig } from "./config/loader.js"
import { validateConfig } from "./config/validator.js"

export async function main({
  configPath = process.env.CF_CONFIG_PATH,
  logger,
  journalDirectory,
} = {}) {
  const config = await loadConfig(
    configPath === undefined ? {} : { configPath },
  )
  const validation = validateConfig(config)

  if (!validation.ok) {
    throw new Error(
      `Invalid Coin Farmer configuration:\n- ${validation.errors.join("\n- ")}`,
    )
  }

  const runtime = createContainer({
    config: validation.data,
    logger,
    journalDirectory,
  })

  await startRuntime(runtime)
  installSignalHandlers({ runtime })

  return runtime
}

const isMainModule = process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  try {
    await main()
  } catch (error) {
    console.error("Coin Farmer failed to start", error)
    process.exitCode = 1
  }
}
