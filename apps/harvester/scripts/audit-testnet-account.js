import { pathToFileURL } from "node:url"
import { EventBus } from "@coinzilla/event-bus"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { AccountSnapshot } from "../src/domain/account/account-snapshot.js"
import { HARVESTER_EVENT_NAMES } from "../src/application/events/event-names.js"
import {
  mapAccountOpenOrdersCapturedData,
  mapAccountSnapshotCapturedData,
} from "../src/application/events/lifecycle-event-dtos.js"
import { makeEventPublisher } from "../src/application/events/event-publisher.js"
import { publishLifecycleEvent } from "../src/application/events/publish-lifecycle-event.js"
import { createBinanceBrokerAdapter } from "../src/infrastructure/brokers/binance-broker-adapter.js"
import { prepareOptionalJournal } from "../src/infrastructure/journal/prepare-optional-journal.js"

const EVENT_BUS_CLOSE_TIMEOUT_MS = 5000

const requireSuccess = ({ result, operation }) => {
  if (result?.ok === true) return result
  const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
  throw new Error(operation + (details ? ": " + details : ""))
}

const publishAndFlush = async ({ eventPublisher, eventName, dataResult }) => {
  const published = publishLifecycleEvent({ eventPublisher, eventName, dataResult })
  requireSuccess({ result: published, operation: "Unable to publish " + eventName })
  requireSuccess({
    result: await eventPublisher.flush(),
    operation: "Unable to durably persist " + eventName,
  })
}

/**
 * Capture a read-only TESTNET account baseline without starting Harvester,
 * subscribing to market streams, or enabling the trading engine.
 */
export async function runTestnetAccountAudit({
  env = process.env,
  logger = defaultLogger,
  now = Date.now,
  createEventBus = ({ eventBusLogger } = {}) => new EventBus({ logger: eventBusLogger }),
  createJournalService = prepareOptionalJournal,
  brokerAdapterFactory = createBinanceBrokerAdapter,
} = {}) {
  let eventBus
  let journalService
  let broker
  let outcome
  const cleanupErrors = []

  try {
    if (env.HARVESTER_BROKER !== "binance") {
      throw new Error("TESTNET account audit requires HARVESTER_BROKER=binance")
    }
    if (env.HARVESTER_TRADING_MODE !== "testnet" || env.NODE_ENV === "production") {
      throw new Error("TESTNET account audit requires HARVESTER_TRADING_MODE=testnet and non-production NODE_ENV")
    }
    if (env.HARVESTER_JOURNAL_ENABLED?.trim().toLowerCase() === "false") {
      throw new Error("TESTNET account audit requires HARVESTER_JOURNAL_ENABLED=true")
    }

    eventBus = createEventBus({ eventBusLogger: logger })
    journalService = createJournalService({
      eventBus,
      logger,
      enabled: true,
      directory: env.HARVESTER_JOURNAL_DIRECTORY,
    })
    if (!journalService || typeof journalService.flush !== "function" ||
        typeof journalService.close !== "function" || !journalService.ready) {
      throw new Error("TESTNET account audit requires a ready Journal with durable flush() support")
    }
    requireSuccess({
      result: await journalService.ready,
      operation: "TESTNET account audit cannot start because the Journal is unavailable",
    })

    const eventPublisher = makeEventPublisher({
      eventBus,
      logger,
      flush: () => journalService.flush(),
    })
    broker = brokerAdapterFactory({
      config: {
        apiKey: env.BINANCE_API_KEY,
        apiSecret: env.BINANCE_API_SECRET_KEY,
      },
      logger,
    })
    await broker.connect()

    const accountResult = await broker.getAccountSnapshot()
    requireSuccess({
      result: accountResult,
      operation: "Unable to load Binance TESTNET account balances",
    })
    if (!accountResult.data || !Array.isArray(accountResult.data.balances)) {
      throw new TypeError("Binance TESTNET account snapshot did not contain a balances array")
    }
    const snapshot = new AccountSnapshot({
      balances: accountResult.data.balances,
      sourceTime: accountResult.data.sourceTime,
    })
    await publishAndFlush({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
      dataResult: mapAccountSnapshotCapturedData({ phase: "PREFLIGHT", snapshot }),
    })

    const ordersResult = await broker.getOpenOrders({})
    requireSuccess({
      result: ordersResult,
      operation: "Unable to load Binance TESTNET account-wide open orders",
    })
    if (!Array.isArray(ordersResult.data)) {
      throw new TypeError("Binance TESTNET open-orders response did not contain an array")
    }
    const orders = ordersResult.data
    const blockReasons = orders.length > 0
      ? ["UNOWNED_OPEN_ORDERS:" + orders.length]
      : []
    await publishAndFlush({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
      dataResult: mapAccountOpenOrdersCapturedData({
        phase: "PREFLIGHT",
        observedAt: now(),
        orders,
        readiness: orders.length === 0 ? "READY" : "BLOCKED",
        blockReasons,
      }),
    })

    outcome = toResult({
      data: {
        sourceTime: snapshot.sourceTime,
        assetCount: snapshot.balances.length,
        orderCount: orders.length,
        readiness: orders.length === 0 ? "READY" : "BLOCKED",
        symbols: [...new Set(orders.map((order) => order.symbol ?? order.market?.symbol).filter(Boolean))].sort(),
      },
    })
    logger.info?.({
      message: "TESTNET account preflight audit durably journaled",
      assetCount: outcome.data.assetCount,
      orderCount: outcome.data.orderCount,
      readiness: outcome.data.readiness,
      symbols: outcome.data.symbols,
      sourceTime: outcome.data.sourceTime,
    })
  } catch (error) {
    outcome = toResult({ error })
  } finally {
    if (broker && typeof broker.disconnect === "function") {
      try {
        await broker.disconnect()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (journalService && typeof journalService.close === "function") {
      try {
        const result = await journalService.close()
        if (result?.ok !== true) {
          cleanupErrors.push(...(result?.errors?.length ? result.errors : [
            new Error("TESTNET account audit Journal close failed"),
          ]))
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (eventBus && typeof eventBus.close === "function") {
      try {
        const result = await eventBus.close({ timeoutMs: EVENT_BUS_CLOSE_TIMEOUT_MS })
        if (result?.ok !== true) {
          cleanupErrors.push(...(result?.errors?.length ? result.errors : [
            new Error("TESTNET account audit EventBus close failed"),
          ]))
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
  }

  if (cleanupErrors.length > 0) {
    outcome = toResult({
      errors: [...(outcome?.errors ?? []), ...cleanupErrors],
      ...(outcome?.data === undefined ? {} : { data: outcome.data }),
    })
  }
  return outcome ?? toResult({ error: new Error("TESTNET account audit did not produce a result") })
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  const result = await runTestnetAccountAudit()
  if (!result.ok) {
    defaultLogger.error?.({
      message: "TESTNET account preflight audit failed",
      errors: (result.errors ?? []).map((error) => ({
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
      })),
    })
    process.exitCode = 1
  } else if (result.data.readiness === "BLOCKED") {
    defaultLogger.error?.({
      message: "TESTNET account preflight audit completed; trading readiness is BLOCKED",
      assetCount: result.data.assetCount,
      orderCount: result.data.orderCount,
      symbols: result.data.symbols,
    })
    process.exitCode = 2
  } else {
    defaultLogger.info?.({
      message: "TESTNET account preflight audit completed; account is READY",
      assetCount: result.data.assetCount,
      orderCount: result.data.orderCount,
    })
  }
}
