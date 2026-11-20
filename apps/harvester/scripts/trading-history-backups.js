import { pathToFileURL } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import { createHarvesterTradingHistoryBackupService } from "../src/infrastructure/persistence/trading-history-backups/index.js"

function parseArguments(args) {
  const [command, ...rest] = args
  if (command === "create") {
    if (rest.length === 0) {
      return {
        command,
        keep: 30,
      }
    }
    if (rest.length !== 2 || rest[0] !== "--keep") {
      throw new TypeError("Usage: persistence:backup [--keep <count>]")
    }
    const keep = Number(rest[1])
    if (!Number.isSafeInteger(keep) || keep < 1 || keep > 3650) {
      throw new TypeError("Backup retention count must be between 1 and 3650.")
    }
    return {
      command,
      keep,
    }
  }
  if (command === "verify" && rest.length === 1) {
    return {
      command,
      backupFilename: rest[0],
    }
  }
  throw new TypeError(
    "Usage: persistence:backup [--keep <count>] | persistence:restore-check <backup-file>",
  )
}

function logFailure(logger, error) {
  logger.error({
    message: "Harvester trading-history backup command failed.",
    errorName: error.name,
    errorCode: error.code ?? "HARVESTER_HISTORY_BACKUP_COMMAND_FAILED",
    context: error.context ?? {},
  })
}

export async function runTradingHistoryBackupCommand({
  args = process.argv.slice(2),
  env = process.env,
  logger = defaultLogger,
  createService = createHarvesterTradingHistoryBackupService,
} = {}) {
  try {
    const parsed = parseArguments(args)
    if (env.TRADING_MODE !== "testnet" && env.TRADING_MODE !== "live") {
      throw new TypeError("TRADING_MODE must be explicitly set to testnet or live.")
    }
    const service = createService({
      env,
    })
    if (parsed.command === "create") {
      const result = await service.createBackup({
        keep: parsed.keep,
      })
      logger.info({
        message: "Harvester trading-history backup created and restore-verified.",
        environment: result.environment,
        backupFilename: result.backupFilename,
        retainedBackupCount: result.retainedBackupCount,
        pagesCopied: result.pagesCopied,
      })
      return 0
    }
    const result = await service.verifyBackup({
      backupFilename: parsed.backupFilename,
    })
    logger.info({
      message: "Harvester trading-history restore verification passed.",
      environment: result.environment,
      backupFilename: result.backupFilename,
      schemaVersion: result.schemaVersion,
      rowCounts: result.rowCounts,
    })
    return 0
  } catch (error) {
    logFailure(logger, error)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runTradingHistoryBackupCommand()
}
