import { defaultLogger } from "@coinzilla/utils"

function hasExplicitConfirmation({ args }) {
  return Array.isArray(args) && args.length === 1 && args[0] === "--confirm-initialize"
}

function validateInitializationRequest({
  args,
  initialize,
  resolveDirectory,
  logger
,
}) {
  if (!hasExplicitConfirmation({ args })) {
    logger.error?.({
      message: "Operational State Store initialization requires exactly --confirm-initialize; unknown arguments are not accepted.",
    })
    return false
  }
  if (typeof initialize !== "function" || typeof resolveDirectory !== "function") {
    logger.error?.({
      message: "Operational State Store initialization requires injected directory resolver and initializer adapters.",
    })
    return false
  }
  return true
}

/**
 * Run the one-time initializer with exactly one confirmation argument.
 * The app-local default or the same configured override is used by runtime.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string[]} [options.args]
 * @param {Function} options.initialize
 * @param {Function} options.resolveDirectory
 * @param {object} [options.logger]
 * @returns {Promise<number>} Process exit code.
 */
function resolveInitializationDirectory({
  env,
  resolveDirectory,
  logger
,
}) {
  try {
    return {
      ok: true,
      directory: resolveDirectory({ env })
    ,
    }
  } catch (error) {
    logger.error?.({ message: error.message })
    return { ok: false }
  }
}

async function invokeOperationalStateInitializer({
  initialize,
  directory
,
}) {
  try {
    return await initialize({
      confirmed: true,
      directory,
    })
  } catch (error) {
    return {
      ok: false,
      errors: [error],
    }
  }
}

function reportOperationalStateInitialization({
  result,
  logger
,
}) {
  if (result?.ok === true && result.data?.durable === true) {
    logger.system?.(
      `Harvester Operational State Store initialized at ${  result.data.directory
      } (sequence ${  result.data.sequence  }).`,
    )
    return 0
  }
  logger.error?.({
    message: "Harvester Operational State Store was not initialized.",
    errors: result?.errors ?? [new Error("Genesis initialization did not confirm a durable commit")],
  })
  return 1
}

export async function runInitializeOperationalState({
  env = process.env,
  args = process.argv.slice(2),
  initialize,
  resolveDirectory,
  logger = defaultLogger,
} = {}) {
  if (!validateInitializationRequest({
    args,
    initialize,
    resolveDirectory,
    logger
  ,
  })) {
    return 1
  }
  const resolved = resolveInitializationDirectory({
    env,
    resolveDirectory,
    logger
  ,
  })
  if (!resolved.ok) {
    return 1
  }
  const result = await invokeOperationalStateInitializer({
    initialize,
    directory: resolved.directory,
  })
  return reportOperationalStateInitialization({
    result,
    logger
  ,
  })
}
