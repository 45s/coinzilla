import { startHarvester } from "./bootstrap/start-harvester.js";

function toLoggableError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

/**
 * CLI application entry point. The executable composition root supplies the
 * logger; this module and the bootstrap remain independently testable.
 */
export async function main({
  start = startHarvester,
  logger,
} = {}) {
  if (
    !logger
    || typeof logger.info !== "function"
    || typeof logger.error !== "function"
  ) {
    throw new TypeError("Harvester logger must provide info and error methods");
  }

  try {
    const runtime = await start({ logger });
    logger.info({
      message: runtime.connected
        ? `Harvester configuration validated; Binance connected and subscribed to ${runtime.subscriptions.length} enabled market(s). Trading remains disabled.`
        : "Harvester configuration validated; broker connection and market data are disabled.",
    });

    if (runtime.connected && typeof runtime.stop === "function") {
      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
          await runtime.stop();
          logger.info({ message: "Harvester broker disconnected." });
        } catch (error) {
          logger.error({
            message: "Harvester shutdown failed.",
            error: toLoggableError(error),
          });
          process.exitCode = 1;
        }
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
  } catch (error) {
    logger.error({
      message: "Harvester startup failed.",
      error: toLoggableError(error),
    });
    process.exitCode = 1;
  }
}
