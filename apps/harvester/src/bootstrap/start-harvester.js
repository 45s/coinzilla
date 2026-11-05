import { Fill, Market } from "@coinzilla/entities"
import { createMarketPrice } from "../domain/market-price.js"
import { compareDecimal, defaultLogger, subtractDecimal, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { AccountSnapshot } from "../domain/account/account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "../domain/account/assert-account-snapshot-covers-markets.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { projectHarvesterJournalRecovery } from "../infrastructure/journal/project-harvester-journal-recovery.js"
import { restoreHarvesterJournalState } from "../use-cases/restore-harvester-journal-state.js"
import { auditRecoveredAccountState } from "../use-cases/audit-recovered-account-state.js"
import { auditRecoveredAccountState } from "../use-cases/audit-recovered-account-state.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { validateMarketTradingReadiness } from "../domain/market/validate-market-trading-readiness.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { assertBrokerPort } from "../application/ports/broker.port.js"
import { makeProcessMarketPrice } from "../use-cases/process-market-price.js"
import { updateTradingAccounting as applyTradingAccounting } from "../use-cases/update-trading-accounting.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerDisconnectedData,
  mapBrokerStatusChangedData,
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
  mapConfigValidatedData,
  mapAccountSnapshotCapturedData,
  mapAccountOpenOrdersCapturedData,
} from "../application/events/lifecycle-event-dtos.js"

async function stopBrokerIntake({ subscriptions, bookSubscriptions = [], userDataSubscription }) {
  const results = await Promise.allSettled([
    ...bookSubscriptions.map(({ unsubscribe }) => {
      return Promise.resolve().then(() => unsubscribe())
    }),
    ...subscriptions.map(({ unsubscribe }) => {
      return Promise.resolve().then(() => unsubscribe())
    }),
    ...(typeof userDataSubscription?.disconnect === "function"
      ? [Promise.resolve().then(() => {
        return userDataSubscription.disconnect()
      })]
      : []),
  ])
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
}

async function disconnectBroker({ broker, brokerName, eventPublisher }) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => {
      return broker.disconnect()
    }),
  ])
  const brokerDisconnect = results[0]
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
    dataResult: mapBrokerDisconnectedData({
      broker: brokerName,
      outcome: brokerDisconnect.status === "fulfilled" ? "success" : "failed",
      ...(brokerDisconnect.status === "rejected" ? { error: brokerDisconnect.reason } : {}),
    }),
  })
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
}

async function cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, bookSubscriptions = [], userDataSubscription }) {
  const intakeErrors = await stopBrokerIntake({ subscriptions, bookSubscriptions, userDataSubscription })
  const disconnectErrors = await disconnectBroker({ broker, brokerName, eventPublisher })
  const errors = [...intakeErrors, ...disconnectErrors]

  return errors
}

const MAX_MARKET_PRICE_AGE_MS = 5_000
const MAX_MARKET_PRICE_FUTURE_SKEW_MS = 1_000

const evaluateReadOnlyConservativeStrategy = ({ marketPrice, portfolio } = {}) => Object.freeze({
  strategy: "CONSERVATIVE",
  symbol: marketPrice?.symbol,
  action: "NO_ACTION",
  reason: "Trading is disabled; Conservative order evaluation runs only inside the trading engine.",
  position: portfolio?.getPosition({ symbol: marketPrice?.symbol })?.value,
})

function logMarketPriceEvaluation({ logger, symbol, priceEvent, processed }) {
  if (!processed?.ok) return

  const { decision } = processed.data ?? {}
  const action = decision?.action ??
    (decision?.actions?.length
      ? decision.actions.map(({ side }) => side).join("+")
      : "NO_ACTION")
  logger.info?.({
    message: "Market price evaluated",
    symbol,
    price: priceEvent?.price,
    action,
  })
}

const createPortfolioWorkflow = ({ evaluateStrategy, logger, initialPortfolio, initialRecoveryLedgers } = {}) => {
  if (initialPortfolio !== undefined && !(initialPortfolio instanceof Portfolio)) {
    throw new TypeError("initialPortfolio must be a Portfolio")
  }
  if (initialRecoveryLedgers !== undefined && !(initialRecoveryLedgers instanceof Map)) {
    throw new TypeError("initialRecoveryLedgers must be a Map")
  }
  let portfolio = initialPortfolio ?? new Portfolio()
  const recoveryLedgers = new Map(initialRecoveryLedgers ?? [])
  let updateQueue = Promise.resolve()

  const tracedEvaluateStrategy = (input = {}) => {
    const marketId = input.marketMetadata?.market?.id
    const recoveryLedger = marketId ? recoveryLedgers.get(marketId) : undefined
    logger.debug?.({
      message: "Harvester strategy evaluation input",
      symbol: input.marketPrice?.symbol,
      marketPrice: input.marketPrice,
      lastBuyPrice: input.lastBuyPrice,
      activeOrders: input.activeOrders,
      pairConfig: input.pairConfig,
      settings: input.settings,
      portfolio: portfolio.value,
      recoveryLedger: recoveryLedger?.value ?? null,
    })
    const decision = evaluateStrategy(input)
    logger.debug?.({
      message: "Harvester strategy evaluation result",
      symbol: input.marketPrice?.symbol,
      action: decision?.action,
      reason: decision?.reason,
      actions: decision?.actions,
      position: decision?.position,
      recoveryLedger: recoveryLedger?.value ?? null,
    })
    return decision
  }
  const processMarketPrice = makeProcessMarketPrice({ evaluateStrategy: tracedEvaluateStrategy })

  const updateTradingAccounting = ({ fill } = {}) => {
    const task = updateQueue.then(() => {
      if (!(fill instanceof Fill)) {
        logger.error?.({
          message: "Harvester accounting rejected non-canonical fill",
          fillType: fill?.constructor?.name ?? typeof fill,
        })
        return toResult({ error: new TypeError("updateTradingAccounting requires a canonical Fill") })
      }

      const previousPortfolio = portfolio
      const currentLedger = recoveryLedgers.get(fill.market.id) ??
        RecoveryLedger.empty({ market: fill.market })
      const previousPosition = previousPortfolio.getPosition({ marketId: fill.market.id })
      const commissionFacts = (fill.commissions ?? []).map(({ amount } = {}) => ({
        amount: amount?.amount,
        asset: amount?.asset?.code,
        assetId: amount?.asset?.id,
      }))

      logger.debug?.({
        message: "Harvester accounting execution received",
        executionId: fill.id,
        tradeId: fill.tradeId,
        brokerOrderId: fill.brokerOrderId,
        clientOrderId: fill.clientOrderId,
        marketId: fill.market.id,
        symbol: fill.market.symbol,
        side: fill.side,
        liquidityRole: fill.liquidityRole,
        executedAt: fill.executedAt,
        price: fill.price?.amount,
        quantity: fill.quantity?.amount,
        quoteQuantity: fill.quoteQuantity?.amount,
        commissionStatus: fill.commissionStatus,
        commissions: commissionFacts,
        previousPosition: previousPosition?.value ?? null,
        previousRecoveryLedger: currentLedger.value,
      })

      const result = applyTradingAccounting({
        portfolio,
        recoveryLedger: currentLedger,
        fill,
      })
      if (result.ok) {
        portfolio = result.data.portfolio
        recoveryLedgers.set(fill.market.id, result.data.recoveryLedger)
        const nextPosition = portfolio.getPosition({ marketId: fill.market.id })
        const nextLedger = result.data.recoveryLedger
        logger.debug?.({
          message: "Harvester accounting execution applied",
          executionId: fill.id,
          tradeId: fill.tradeId,
          symbol: fill.market.symbol,
          applied: result.data.applied,
          duplicate: result.data.duplicate,
          nextPosition: nextPosition?.value ?? null,
          nextRecoveryLedger: nextLedger.value,
          accountingDelta: {
            portfolioActiveBase: subtractDecimal({
              left: nextPosition?.baseQuantity.amount ?? "0",
              right: previousPosition?.baseQuantity.amount ?? "0",
            }),
            portfolioFreeBase: subtractDecimal({
              left: nextPosition?.freeBaseQuantity.amount ?? "0",
              right: previousPosition?.freeBaseQuantity.amount ?? "0",
            }),
            portfolioQuoteCashFlow: subtractDecimal({
              left: nextPosition?.quoteNetCashFlow.amount ?? "0",
              right: previousPosition?.quoteNetCashFlow.amount ?? "0",
            }),
            buyCost: subtractDecimal({
              left: nextLedger.buyCost,
              right: currentLedger.buyCost,
            }),
            netSellProceeds: subtractDecimal({
              left: nextLedger.netSellProceeds,
              right: currentLedger.netSellProceeds,
            }),
            outstandingRecoveryAmount: subtractDecimal({
              left: nextLedger.outstandingRecoveryAmount,
              right: currentLedger.outstandingRecoveryAmount,
            }),
            realizedNetProfit: subtractDecimal({
              left: nextLedger.realizedNetProfit,
              right: currentLedger.realizedNetProfit,
            }),
          },
        })
      } else {
        logger.error?.({
          message: "Harvester accounting execution rejected",
          executionId: fill.id,
          tradeId: fill.tradeId,
          symbol: fill.market.symbol,
          errors: (result.errors ?? []).map((error) => ({
            name: error?.name,
            message: error?.message ?? String(error),
            stack: error?.stack,
          })),
          unchangedPortfolio: previousPortfolio.value,
          unchangedRecoveryLedger: currentLedger.value,
        })
      }
      return result
    })
    updateQueue = task.then(() => undefined, () => undefined)
    return task
  }

  return {
    updatePortfolio: updateTradingAccounting,
    updateTradingAccounting,
    processMarketPrice: (input = {}) => processMarketPrice({ ...input, portfolio }),
    getPortfolio: () => portfolio,
    getRecoveryLedger: ({ marketId } = {}) => recoveryLedgers.get(marketId),
    completeRecoveryCycle: ({ marketId, keepQuantity, minProfit } = {}) => {
      const recoveryLedger = recoveryLedgers.get(marketId)
      const position = portfolio.getPosition({ marketId })
      if (!recoveryLedger || !position) {
        return toResult({ error: new Error("Cannot complete a recovery cycle without an active Position and RecoveryLedger") })
      }
      try {
        const completionInput = {
          sellOrderFullyFilled: true,
          buyCost: recoveryLedger.buyCost,
          netSellProceeds: recoveryLedger.netSellProceeds,
          activeQuantity: position.baseQuantity.amount,
          keepQuantity,
          minProfit,
        }
        logger.debug?.({
          message: "Harvester recovery completion evaluation input",
          marketId,
          symbol: recoveryLedger.market.symbol,
          completionInput,
          position: position.value,
          recoveryLedger: recoveryLedger.value,
        })
        const completion = evaluateRecoveryCompletion(completionInput)
        if (completion.eligible) {
          const previousPortfolio = portfolio
          const previousLedger = recoveryLedger
          portfolio = portfolio.allocateFreeQuantity({ marketId, quantity: completion.freeQuantity })
          const resetLedger = recoveryLedger.resetCycle()
          recoveryLedgers.set(marketId, resetLedger)
          logger.debug?.({
            message: "Harvester recovery cycle completed and inventory allocated",
            marketId,
            symbol: recoveryLedger.market.symbol,
            completion,
            previousPosition: previousPortfolio.getPosition({ marketId })?.value ?? null,
            nextPosition: portfolio.getPosition({ marketId })?.value ?? null,
            previousRecoveryLedger: previousLedger.value,
            nextRecoveryLedger: resetLedger.value,
          })
        } else {
          logger.debug?.({
            message: "Harvester recovery cycle not completed",
            marketId,
            symbol: recoveryLedger.market.symbol,
            completion,
            unchangedPosition: position.value,
            unchangedRecoveryLedger: recoveryLedger.value,
          })
        }
        return toResult({ data: completion })
      } catch (error) {
        logger.error?.({
          message: "Harvester recovery completion evaluation failed",
          marketId,
          errorName: error?.name,
          errorMessage: error?.message ?? String(error),
          errorStack: error?.stack,
          unchangedPortfolio: portfolio.value,
          unchangedRecoveryLedger: recoveryLedger.value,
        })
        return toResult({ error })
      }
    },
  }
}

export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  evaluateStrategy = evaluateReadOnlyConservativeStrategy,
  logger = defaultLogger,
  eventPublisher,
  onMarketPriceError = ({ symbol, error, errors }) => {
    logger.error?.({
      message: "Harvester market price processing failed",
      symbol,
      error,
      errors,
    })
  },
  onUserDataEvent = async () => {},
  onUserDataStatus = () => {},
  now = Date.now,
  journalRecoveryRecords = [],
} = {}) {
  if (!Array.isArray(journalRecoveryRecords)) {
    throw new TypeError("journalRecoveryRecords must be an array")
  }
  const tradingConfig = await loadConfig(configSource)
  const strategyConfig = tradingConfig.strategies?.CG_coinGrabber
  if (strategyConfig?.enabled !== true) {
    throw new Error("CG_coinGrabber strategy must remain enabled in trading config")
  }
  if (strategyConfig.settings?.conservative?.enabled !== true) {
    throw new Error("Conservative strategy must remain enabled in CG_coinGrabber settings")
  }
  if (strategyConfig.settings?.aggressive?.enabled === true) {
    throw new Error("Aggressive strategy is disabled and deferred; set strategies.CG_coinGrabber.settings.aggressive.enabled=false")
  }
  const { settings, pairs } = strategyConfig
  const enabledSymbols = Object.entries(pairs)
    .filter(([, pairConfig]) => pairConfig.enabled)
    .map(([symbol]) => symbol)
  const brokerName = env.HARVESTER_BROKER
  if (brokerName !== undefined && brokerName !== "" && brokerName !== "binance") {
    throw new Error("Unsupported HARVESTER_BROKER value: " + brokerName)
  }
  const tradingRequested = env.HARVESTER_ENABLE_TRADING === "true"
  if (tradingRequested && (brokerName === undefined || brokerName === "")) {
    throw new Error("HARVESTER_BROKER=binance is required when HARVESTER_ENABLE_TRADING=true")
  }
  const tradingEnabled = brokerName === "binance" && tradingRequested
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: mapConfigValidatedData({
      enabledMarkets: enabledSymbols,
      strategyMode: tradingEnabled ? "conservative" : "read-only",
      tradingEnabled,
    }),
  })
  logger.info?.({
    message: "Harvester trading configuration validated",
    enabledSymbols,
    strategyMode: env.HARVESTER_ENABLE_TRADING === "true" ? "conservative-testnet" : "read-only",
  })

  let portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy, logger })
  let recoveredState = Object.freeze({
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    orderRegistry: undefined,
    pausedMarkets: Object.freeze([]),
    replacementIntents: Object.freeze([]),
    completedOrderClientIds: Object.freeze([]),
    trailingBuySymbols: Object.freeze([]),
    requiresExchangeReconciliation: journalRecoveryRecords.length > 0,
  })
  let processMarketPrice = (...args) => portfolioWorkflow.processMarketPrice(...args)
  let processMarketBook = () => toResult({ data: { skipped: true, reason: "TRADING_DISABLED" } })
  const updatePortfolio = (...args) => portfolioWorkflow.updatePortfolio(...args)
  const updateTradingAccounting = (...args) => portfolioWorkflow.updateTradingAccounting(...args)
  const getPortfolio = (...args) => portfolioWorkflow.getPortfolio(...args)
  const getRecoveryLedger = (...args) => portfolioWorkflow.getRecoveryLedger(...args)
  const completeRecoveryCycle = (...args) => portfolioWorkflow.completeRecoveryCycle(...args)
  const marketMetadata = new Map()
  let accountSnapshot
  const getMarketMetadata = ({ symbol } = {}) => marketMetadata.get(symbol)
  const getAccountSnapshot = () => accountSnapshot
  let tradingEngine
  let hasCanonicalOwnershipReconciliation = false

  if (brokerName === undefined || brokerName === "") {
    logger.info?.({ message: "Harvester started without a broker; exchange connectivity is disabled" })
    return Object.freeze({
      tradingConfig,
      eventPublisher,
      broker: undefined,
      tradingEnabled: false,
      strategyMode: "read-only",
      connected: false,
      subscriptions: [],
      processMarketPrice,
      updatePortfolio,
      updateTradingAccounting,
      get portfolio() { return getPortfolio() },
      getRecoveryLedger,
      getMarketMetadata,
      getAccountSnapshot,
      stop: async () => {},
    })
  }
  if (tradingEnabled && (env.HARVESTER_TRADING_MODE !== "testnet" || env.NODE_ENV === "production")) {
    throw new Error("Harvester order execution requires HARVESTER_TRADING_MODE=testnet and non-production NODE_ENV")
  }

  const broker = assertBrokerPort({
    broker: brokerAdapterFactory({
      config: {
        apiKey: env.BINANCE_API_KEY,
        apiSecret: env.BINANCE_API_SECRET_KEY,
      },
    }),
  })

  try {
    logger.info?.({ message: "Connecting to Binance broker" })

    await broker.connect()
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
      dataResult: mapBrokerConnectedData({ broker: brokerName }),
    })
    logger.info?.({ message: "Binance broker connected" })
  } catch (error) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
      dataResult: mapBrokerConnectionFailedData({ broker: brokerName, error }),
    })
    logger.error?.({
      message: "Binance broker connection failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
    try {
      await broker.disconnect()
    } catch (disconnectError) {
      throw new AggregateError(
        [error, disconnectError],
        "Harvester broker connection failed and disconnect cleanup also failed",
      )
    }
    throw error
  }

  const subscriptions = []
  const bookSubscriptions = []
  let userDataSubscription
  let userDataReady = false
  let initialAccountSnapshotReady = false
  // Startup loads an authoritative initial balance snapshot. Disconnects and
  // explicit recovery requirements still close the gate because in-memory
  // order/accounting state is not comprehensively reconciled across reconnects.
  let userDataRequiresReconciliation = !tradingEnabled || recoveredState.requiresExchangeReconciliation
  let userDataStreamUnsafe = false
  let userDataAccountingFailed = false
  let userDataStatus = "NOT_SUBSCRIBED"
  let userDataEventQueue = Promise.resolve()
  let userDataReconciliationQueued = false
  let startupRecoveryReconciliation = false
  let stopped = false
  const resumeDeferredStrategyEvaluations = ({} = {}) => {
    if (!tradingEngine || !userDataReady || stopped) return
    void tradingEngine.resumeDeferredEvaluations().then((result) => {
      if (!result.ok) logger.error?.({ message: "Harvester deferred strategy evaluation failed", errors: result.errors })
    }).catch((error) => {
      logger.error?.({ message: "Harvester deferred strategy evaluation failed", error })
    })
  }
  const refreshAccountSnapshot = async () => {
    const result = await broker.getAccountSnapshot()
    if (!result?.ok || !result.data || !Array.isArray(result.data.balances)) {
      const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error(
        "Unable to load canonical exchange account balances" + (details ? ": " + details : ""),
      )
    }
    const nextSnapshot = new AccountSnapshot({
      balances: result.data.balances,
      sourceTime: result.data.sourceTime,
    })
    const accountAuditMarkets = [...marketMetadata.values()]
      .map(({ market }) => market)
      .filter((market) =>
        enabledSymbols.includes(market.symbol) ||
        Boolean(recoveredState.portfolio.getPosition({ marketId: market.id })) ||
        (recoveredState.orderRegistry?.getActiveOrders({ marketId: market.id }).length ?? 0) > 0
      )
    assertAccountSnapshotCoversMarkets({
      accountSnapshot: nextSnapshot,
      markets: accountAuditMarkets,
    })
    if (accountSnapshot && nextSnapshot.sourceTime < accountSnapshot.sourceTime) {
      throw new Error("Exchange account snapshot is older than the previously accepted snapshot")
    }
    accountSnapshot = nextSnapshot
    logger.info?.({
      message: "Exchange account snapshot loaded",
      balanceCount: nextSnapshot.balances.length,
      sourceTime: nextSnapshot.sourceTime,
    })

    return nextSnapshot
  }

  const publishOpenOrdersSnapshot = async ({
    phase = "PREFLIGHT",
    blockOnExistingOrders = tradingEnabled,
    ownershipReconciled = hasCanonicalOwnershipReconciliation,
    orders: suppliedOrders,
  } = {}) => {
    let orders = suppliedOrders
    if (orders === undefined) {
      const result = await broker.getOpenOrders({})
      if (!result?.ok || !Array.isArray(result.data)) {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""))
      }
      orders = result.data
    }
    if (!Array.isArray(orders)) throw new TypeError("publishOpenOrdersSnapshot orders must be an array")
    const restoredOrders = recoveredState.orderRegistry?.orders ?? []
    const matchedOwnedClientIds = new Set()
    const unownedOrders = orders.filter((order) => {
      const clientOrderId = order?.clientOrderId
      const brokerOrderId = order?.brokerOrderId ?? order?.id
      const symbol = order?.market?.symbol ?? order?.symbol
      if (typeof clientOrderId !== "string" || !clientOrderId.trim() ||
          typeof brokerOrderId !== "string" || !brokerOrderId.trim() ||
          typeof symbol !== "string" || !symbol.trim()) return true
      const owned = restoredOrders.find((candidate) =>
        candidate.clientOrderId === clientOrderId ||
        (candidate.brokerOrderId !== undefined && candidate.brokerOrderId === brokerOrderId)
      )
      if (!owned || matchedOwnedClientIds.has(owned.clientOrderId)) return true
      if (owned.status === "CANCELED" || owned.status === "REJECTED") return true
      if (owned.brokerOrderId !== undefined && owned.brokerOrderId !== brokerOrderId) return true
      const actualPrice = order.originalPrice ?? order.limitPrice?.amount ?? order.price?.amount ?? order.price
      const expectedPrice = owned.limitPrice?.amount
      const actualQuantity = order.originalQuantity?.amount ?? order.originalQuantity
      if (
        owned.clientOrderId !== clientOrderId ||
        owned.market.symbol !== symbol ||
        owned.side !== order.side ||
        owned.type !== order.type ||
        compareDecimal({ left: owned.originalQuantity.amount, right: actualQuantity }) !== 0 ||
        (expectedPrice === undefined
          ? actualPrice !== undefined
          : actualPrice === undefined || compareDecimal({ left: expectedPrice, right: String(actualPrice) }) !== 0)
      ) return true
      matchedOwnedClientIds.add(owned.clientOrderId)
      return false
    })
    const blockReasons = unownedOrders.length > 0
      ? ["UNOWNED_OPEN_ORDERS:" + unownedOrders.length]
      : orders.length > 0 && !ownershipReconciled
        ? ["CANONICAL_ORDER_RECONCILIATION_REQUIRED"]
        : []
    const readiness = blockReasons.length > 0
      ? "BLOCKED"
      : orders.length > 0
        ? "RECONCILED"
        : "READY"
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
      dataResult: mapAccountOpenOrdersCapturedData({
        phase,
        observedAt: now(),
        orders,
        readiness,
        blockReasons,
      }),
    })
    if (!published?.ok) {
      const details = published?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error("Unable to publish account open-orders audit event" + (details ? ": " + details : ""))
    }
    if (typeof eventPublisher?.flush === "function") {
      const flushed = await eventPublisher.flush()
      if (flushed?.ok !== true || flushed?.durable !== true) {
        const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Unable to durably persist account open-orders audit" + (details ? ": " + details : ""))
      }
    } else {
      throw new Error("Harvester startup requires a durable open-orders audit before market subscriptions")
    }
    logger.info?.({
      message: readiness === "READY"
        ? "Account-wide open-orders audit complete; no open orders found"
        : readiness === "RECONCILED"
          ? "Account-wide open-orders audit complete; all open orders match restored Harvester ownership"
          : unownedOrders.length > 0
          ? "Account-wide open-orders audit blocked trading because open orders are unowned"
          : "Account-wide open-orders audit is waiting for canonical order reconciliation",
      orderCount: orders.length,
      readiness,
      symbols: [...new Set(orders.map((order) => order.market?.symbol ?? order.symbol).filter(Boolean))],
    })
    if (unownedOrders.length > 0 && blockOnExistingOrders) {
      throw new Error(
        "Conservative TESTNET startup blocked: account has " + unownedOrders.length +
        " open order(s) without matching durable Harvester ownership; inspect account.open_orders_captured in Journal",
      )
    }
    return orders
  }

  const publishAccountSnapshot = async ({
    phase,
    auditStatus = "COMPLETE",
    auditReasons = [],
    snapshot: suppliedSnapshot,
  } = {}) => {
    const snapshot = suppliedSnapshot ?? await refreshAccountSnapshot()
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
      dataResult: mapAccountSnapshotCapturedData({ phase, snapshot, auditStatus, auditReasons }),
    })
    if (!published?.ok) throw new Error("Unable to publish " + phase + " account snapshot audit event")
    if (typeof eventPublisher?.flush === "function") {
      const flushed = await eventPublisher.flush()
      if (flushed?.ok !== true || flushed?.durable !== true) {
        const details = flushed?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Unable to durably persist " + phase + " account snapshot" + (details ? ": " + details : ""))
      }
    } else {
      throw new Error("Harvester startup requires a durable Journal flush before market subscriptions")
    }
    logger.info?.({
      message: "Account snapshot captured and durably journaled",
      phase, auditStatus, assetCount: snapshot.balances.length, sourceTime: snapshot.sourceTime, auditReasons,
    })
    return snapshot
  }

  const isMarketPriceFresh = (marketPrice) => {
    const ageMs = now() - marketPrice.timestamp
    return Number.isSafeInteger(ageMs) &&
      ageMs >= -MAX_MARKET_PRICE_FUTURE_SKEW_MS &&
      ageMs <= MAX_MARKET_PRICE_AGE_MS
  }
  const isMarketBookFresh = (marketBook) => {
    const ageMs = now() - marketBook.timestamp
    return Number.isSafeInteger(ageMs) && ageMs >= -MAX_MARKET_PRICE_FUTURE_SKEW_MS && ageMs <= MAX_MARKET_PRICE_AGE_MS
  }

  const activateTradingEngine = () => {
    if (!tradingEnabled) return
    const enabledPairs = Object.entries(pairs).filter(([, pairConfig]) => pairConfig.enabled)
    if (enabledPairs.length !== 1) {
      throw new Error("The first Conservative TESTNET trading cycle requires exactly one enabled pair")
    }
    tradingEngine = makeConservativeTradingEngine({
      broker,
      strategyPolicy: conservativeStrategyPolicy,
      eventPublisher,
      tradingConfig,
      getPortfolio,
      getRecoveryLedger,
      getMarketMetadata,
      getAccountSnapshot,
      updateTradingAccounting,
      completeRecoveryCycle,
      canTrade: () => userDataReady,
      isMarketPriceFresh,
      isMarketBookFresh,
      logger,
      initialState: {
        orderRegistry: recoveredState.orderRegistry,
        pausedMarkets: recoveredState.pausedMarkets,
        replacementIntents: recoveredState.replacementIntents,
        trailingBuyRepriceIntents: recoveredState.trailingBuyRepriceIntents,
        completedOrderClientIds: recoveredState.completedOrderClientIds,
        trailingBuySymbols: recoveredState.trailingBuySymbols,
      },
      isStopping: () => stopped,
      onPause: async ({ symbol, reason, error }) => {
        logger.error?.({ message: "Harvester paused a trading pair", symbol, reason, error })
      },
    })
    processMarketPrice = tradingEngine.processMarketPrice
    processMarketBook = tradingEngine.processBookTicker
  }
  const reportPriceError = (details) => {
    try {
      onMarketPriceError(details)
    } catch (error) {
      logger.error?.({
        message: "Harvester market price error handler failed",
        error,
      })
    }
  }

  try {
    const recoveryProjection = projectHarvesterJournalRecovery({
      records: journalRecoveryRecords,
    })
    if (!recoveryProjection?.ok) {
      throw new Error(
        "Harvester Journal recovery projection failed; trading state cannot be reconstructed: " +
        (recoveryProjection?.errors ?? []).map((error) => error?.message ?? String(error)).join("; "),
      )
    }

    for (const [symbol, pairConfig] of Object.entries(pairs)) {
      if (!pairConfig.enabled) continue

      const filtersResult = await broker.getSymbolFilters({ symbol })
      if (!filtersResult?.ok || !filtersResult.data) {
        const details = filtersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Unable to load required exchange trading rules for " + symbol +
          (details ? ": " + details : ""),
        )
      }
      const validatedMetadata = validateMarketTradingReadiness({
        symbol,
        pairConfig,
        marketMetadata: filtersResult.data,
      })
      marketMetadata.set(symbol, validatedMetadata)
      logger.info?.({ message: "Exchange trading rules validated", symbol })
    }

    const recoverySymbols = new Set([
      ...recoveryProjection.data.orders.map(({ symbol }) => symbol),
      ...recoveryProjection.data.fills.map(({ symbol }) => symbol),
      ...recoveryProjection.data.recoveryCycles.map(({ symbol }) => symbol),
    ])
    for (const symbol of recoverySymbols) {
      if (marketMetadata.has(symbol)) continue
      const filtersResult = await broker.getSymbolFilters({ symbol })
      const historicalMarket = filtersResult?.data?.market
      if (!filtersResult?.ok || !(historicalMarket instanceof Market) || historicalMarket.symbol !== symbol) {
        const details = filtersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Unable to load canonical exchange Market metadata for historical Harvester symbol " + symbol +
          (details ? ": " + details : ""),
        )
      }
      marketMetadata.set(symbol, { market: historicalMarket })
      logger.info?.({ message: "Historical exchange Market metadata loaded for Journal recovery", symbol })
    }

    const restored = restoreHarvesterJournalState({
      projection: recoveryProjection,
      marketMetadata,
    })
    if (!restored?.ok) {
      throw new Error(
        "Harvester Journal domain-state restoration failed; trading state cannot be reconstructed: " +
        (restored?.errors ?? []).map((error) => error?.message ?? String(error)).join("; "),
      )
    }
    recoveredState = restored.data
    if (tradingEnabled) activateTradingEngine()
    portfolioWorkflow = createPortfolioWorkflow({
      evaluateStrategy,
      logger,
      initialPortfolio: recoveredState.portfolio,
      initialRecoveryLedgers: recoveredState.recoveryLedgers,
    })
    logger.info?.({
      message: "Harvester Journal state restored in memory; canonical exchange reconciliation remains mandatory",
      recoveredOrders: recoveredState.orderRegistry?.orders?.length ?? 0,
      recoveredMarkets: recoveredState.recoveryLedgers.size,
      recoveredPausedMarkets: recoveredState.pausedMarkets.size ?? recoveredState.pausedMarkets.length,
      requiresExchangeReconciliation: recoveredState.requiresExchangeReconciliation,
    })

    logger.info?.({ message: "Subscribing to Binance user-data events" })

    let userDataResult
    try {
      userDataResult = await broker.subscribeForUserData({
      onEvent: ({ event } = {}) => {
        if (stopped) return
        const isExecution = event?.eventType === "executionReport" &&
          event?.executionType === "TRADE"
        const isOrderUpdate = event?.eventType === "executionReport"
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          userDataReady = false
          userDataAccountingFailed = true
          userDataStatus = "INVALID_EVENT"
          return
        }
        let reevaluateSymbol

        if (isExecution) {
          logger.info?.({
            message: "Trade execution received",
            symbol: event.fill?.market?.symbol ?? event.executedOrder?.market?.symbol,
            side: event.fill?.side ?? event.executedOrder?.side,
          })
        }
        const task = userDataEventQueue.then(async () => {
          if (tradingEngine && isOrderUpdate) {
            const processed = await tradingEngine.processUserDataEvent({ event })
            if (!processed.ok) {
              userDataAccountingFailed = true
              userDataStatus = "EXECUTION_ACCOUNTING_FAILED"
              const rejectedOrder = event.executedOrder
              const registeredOrders = tradingEngine.getOrders()
              const incomingBrokerOrderId = rejectedOrder?.brokerOrderId ?? event.fill?.brokerOrderId
              const incomingClientOrderId = rejectedOrder?.clientOrderId ?? event.clientOrderId ?? event.fill?.clientOrderId
              const clientIdMatch = registeredOrders.find((order) =>
                order.clientOrderId === incomingClientOrderId)
              const brokerIdMatch = registeredOrders.find((order) =>
                incomingBrokerOrderId !== undefined &&
                order.brokerOrderId === incomingBrokerOrderId)
              logger.error?.({
                message: "Harvester rejected an unowned or invalid order event",
                eventType: event.eventType ?? "UNKNOWN",
                executionType: event.executionType,
                symbol: rejectedOrder?.market?.symbol ?? event.fill?.market?.symbol,
                brokerOrderId: incomingBrokerOrderId,
                clientOrderId: incomingClientOrderId,
                originalClientOrderId: event.originalClientOrderId,
                side: rejectedOrder?.side ?? event.fill?.side,
                orderStatus: rejectedOrder?.status,
                executionId: event.fill?.id ?? event.executionId,
                registryMatchedByClientOrderId: Boolean(clientIdMatch),
                registryMatchedByBrokerOrderId: Boolean(brokerIdMatch),
                clientIdMatchStatus: clientIdMatch?.status,
                clientIdMatchBrokerOrderId: clientIdMatch?.brokerOrderId,
                brokerIdMatchClientOrderId: brokerIdMatch?.clientOrderId,
                errors: (processed.errors ?? []).map((error) => ({
                  name: error?.name ?? "Error",
                  message: error?.message ?? String(error),
                  stack: error?.stack,
                })),
              })
              return
            }
            logger.info?.({
              message: "Harvester order event processed",
              eventType: event.eventType ?? "UNKNOWN",
              executionType: event.executionType,
              symbol: event.executedOrder?.market?.symbol ?? event.fill?.market?.symbol,
              brokerOrderId: event.executedOrder?.brokerOrderId ?? event.fill?.brokerOrderId,
              clientOrderId: event.executedOrder?.clientOrderId ?? event.clientOrderId ?? event.fill?.clientOrderId,
              originalClientOrderId: event.originalClientOrderId,
              side: event.executedOrder?.side ?? event.fill?.side,
              orderStatus: event.executedOrder?.status,
              executionId: event.fill?.id,
              outcome: processed.data?.ignored === true ? "IGNORED" : "ACCEPTED",
              ignored: processed.data?.ignored === true,
              fillApplied: event.executionType === "TRADE" && processed.data?.ignored !== true,
            })
            if (processed.data?.reevaluate === true) reevaluateSymbol = event.executedOrder.market.symbol
          } else if (isOrderUpdate && tradingEnabled) {
            userDataAccountingFailed = true
            userDataReady = false
            userDataStatus = "UNOWNED_ORDER_EVENT_BEFORE_ENGINE_READY"
            logger.error?.({
              message: "Harvester received an order report before its order-ownership registry was ready",
              symbol: event.executedOrder?.market?.symbol ?? event.fill?.market?.symbol,
              brokerOrderId: event.executedOrder?.brokerOrderId ?? event.fill?.brokerOrderId,
            })
            return
          }

          try {
            await onUserDataEvent({
              event,
              portfolio: getPortfolio(),
              recoveryLedger: event.fill instanceof Fill
                ? getRecoveryLedger({ marketId: event.fill.market.id })
                : undefined,
              updatePortfolio,
              updateTradingAccounting,
            })
          } catch (error) {
            // Observability hooks must not roll back a fill already committed
            // to both immutable accounting projections.
            logger.error?.({
              message: "Harvester user-data observer failed",
              eventType: event.eventType ?? "UNKNOWN",
              error,
            })
          }
        }).catch((error) => {
          userDataAccountingFailed = true
          userDataReady = false
          userDataStatus = "EVENT_QUEUE_FAILED"
          logger.error?.({ message: "Harvester user-data event queue failed", error })
        }).finally(async () => {
          if (stopped) {
            userDataReady = false
            userDataStatus = "STOPPED"
            return
          }
          if (userDataAccountingFailed) {
            userDataReady = false
            return
          }
          if (userDataRequiresReconciliation) {
            userDataReady = false
            userDataStatus = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
            return
          }
          if (!initialAccountSnapshotReady) {
            userDataReady = false
            userDataStatus = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
            return
          }
          userDataReady = true
          userDataStatus = "READY"
          if (reevaluateSymbol && tradingEngine) {
            const reevaluated = await tradingEngine.evaluateLatest({ symbol: reevaluateSymbol })
            if (!reevaluated.ok) logger.error?.({ message: "Harvester next strategy evaluation failed", errors: reevaluated.errors })
          }
          resumeDeferredStrategyEvaluations()
        })
        userDataEventQueue = task
      },
      onStatus: (status = {}) => {
        if (stopped) return
        if ([
          "connectionClosed",
          "recovering",
          "recoveryFailed",
          "recovered",
          "reconciled",
          "terminated",
          "rpcError",
          "executionNormalizationFailed",
        ].includes(status.type)) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED,
            dataResult: mapBrokerStatusChangedData({
              broker: brokerName,
              stream: "user-data",
              status: status.type,
              recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
              attempt: status.attempt,
              code: status.code,
              error: status.error,
            }),
          })
        }
        logger.info?.({
          message: "User-data stream status changed",
          statusType: status.type ?? "UNKNOWN",
          recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
          executionPending: status.executionPending === true,
          orderUpdatePending: status.orderUpdatePending === true,
        })
        userDataStatus = status.type ?? "UNKNOWN"
        if (status.type === "executionNormalizationFailed") {
          userDataAccountingFailed = true
          userDataStatus = "EXECUTION_NORMALIZATION_FAILED"
          logger.error?.({
            message: "Binance execution normalization failed",
            symbol: status.symbol,
            brokerOrderId: status.brokerOrderId,
            clientOrderId: status.clientOrderId,
            executionId: status.executionId,
            errorName: status.error?.name ?? "Error",
            errorMessage: status.error?.message ?? String(status.error ?? "Unknown normalization error"),
            errorStack: status.error?.stack,
          })
        }
        const connectionUnsafe = [
          "connectionClosed", "recovering", "recovered", "recoveryFailed", "terminated", "rpcError",
          "executionNormalizationFailed",
        ].includes(status.type)
        if (
          status.type === "reconciled" &&
          status.recoveryRequired !== true &&
          status.reconciliationRequired !== true
        ) {
          userDataStreamUnsafe = false
        }
        if (status.recoveryRequired === true || status.reconciliationRequired === true || connectionUnsafe) {
          userDataStreamUnsafe = true
          userDataRequiresReconciliation = true
          userDataReady = false
          userDataStatus = status.type === "executionNormalizationFailed"
            ? "EXECUTION_NORMALIZATION_FAILED"
            : userDataAccountingFailed
              ? "EXECUTION_ACCOUNTING_FAILED"
              : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        } else if (userDataRequiresReconciliation) {
          // A stream-level "reconciled" acknowledgement alone does not clear
          // an application-level gate raised by a disconnect or recovery.
          userDataReady = false
          userDataStatus = userDataAccountingFailed
            ? "EXECUTION_ACCOUNTING_FAILED"
            : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        } else if (userDataAccountingFailed) {
          userDataReady = false
          userDataStatus = "EXECUTION_ACCOUNTING_FAILED"
        } else if (initialAccountSnapshotReady && tradingEnabled) {
          userDataReady = true
          userDataStatus = "READY"
          resumeDeferredStrategyEvaluations()
        } else if (!initialAccountSnapshotReady) {
          userDataReady = false
          userDataStatus = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
        }
        if (
          status.type === "reconciled" &&
          status.recoveryRequired !== true &&
          status.reconciliationRequired !== true &&
          tradingEngine &&
          initialAccountSnapshotReady &&
          userDataRequiresReconciliation &&
          !userDataAccountingFailed &&
          !userDataReconciliationQueued &&
          !startupRecoveryReconciliation
        ) {
          userDataReconciliationQueued = true
          logger.info?.({ message: "Harvester REST/stream order reconciliation started" })
          const reconciliationTask = tradingEngine.reconcileOwnedOrders({
            beforeApply: async () => {
              // REST reads do not hold the engine transition queue. Let every
              // stream event received during those reads reach the engine
              // before comparing REST execution IDs and applying missing fills.
              while (true) {
                const queuedEvents = userDataEventQueue
                await queuedEvents
                if (queuedEvents === userDataEventQueue) break
              }
            },
          })
          void reconciliationTask.then((reconciliation) => {
            if (stopped) {
              userDataReconciliationQueued = false
              return
            }
            if (!reconciliation?.ok) {
              userDataReady = false
              userDataRequiresReconciliation = true
              userDataStatus = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
              logger.error?.({
                message: "Harvester REST/stream order reconciliation failed; trading remains paused",
                errors: reconciliation?.errors,
              })
              userDataReconciliationQueued = false
              return
            }

            // Stream callbacks received before this barrier are processed
            // before readiness is reopened. Later callbacks are ordinary live
            // events and still pass through the same serialized accounting path.
            const queuedEvents = userDataEventQueue
            const readinessTask = queuedEvents.then(async () => {
              if (stopped || userDataAccountingFailed) return
              userDataRequiresReconciliation = false
              userDataReady = true
              userDataStatus = "READY"
              for (const symbol of reconciliation.data?.symbols ?? []) {
                const evaluated = await tradingEngine.evaluateLatest({ symbol })
                if (!evaluated?.ok) {
                  userDataReady = false
                  userDataRequiresReconciliation = true
                  userDataStatus = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
                  logger.error?.({
                    message: "Harvester strategy reevaluation failed after REST/stream reconciliation",
                    symbol,
                    errors: evaluated?.errors,
                  })
                  return
                }
              }
              logger.info?.({
                message: "Harvester REST/stream order reconciliation completed",
                reconciledOrders: reconciliation.data?.reconciled ?? 0,
              })
              resumeDeferredStrategyEvaluations()
            }).catch((error) => {
              userDataReady = false
              userDataRequiresReconciliation = true
              userDataStatus = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
              logger.error?.({ message: "Harvester readiness transition after reconciliation failed", error })
            }).finally(() => {
              userDataReconciliationQueued = false
            })
            userDataEventQueue = readinessTask
          }).catch((error) => {
            userDataReady = false
            userDataRequiresReconciliation = true
            userDataStatus = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
            userDataReconciliationQueued = false
            logger.error?.({ message: "Harvester REST/stream order reconciliation failed", error })
          })
        }
        try {
          onUserDataStatus({ status, ready: userDataReady })
        } catch (error) {
          userDataReady = false
          userDataAccountingFailed = true
          userDataStatus = "STATUS_HANDLER_FAILED"
          logger.error?.({ message: "Harvester user-data status handler failed", error })
        }
      },
      })
    } catch (error) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
        dataResult: mapBrokerSubscriptionFailedData({
          broker: brokerName,
          stream: "user-data",
          error,
        }),
      })
      throw error
    }

    if (!userDataResult?.ok || typeof userDataResult.data?.disconnect !== "function") {
      const details = userDataResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      const error = new Error(
        "Unable to subscribe to user data" + (details ? ": " + details : ""),
      )
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
        dataResult: mapBrokerSubscriptionFailedData({ broker: brokerName, stream: "user-data", error }),
      })
      throw error
    }
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
      dataResult: mapBrokerSubscriptionEstablishedData({ broker: brokerName, stream: "user-data" }),
    })
    userDataSubscription = userDataResult.data
    logger.info?.({ message: "Binance user-data subscription established" })

    userDataReady = false
    userDataStatus = userDataAccountingFailed
      ? "EXECUTION_ACCOUNTING_FAILED"
      : "AUTHORITATIVE_RECONCILIATION_REQUIRED"

    const initialSnapshotTask = userDataEventQueue.then(async () => {
      await publishAccountSnapshot({ phase: "PREFLIGHT" })
    })
    userDataEventQueue = initialSnapshotTask.then(() => undefined, () => undefined)
    await initialSnapshotTask
    initialAccountSnapshotReady = true

    if (tradingEnabled) {
      if (userDataAccountingFailed) {
        throw new Error("Cannot enable Conservative trading after an unowned or invalid user-data event before order ownership was initialized")
      }

      if (recoveredState.requiresExchangeReconciliation) {
        startupRecoveryReconciliation = true
        const reconciliation = await tradingEngine.reconcileOwnedOrders({
          recoveryMode: true,
          beforeApply: async () => {
            while (true) {
              const queuedEvents = userDataEventQueue
              await queuedEvents
              if (queuedEvents === userDataEventQueue) break
            }
          },
        })
        if (reconciliation?.ok !== true) {
          throw new Error(
            "Conservative TESTNET startup blocked: canonical owned-order/fill reconciliation failed: " +
            (reconciliation?.errors ?? []).map((error) => error?.message ?? String(error)).join("; "),
          )
        }
        hasCanonicalOwnershipReconciliation = true
        await publishAccountSnapshot({ phase: "PREFLIGHT" })
      }

      const openOrders = await publishOpenOrdersSnapshot({
        phase: "PREFLIGHT",
        blockOnExistingOrders: true,
      })
      if (recoveredState.requiresExchangeReconciliation) {
        const reconciledState = {
          ...recoveredState,
          portfolio: getPortfolio(),
          recoveryLedgers: new Map(recoveredState.recoveryLedgers),
          orderRegistry: new OrderRegistry({ orders: tradingEngine.getOrders() }),
        }
        const accountAudit = auditRecoveredAccountState({
          projection: recoveryProjection,
          recoveredState: reconciledState,
          currentAccountSnapshot: accountSnapshot,
          openOrders,
          markets: [...marketMetadata.values()].map(({ market }) => market),
        })
        if (accountAudit?.ok !== true) {
          throw new Error(
            "Conservative TESTNET startup blocked: recovered account/ownership/reservation audit failed: " +
            (accountAudit?.errors ?? []).map((error) => error?.message ?? String(error)).join("; "),
          )
        }
        const recoveryIntents = tradingEngine.getRecoveryIntents()
        const unresolvedStrategyState =
          recoveryIntents.pausedMarkets.length > 0 ||
          recoveryIntents.replacementIntents.length > 0 ||
          recoveryIntents.trailingBuyRepriceIntents.length > 0
        if (unresolvedStrategyState) {
          throw new Error("Conservative TESTNET startup blocked: recovered strategy contains paused markets or unresolved cancel/replace intents")
        }
        logger.info?.({
          message: "Harvester durable restart recovery and account ownership audit completed",
          reconciledOrders: reconciliation.data?.reconciled ?? 0,
          balancesChecked: accountAudit.data?.balancesChecked ?? 0,
          openOrdersChecked: accountAudit.data?.openOrdersChecked ?? 0,
          reservationsChecked: accountAudit.data?.reservationsChecked ?? 0,
        })
        startupRecoveryReconciliation = false
      }

      while (true) {
        const queuedEvents = userDataEventQueue
        await queuedEvents
        if (queuedEvents === userDataEventQueue) break
      }
      const unsafeUserDataStatuses = new Set([
        "connectionClosed", "recovering", "recovered", "recoveryFailed", "terminated",
        "rpcError", "executionNormalizationFailed", "INVALID_EVENT",
      ])
      if (userDataAccountingFailed || unsafeUserDataStatuses.has(userDataStatus)) {
        throw new Error("Conservative TESTNET startup blocked: user-data stream is not in a safe state after canonical recovery")
      }
      if (userDataRequiresReconciliation && !recoveredState.requiresExchangeReconciliation) {
        throw new Error("Cannot enable Conservative trading while user-data stream reconciliation is required")
      }
      const enabledPairs = Object.entries(pairs).filter(([, pairConfig]) => pairConfig.enabled)
      const symbol = enabledPairs[0][0]
      logger.info?.({
        message: "Conservative TESTNET startup checks passed; account ownership and order state are reconciled",
        symbol,
        accountSnapshotSourceTime: accountSnapshot.sourceTime,
      })
      userDataRequiresReconciliation = false
      userDataReady = true
      userDataStatus = "READY"
      resumeDeferredStrategyEvaluations()
      logger.info?.({ message: "Conservative TESTNET trading engine activated" })
    }

    for (const [symbol, pairConfig] of Object.entries(pairs)) {
      if (!pairConfig.enabled) continue
      if (tradingEnabled) {
        let bookResult
        try {
          bookResult = await broker.subscribeForBookTicker({
            symbol,
            onBookTicker: (bookTicker) => {
              if (stopped) return toResult({ data: { skipped: true, reason: "STOPPING" } })
              return Promise.resolve().then(() => processMarketBook({ symbol, bookTicker })).then((processed) => {
                if (!processed.ok) logger.error?.({ message: "Harvester market book processing failed", symbol, errors: processed.errors })
                return processed
              }).catch((error) => {
                logger.error?.({ message: "Harvester market book processing failed", symbol, error })
                return toResult({ error })
              })
            },
          })
        } catch (error) {
          bookResult = toResult({ error })
        }
        if (!bookResult?.ok || typeof bookResult.data?.unsubscribe !== "function") {
          const details = bookResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
          throw new Error("Unable to subscribe to book ticker for " + symbol + (details ? ": " + details : ""))
        }
        bookSubscriptions.push({ symbol, unsubscribe: bookResult.data.unsubscribe })
        logger.info?.({ message: "Harvester subscribed to book ticker", symbol })
      }

      let hasFreshWebSocketPrice = false
      let latestWebSocketPriceTask
      let result
      try {
        result = await broker.subscribeForPrices({
        symbol,
        onPrice: (priceEvent) => {
          if (stopped) return toResult({ data: { skipped: true, reason: "STOPPING" } })

          try {
            if (isMarketPriceFresh(createMarketPrice({ priceEvent }))) {
              hasFreshWebSocketPrice = true
            }
          } catch {
            // The trading engine reports malformed events through its normal result.
          }
          latestWebSocketPriceTask = Promise.resolve().then(() => processMarketPrice({
            symbol,
            priceEvent,
            pairConfig,
            settings: settings,
          })).then((processed) => {
          if (!processed.ok) {
            reportPriceError({ symbol, errors: processed.errors })
          } else {
            logMarketPriceEvaluation({ logger, symbol, priceEvent, processed })
          }

          return processed
        }).catch((error) => {
          reportPriceError({ symbol, error })
          return { ok: false, errors: [error] }
        })
          return latestWebSocketPriceTask
        },
        })
      } catch (error) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
          dataResult: mapBrokerSubscriptionFailedData({
            broker: brokerName,
            stream: "market-price",
            market: symbol,
            error,
          }),
        })
        throw error
      }

      if (!result?.ok || typeof result.data?.unsubscribe !== "function") {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        const error = new Error(
          "Unable to subscribe to market prices for " + symbol + (details ? ": " + details : ""),
        )
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
          dataResult: mapBrokerSubscriptionFailedData({
            broker: brokerName,
            stream: "market-price",
            market: symbol,
            error,
          }),
        })
        throw error
      }
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
        dataResult: mapBrokerSubscriptionEstablishedData({
          broker: brokerName,
          stream: "market-price",
          market: symbol,
        }),
      })
      subscriptions.push({ symbol, unsubscribe: result.data.unsubscribe })
      logger.info?.({ message: "Harvester subscribed to market prices", symbol })

      if (tradingEnabled) {
        let tickerResult
        try {
          tickerResult = await broker.getPrices({ symbol })
        } catch (error) {
          tickerResult = toResult({ error })
        }
        if (latestWebSocketPriceTask) await latestWebSocketPriceTask

        if (!hasFreshWebSocketPrice) {
          if (!tickerResult?.ok || !tickerResult.data) {
            const details = tickerResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
            throw new Error(
              "Unable to load initial market price for " + symbol + (details ? ": " + details : ""),
            )
          }
          const priceEvent = {
            symbol: tickerResult.data.symbol,
            price: tickerResult.data.price,
            timestamp: now(),
          }
          const marketPrice = createMarketPrice({ priceEvent })
          if (marketPrice.symbol !== symbol) {
            throw new Error("Initial ticker price symbol does not match enabled market " + symbol)
          }
          const processed = await processMarketPrice({
            symbol,
            priceEvent,
            pairConfig,
            settings: settings,
          })
          if (!processed.ok) {
            reportPriceError({ symbol, errors: processed.errors })
          } else {
            logMarketPriceEvaluation({ logger, symbol, processed })
          }
        }
      }
    }
  } catch (error) {
    logger.error?.({
      message: "Harvester broker workflow startup step failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
    await userDataEventQueue
    const cleanupErrors = await cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, bookSubscriptions, userDataSubscription })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Harvester market-data startup failed and cleanup was incomplete",
      )
    }
    throw error
  }

  const stop = async () => {
    if (stopped) return
    stopped = true
    userDataReady = false
    userDataStatus = "STOPPING"
    logger.info?.({ message: "Harvester shutdown started" })

    const intakeErrors = await stopBrokerIntake({ subscriptions, bookSubscriptions, userDataSubscription, logger })
    await userDataEventQueue

    const auditReasons = []
    let snapshotError
    if (intakeErrors.length > 0) auditReasons.push("BROKER_INTAKE_SHUTDOWN_FAILED")
    if (tradingEnabled && tradingEngine) {
      try {
        const reconciliation = await tradingEngine.reconcileOwnedOrders()
        if (reconciliation?.ok !== true) auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
      } catch {
        auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
      }
      const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"])
      const unresolvedOrders = tradingEngine.getOrders().filter((order) => !terminalStatuses.has(order.status))
      if (unresolvedOrders.length > 0) auditReasons.push("UNRESOLVED_OWNED_ORDERS:" + unresolvedOrders.length)
      if (userDataAccountingFailed || userDataRequiresReconciliation) {
        auditReasons.push("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")
      }
    }
    try {
      if (tradingEnabled) {
        await publishAccountSnapshot({
          phase: "CLOSING",
          auditStatus: auditReasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
          auditReasons,
        })
      }
    } catch (error) {
      snapshotError = error
      logger.error?.({ message: "Harvester closing account snapshot failed", error })
    }

    userDataStatus = "STOPPED"
    const disconnectErrors = await disconnectBroker({ broker, brokerName, eventPublisher, logger })
    const cleanupErrors = [...intakeErrors, ...disconnectErrors, ...(snapshotError ? [snapshotError] : [])]
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    }
    logger.info?.({ message: "Harvester shutdown completed" })
  }

  return Object.freeze({
    tradingConfig,
    eventPublisher,
    tradingEnabled,
    strategyMode: tradingEnabled ? "conservative" : "read-only",
    get userDataReady() { return userDataReady },
    get userDataStatus() { return userDataStatus },
    processMarketPrice,
    updatePortfolio,
    get portfolio() { return getPortfolio() },
    get recoveredState() { return recoveredState },
    getRecoveryLedger,
    getMarketMetadata,
    getAccountSnapshot,
    subscriptions: subscriptions.map(({ symbol }) => symbol),
    connected: true,
    stop,
  })
}
