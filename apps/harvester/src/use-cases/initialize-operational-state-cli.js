import { defaultLogger } from "@coinzilla/utils"
import { resolveOperationalStateDirectory } from "../infrastructure/operational-state/resolve-operational-state-directory.js"
import { initializeHarvesterOperationalStateStore } from "./initialize-operational-state-store.js"

/**
 * Run the one-time initializer with exactly one confirmation argument.
 * The app-local default or the same configured override is used by runtime.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string[]} [options.args]
 * @param {Function} [options.initialize]
 * @param {object} [options.logger]
 * @returns {Promise<number>} Process exit code.
 */
export async function runInitializeOperationalState({
  env = process.env,
  args = process.argv.slice(2),
  initialize = initializeHarvesterOperationalStateStore,
  logger = defaultLogger,
} = {}) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== "--confirm-initialize") {
    logger.error?.({
      message: "Operational State Store initialization requires exactly --confirm-initialize; unknown arguments are not accepted.",
    })
    return 1
  }
  let directory
  try {
    directory = resolveOperationalStateDirectory({ env })
  } catch (error) {
    logger.error?.({ message: error.message })
    return 1
  }
  let result
  try {
    result = await initialize({ confirmed: true, directory })
  } catch (error) {
    result = { ok: false, errors: [error] }
  }
  if (result?.ok === true && result.data?.durable === true) {
    logger.system?.(
      "Harvester Operational State Store initialized at " + result.data.directory +
      " (sequence " + result.data.sequence + ").",
    )
    return 0
  }
  logger.error?.({
    message: "Harvester Operational State Store was not initialized.",
    errors: result?.errors ?? [new Error("Genesis initialization did not confirm a durable commit")],
  })
  return 1
}
