import path from "node:path"
import { defaultLogger } from "@coinzilla/utils"
import { initializeHarvesterDurableFactsLedger } from "./initialize-durable-facts-ledger.js"

/**
 * Run the one-time genesis command with an explicit absolute directory and
 * exactly one confirmation argument. The runtime uses the same directory.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string[]} [options.args]
 * @param {Function} [options.initialize]
 * @param {object} [options.logger]
 * @returns {Promise<number>} Process exit code.
 */
export async function runInitializeDurableFactsLedger({
  env = process.env,
  args = process.argv.slice(2),
  initialize = initializeHarvesterDurableFactsLedger,
  logger = defaultLogger,
} = {}) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== "--confirm-initialize") {
    logger.error?.({
      message: "Durable-facts genesis requires exactly --confirm-initialize; unknown arguments are not accepted.",
    })
    return 1
  }
  const directory = env?.DURABLE_FACTS_DIRECTORY
  if (typeof directory !== "string" ||
      !directory.trim() ||
      directory !== directory.trim() ||
      !path.isAbsolute(directory)) {
    logger.error?.({
      message: "DURABLE_FACTS_DIRECTORY must be set to an absolute local filesystem path before genesis initialization.",
    })
    return 1
  }
  let result
  try {
    result = await initialize({ confirmed: true, directory: path.resolve(directory) })
  } catch (error) {
    result = { ok: false, errors: [error] }
  }
  if (result?.ok === true && result.data?.durable === true) {
    logger.system?.(
      "Harvester recovery-facts genesis initialized at " + result.data.directory +
      " (sequence " + result.data.sequence + ").",
    )
    return 0
  }
  logger.error?.({
    message: "Harvester recovery-facts genesis was not initialized.",
    errors: result?.errors ?? [new Error("Genesis initialization did not confirm a durable commit")],
  })
  return 1
}
