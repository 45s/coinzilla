import assert from "node:assert/strict"
import test from "node:test"
import { runTradingHistoryBackupCommand } from "./trading-history-backups.js"

function createLogger() {
  const messages = {
    info: [],
    error: [],
  }
  return {
    messages,
    info: (message) => messages.info.push(message),
    error: (message) => messages.error.push(message),
  }
}

test("dispatches a backup command with the explicit retention count", async () => {
  const logger = createLogger()
  const calls = []
  const service = {
    createBackup: async (options) => {
      calls.push(options)
      return {
        environment: "testnet",
        backupFilename: "/tmp/backups/testnet/verified.sqlite",
        retainedBackupCount: 4,
        pagesCopied: 12,
      }
    },
  }
  const exitCode = await runTradingHistoryBackupCommand({
    args: ["create", "--keep", "4"],
    env: {
      TRADING_MODE: "testnet",
    },
    logger,
    createService: () => service,
  })
  assert.equal(exitCode, 0)
  assert.deepEqual(calls, [{
    keep: 4,
  }])
  assert.equal(logger.messages.info[0].environment, "testnet")
  assert.equal(logger.messages.error.length, 0)
})

test("dispatches a restore check without changing the selected environment", async () => {
  const logger = createLogger()
  const calls = []
  const service = {
    verifyBackup: async (options) => {
      calls.push(options)
      return {
        environment: "live",
        backupFilename: options.backupFilename,
        schemaVersion: 3,
        rowCounts: {
          orders: 2,
          fills: 1,
        },
      }
    },
  }
  const exitCode = await runTradingHistoryBackupCommand({
    args: ["verify", "/data/backups/production/history.sqlite"],
    env: {
      TRADING_MODE: "live",
    },
    logger,
    createService: () => service,
  })
  assert.equal(exitCode, 0)
  assert.deepEqual(calls, [{
    backupFilename: "/data/backups/production/history.sqlite",
  }])
  assert.equal(logger.messages.info[0].schemaVersion, 3)
})

test("rejects missing or inferred trading modes before creating the service", async () => {
  const logger = createLogger()
  let serviceCreated = false
  const exitCode = await runTradingHistoryBackupCommand({
    args: ["create"],
    env: {
      NODE_ENV: "production",
    },
    logger,
    createService: () => {
      serviceCreated = true
      return {}
    },
  })
  assert.equal(exitCode, 1)
  assert.equal(serviceCreated, false)
  assert.equal(logger.messages.error[0].errorCode, "HARVESTER_HISTORY_BACKUP_COMMAND_FAILED")
})

test("rejects malformed command arguments without invoking backup operations", async () => {
  const logger = createLogger()
  let serviceCreated = false
  const exitCode = await runTradingHistoryBackupCommand({
    args: ["create", "--keep", "0"],
    env: {
      TRADING_MODE: "testnet",
    },
    logger,
    createService: () => {
      serviceCreated = true
      return {}
    },
  })
  assert.equal(exitCode, 1)
  assert.equal(serviceCreated, false)
  assert.match(logger.messages.error[0].errorName, /TypeError/)
})
